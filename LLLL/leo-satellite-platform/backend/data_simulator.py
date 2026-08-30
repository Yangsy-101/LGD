"""
Weather-anchored sensor simulator for project2-0.
Collection cadence follows the original design:
- collect once per minute for each access point
- write into SQLite after a weighted random delay of 1-7 minutes
"""

import json
import os
import random
import sqlite3
import threading
import time
from collections import deque
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
DATA_ROOT = os.path.join(PROJECT_ROOT, 'data')
DATABASE = os.path.join(DATA_ROOT, 'satellite_data.db')
WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'
WEATHER_VARIABLES = 'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m'
COLLECTION_INTERVAL_SECONDS = max(60, int(os.getenv('PROJECT20_COLLECTION_INTERVAL_SECONDS', '60')))
WEATHER_REFRESH_SECONDS = max(60, int(os.getenv('PROJECT20_WEATHER_REFRESH_SECONDS', '300')))
MAX_SENSOR_LOG_ROWS = max(1, int(os.getenv('PROJECT20_MAX_SENSOR_LOG_ROWS', '400')))

DELAY_MINUTES = [1, 2, 3, 4, 5, 6, 7]
DELAY_WEIGHTS = [0.35, 0.22, 0.16, 0.11, 0.08, 0.05, 0.03]

# ch1: temperature * 100, ch2: humidity * 100, ch3: pressure(kPa) * 100, ch4: noise * 10
ACCESS_POINTS = {
    '14195': {
        'name': 'NJUPT IoT Institute',
        'location': 'Sanpailou Campus',
        'lat': 32.0850,
        'lng': 118.7650,
        'weather_cell_selection': 'land',
        'base_values': {'ch1': 850, 'ch2': 4500, 'ch3': 10180, 'ch4': 550},
        'fluctuation': {'ch1': 60, 'ch2': 260, 'ch3': 8, 'ch4': 40},
        'noise': {'day_bias': 26, 'night_bias': -12, 'wind_factor': 3.8},
    },
    '14196': {
        'name': 'Lishui',
        'location': 'Nanjing Lishui',
        'lat': 31.6500,
        'lng': 119.0200,
        'weather_cell_selection': 'land',
        'base_values': {'ch1': 760, 'ch2': 5200, 'ch3': 10160, 'ch4': 500},
        'fluctuation': {'ch1': 72, 'ch2': 320, 'ch3': 9, 'ch4': 36},
        'noise': {'day_bias': 22, 'night_bias': -14, 'wind_factor': 3.4},
    },
    '14197': {
        'name': 'Hainan',
        'location': 'Hainan Province',
        'lat': 20.0200,
        'lng': 110.3500,
        'weather_cell_selection': 'land',
        'base_values': {'ch1': 900, 'ch2': 4800, 'ch3': 10170, 'ch4': 600},
        'fluctuation': {'ch1': 70, 'ch2': 260, 'ch3': 8, 'ch4': 46},
        'noise': {'day_bias': 30, 'night_bias': -10, 'wind_factor': 4.2},
    },
    '14198': {
        'name': 'Bohai',
        'location': 'Bohai Sea',
        'lat': 38.3000,
        'lng': 119.0000,
        'weather_cell_selection': 'sea',
        'base_values': {'ch1': 650, 'ch2': 6500, 'ch3': 10190, 'ch4': 450},
        'fluctuation': {'ch1': 68, 'ch2': 360, 'ch3': 7, 'ch4': 34},
        'noise': {'day_bias': 18, 'night_bias': -8, 'wind_factor': 4.8},
    },
    '14199': {
        'name': 'Yellow Sea',
        'location': 'Yellow Sea',
        'lat': 35.0000,
        'lng': 123.5000,
        'weather_cell_selection': 'sea',
        'base_values': {'ch1': 980, 'ch2': 5500, 'ch3': 10150, 'ch4': 720},
        'fluctuation': {'ch1': 78, 'ch2': 320, 'ch3': 8, 'ch4': 54},
        'noise': {'day_bias': 24, 'night_bias': -6, 'wind_factor': 5.2},
    }
}

simulation_running = False
weather_anchor_cache = {}
weather_cache_lock = threading.Lock()
last_generated_state = {}
state_lock = threading.Lock()
pending_transmissions = deque()
pending_lock = threading.Lock()


def init_database():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS sensor_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sn_code TEXT NOT NULL,
            recv_time TEXT NOT NULL,
            msg_id TEXT,
            payload_time TEXT,
            raw_hex TEXT,
            ch1 INTEGER,
            ch2 INTEGER,
            ch3 INTEGER,
            ch4 INTEGER
        )
        '''
    )

    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sn_payload ON sensor_logs(sn_code, payload_time)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sn_id ON sensor_logs(sn_code, id)')
    conn.commit()
    conn.close()
    print('[db] initialized')


def prune_sensor_logs(cursor):
    cursor.execute('SELECT COUNT(*) FROM sensor_logs')
    total_rows = cursor.fetchone()[0]
    overflow = max(0, total_rows - MAX_SENSOR_LOG_ROWS)
    if overflow <= 0:
        return 0

    cursor.execute(
        '''
        DELETE FROM sensor_logs
        WHERE id IN (
            SELECT id
            FROM sensor_logs
            ORDER BY datetime(substr(payload_time || ':00:00', 1, 19)) ASC, id ASC
            LIMIT ?
        )
        ''',
        (overflow,),
    )
    return overflow


def build_weather_query(config):
    query = {
        'latitude': config['lat'],
        'longitude': config['lng'],
        'current': WEATHER_VARIABLES,
        'timezone': 'auto',
        'cell_selection': config.get('weather_cell_selection', 'land'),
    }
    return f'{WEATHER_API_URL}?{urlencode(query)}'


def get_fallback_anchor(config):
    return {
        'temperature_c': round(config['base_values']['ch1'] / 100, 2),
        'humidity_rh': round(config['base_values']['ch2'] / 100, 2),
        'pressure_kpa': round(config['base_values']['ch3'] / 100, 2),
        'wind_speed_mps': 0.0,
        'source_time': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
    }


def fetch_weather_anchor(sn_code, force=False):
    config = ACCESS_POINTS.get(sn_code)
    if not config:
        raise ValueError(f'Unknown access point: {sn_code}')

    now = time.time()
    with weather_cache_lock:
        cached = weather_anchor_cache.get(sn_code)
        if cached and not force and now - cached['fetched_at'] < WEATHER_REFRESH_SECONDS:
            return cached['anchor']

    request = Request(
        build_weather_query(config),
        headers={'User-Agent': 'project2-0-weather-anchored-simulator/1.0'},
    )

    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode('utf-8'))
        current = payload.get('current') or {}
        anchor = {
            'temperature_c': float(current['temperature_2m']),
            'humidity_rh': float(current['relative_humidity_2m']),
            'pressure_kpa': round(float(current['surface_pressure']) / 10, 2),
            'wind_speed_mps': float(current.get('wind_speed_10m') or 0.0),
            'source_time': current.get('time') or datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        }
        with weather_cache_lock:
            weather_anchor_cache[sn_code] = {'fetched_at': now, 'anchor': anchor}
        return anchor
    except Exception as exc:
        with weather_cache_lock:
            cached = weather_anchor_cache.get(sn_code)
            if cached:
                return cached['anchor']
        fallback = get_fallback_anchor(config)
        print(f'[weather] fallback for {sn_code}: {exc}')
        return fallback


def load_last_generated_state():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    for sn_code in ACCESS_POINTS.keys():
        cursor.execute(
            '''
            SELECT ch1, ch2, ch3, ch4
            FROM sensor_logs
            WHERE sn_code = ?
            ORDER BY id DESC
            LIMIT 1
            ''',
            (sn_code,),
        )
        row = cursor.fetchone()
        if row:
            last_generated_state[sn_code] = {
                'ch1': row['ch1'],
                'ch2': row['ch2'],
                'ch3': row['ch3'],
                'ch4': row['ch4'],
            }

    conn.close()


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def smooth_metric(previous_raw, target_raw, band_raw, noise_std_raw, lower, upper):
    if previous_raw is None:
        value = target_raw + int(random.gauss(0, max(1, noise_std_raw * 1.5)))
    else:
        drift = int((target_raw - previous_raw) * 0.28)
        value = previous_raw + drift + int(random.gauss(0, max(1, noise_std_raw)))

    value = clamp(value, target_raw - band_raw, target_raw + band_raw)
    return clamp(value, lower, upper)


def build_noise_target_raw(payload_dt, config, anchor):
    is_daytime = 7 <= payload_dt.hour < 22
    day_bias = config['noise']['day_bias'] if is_daytime else config['noise']['night_bias']
    wind_contrib = int((anchor.get('wind_speed_mps') or 0.0) * config['noise']['wind_factor'])
    return config['base_values']['ch4'] + day_bias + wind_contrib


def build_raw_hex(payload_dt, ch1, ch2, ch3, ch4):
    return (
        f'011A01{random.randint(0x10, 0x1F):02X}'
        f'{payload_dt.hour:02X}{payload_dt.minute:02X}{payload_dt.second:02X}'
        f'{ch1:04X}{ch2:04X}{ch3:04X}{ch4:04X}'
    )


def generate_sensor_reading(payload_dt, sn_code, force_weather_refresh=False, ignore_previous_state=False):
    config = ACCESS_POINTS.get(sn_code)
    if not config:
        return None

    anchor = fetch_weather_anchor(sn_code, force=force_weather_refresh)
    target_temp_raw = int(round(anchor['temperature_c'] * 100))
    target_humidity_raw = int(round(anchor['humidity_rh'] * 100))
    target_pressure_raw = int(round(anchor['pressure_kpa'] * 100))
    target_noise_raw = build_noise_target_raw(payload_dt, config, anchor)

    with state_lock:
        previous = {} if ignore_previous_state else last_generated_state.get(sn_code, {})
        ch1 = smooth_metric(
            previous.get('ch1'),
            target_temp_raw,
            max(config['fluctuation']['ch1'], 45),
            max(8, config['fluctuation']['ch1'] // 5),
            -2000,
            5000,
        )
        ch2 = smooth_metric(
            previous.get('ch2'),
            target_humidity_raw,
            max(config['fluctuation']['ch2'], 220),
            max(20, config['fluctuation']['ch2'] // 6),
            0,
            10000,
        )
        ch3 = smooth_metric(
            previous.get('ch3'),
            target_pressure_raw,
            max(15, config['fluctuation']['ch3'] * 3),
            max(2, config['fluctuation']['ch3'] // 3),
            9800,
            10400,
        )
        ch4 = smooth_metric(
            previous.get('ch4'),
            target_noise_raw,
            max(config['fluctuation']['ch4'], 28),
            max(6, config['fluctuation']['ch4'] // 5),
            300,
            900,
        )
        last_generated_state[sn_code] = {'ch1': ch1, 'ch2': ch2, 'ch3': ch3, 'ch4': ch4}

    payload_time = payload_dt.strftime('%Y-%m-%d %H:%M')
    msg_id = f"{sn_code}_{payload_dt.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}"
    raw_hex = build_raw_hex(payload_dt, ch1, ch2, ch3, ch4)

    return {
        'sn_code': sn_code,
        'msg_id': msg_id,
        'payload_time': payload_time,
        'raw_hex': raw_hex,
        'ch1': ch1,
        'ch2': ch2,
        'ch3': ch3,
        'ch4': ch4,
    }


def insert_startup_samples():
    payload_dt = datetime.now().replace(second=0, microsecond=0)
    print(f"[sim] writing startup samples for payload_time={payload_dt.strftime('%Y-%m-%d %H:%M')}")
    for sn_code in ACCESS_POINTS.keys():
        sample = generate_sensor_reading(
            payload_dt,
            sn_code,
            force_weather_refresh=True,
            ignore_previous_state=True,
        )
        insert_sensor_data(sample)


def seconds_until_next_collection_tick():
    now = time.time()
    remainder = now % COLLECTION_INTERVAL_SECONDS
    wait_seconds = COLLECTION_INTERVAL_SECONDS - remainder
    if wait_seconds < 0.5:
        wait_seconds += COLLECTION_INTERVAL_SECONDS
    return wait_seconds


def insert_sensor_data(data):
    try:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        recv_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        cursor.execute(
            '''
            INSERT INTO sensor_logs (sn_code, recv_time, msg_id, payload_time, raw_hex, ch1, ch2, ch3, ch4)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                data['sn_code'],
                recv_time,
                data['msg_id'],
                data['payload_time'],
                data['raw_hex'],
                data['ch1'],
                data['ch2'],
                data['ch3'],
                data['ch4'],
            )
        )

        inserted_id = cursor.lastrowid
        deleted_rows = prune_sensor_logs(cursor)
        conn.commit()
        conn.close()
        print(
            f"[sim] insert id={inserted_id}, sn={data['sn_code']}, payload_time={data['payload_time']}, "
            f"pruned={deleted_rows}"
        )
        return inserted_id
    except Exception as exc:
        print(f'[error] insert failed: {exc}')
        return None


def generate_delay_seconds():
    delay_min = random.choices(DELAY_MINUTES, weights=DELAY_WEIGHTS, k=1)[0]
    delay_seconds = delay_min * 60 + random.randint(0, 59)
    return delay_min, delay_seconds


def data_generator_loop():
    global simulation_running
    print(f'[sim] collector started, interval={COLLECTION_INTERVAL_SECONDS}s, points={len(ACCESS_POINTS)}')

    next_tick = time.time() + seconds_until_next_collection_tick()
    cycle_count = 1
    refresh_every = max(1, WEATHER_REFRESH_SECONDS // COLLECTION_INTERVAL_SECONDS)

    while simulation_running:
        time.sleep(max(0.5, next_tick - time.time()))
        if not simulation_running:
            break

        payload_dt = datetime.now().replace(second=0, microsecond=0)
        force_weather_refresh = (cycle_count % refresh_every) == 0

        for sn_code in ACCESS_POINTS.keys():
            sample = generate_sensor_reading(payload_dt, sn_code, force_weather_refresh=force_weather_refresh)
            delay_min, delay_seconds = generate_delay_seconds()
            with pending_lock:
                pending_transmissions.append({
                    'data': sample,
                    'arrival_time': time.time() + delay_seconds,
                })
            print(
                f"[sim] collected sn={sn_code}, payload_time={sample['payload_time']}, "
                f"write_after={delay_min}m"
            )

        cycle_count += 1
        next_tick += COLLECTION_INTERVAL_SECONDS


def transmission_processor_loop():
    global simulation_running
    print('[sim] transmission processor started')

    while simulation_running:
        current_time = time.time()
        ready_items = []
        deferred_items = []

        with pending_lock:
            while pending_transmissions:
                item = pending_transmissions.popleft()
                if item['arrival_time'] <= current_time:
                    ready_items.append(item)
                else:
                    deferred_items.append(item)
            for item in deferred_items:
                pending_transmissions.append(item)

        for item in ready_items:
            insert_sensor_data(item['data'])

        time.sleep(0.5)


def start_simulation():
    global simulation_running

    if simulation_running:
        print('[sim] already running')
        return None, None

    init_database()
    load_last_generated_state()
    insert_startup_samples()
    simulation_running = True

    generator_thread = threading.Thread(target=data_generator_loop, daemon=True)
    generator_thread.start()

    processor_thread = threading.Thread(target=transmission_processor_loop, daemon=True)
    processor_thread.start()

    print('[sim] started (startup current samples + original delayed DB writes)')
    return generator_thread, processor_thread


def stop_simulation():
    global simulation_running
    simulation_running = False
    print('[sim] stopped')


if __name__ == '__main__':
    print('=' * 50)
    print('Project2-0 Sensor Simulator')
    print('=' * 50)
    print(f'database: {DATABASE}')
    print(f'access points: {len(ACCESS_POINTS)}')
    print(f'collection interval: {COLLECTION_INTERVAL_SECONDS}s')
    print(f'weather refresh: {WEATHER_REFRESH_SECONDS}s')
    print('delay distribution: 1-7 minutes')
    for sn_code, config in ACCESS_POINTS.items():
        print(f"  - {sn_code}: {config['name']} ({config['location']})")
    print('=' * 50)
    print('Press Ctrl+C to stop.')
    print()

    try:
        start_simulation()
        while simulation_running:
            time.sleep(1)
    except KeyboardInterrupt:
        print('\n[sim] stopping...')
        stop_simulation()
        time.sleep(1)
        print('[sim] stopped')
