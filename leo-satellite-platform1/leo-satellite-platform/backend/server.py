"""Flask API for the dashboard."""

import mimetypes
import uuid

from flask import Flask, jsonify, request, send_from_directory
import json
import os
import sqlite3
import threading
import time
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
WEB_ROOT = PROJECT_ROOT
ASSETS_ROOT = os.path.join(PROJECT_ROOT, 'assets')
BACKEND_PORT = int(os.getenv('PROJECT20_BACKEND_PORT', '8090'))
LAYOUT_IMAGE_DIR = os.path.join(ASSETS_ROOT, 'images', 'layout')
DATA_ROOT = os.path.join(PROJECT_ROOT, 'data')
DATABASE = os.path.join(DATA_ROOT, 'satellite_data.db')
LAYOUT_BACKUP_DIR = os.path.join(DATA_ROOT, 'layout_backups')
LAYOUT_BACKUP_RETENTION = 1
LAYOUT_IMAGE_PREFIX = 'assets/images/layout'
ALLOWED_LAYOUT_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}

app = Flask(__name__, static_folder=WEB_ROOT)
SATELLITE_SOURCE_BASE_URL = os.getenv(
    'SATELLITE_SOURCE_BASE_URL',
    'http://192.168.0.233:10014',
).rstrip('/')
SATELLITE_SOURCE_TIMEOUT_SECONDS = max(
    0.5,
    float(os.getenv('SATELLITE_SOURCE_TIMEOUT_SECONDS', '1.5')),
)
SATELLITE_SOURCE_EVENTS_URL = f'{SATELLITE_SOURCE_BASE_URL}/events'
SATELLITE_HISTORY_LIMIT = 30
SATELLITE_RECORD_TABLE = 'satellite_sensor_records'
SATELLITE_DATA_SOURCE = 'gateway-http-10014'
SATELLITE_POLL_STOP = threading.Event()
SATELLITE_POLL_THREAD = None
LIVE_WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'
LIVE_WEATHER_VARIABLES = 'temperature_2m,relative_humidity_2m,surface_pressure'
LIVE_WEATHER_CACHE_TTL_SECONDS = max(60, int(os.getenv('LIVE_WEATHER_CACHE_TTL_SECONDS', '180')))
LIVE_CHART_HISTORY_HOURS = max(6, int(os.getenv('LIVE_CHART_HISTORY_HOURS', '24')))
LIVE_SENSOR_TABLE = 'live_sensor_snapshots'
LIVE_WEATHER_SOURCE = 'open-meteo'
NOISE_FALLBACK_SOURCE = 'simulated-fallback'
LIVE_DATA_SOURCE = 'live-weather'
DEFAULT_SN_CODE = 'gateway1'
WEATHER_CACHE = {}
WEATHER_CACHE_LOCK = threading.Lock()
RECENT_PAYLOAD_WINDOW_MINUTES = max(1, int(os.getenv('PROJECT20_RECENT_PAYLOAD_WINDOW_MINUTES', '1')))

# Some Windows Python environments map ".js" to "text/plain", which breaks
# <script type="module"> loading in browsers. Register explicit types here.
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')

# Access point configuration
ACCESS_POINTS = {
    'gateway1': {
        'name': '南京邮电大学物联网研究院',
        'location': '三牌楼校区',
        'lat': 32.0850,
        'lng': 118.7650,
        'weather_cell_selection': 'land',
    },
    'gateway2': {
        'name': '溧水',
        'location': '南京市溧水区',
        'lat': 31.6500,
        'lng': 119.0200,
        'weather_cell_selection': 'land',
    },
    'gateway3': {
        'name': '海南',
        'location': '海南省',
        'lat': 20.0200,
        'lng': 110.3500,
        'weather_cell_selection': 'land',
    },
    'gateway4': {
        'name': '渤海',
        'location': '渤海',
        'lat': 38.3000,
        'lng': 119.0000,
        'weather_cell_selection': 'sea',
    },
    'gateway5': {
        'name': '黄海',
        'location': '黄海',
        'lat': 35.0000,
        'lng': 123.5000,
        'weather_cell_selection': 'sea',
    }
}


def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def record_has_key(record, key):
    if record is None:
        return False
    if hasattr(record, 'keys'):
        return key in record.keys()
    if isinstance(record, dict):
        return key in record
    return False


def record_get(record, key, default=None):
    if record is None:
        return default
    if record_has_key(record, key):
        try:
            return record[key]
        except (KeyError, TypeError, IndexError):
            return default
    if isinstance(record, dict):
        return record.get(key, default)
    return default


def round_scaled_value(raw_value, divisor, digits):
    if raw_value is None:
        return None
    return round(raw_value / divisor, digits)


def build_scaled_raw(value, factor):
    if value is None:
        return None
    return int(round(float(value) * factor))


def normalize_payload_time(value):
    if not value:
        return None
    return str(value).replace('T', ' ')


def sqlite_datetime_expr(column_name):
    return f"datetime(substr({column_name} || ':00:00', 1, 19))"


def normalize_gateway_name(value):
    gateway = str(value or '').strip().lower().replace('_', '')
    if gateway.startswith('gw') and gateway[2:].isdigit():
        gateway = f'gateway{gateway[2:]}'
    if gateway in ACCESS_POINTS:
        return gateway
    return None


def normalize_satellite_timestamp(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) == 12 and text.isdigit():
        try:
            return datetime.strptime(text, '%y%m%d%H%M%S').strftime('%Y-%m-%d %H:%M:%S')
        except ValueError:
            return None
    return text


def gateway_number_from_name(gateway):
    normalized = normalize_gateway_name(gateway)
    if not normalized:
        return None
    return int(normalized[len('gateway'):])


def parse_satellite_sensor_fields(packet, content, gateway):
    """Extract the compact s/v fields while keeping old packets compatible."""
    sensor_type = str(
        packet.get('sensor_type') or content.get('s') or ''
    ).strip().upper()

    value_present = 'value' in packet or 'v' in content
    sensor_value = packet.get('value') if 'value' in packet else content.get('v')

    if not sensor_type and not value_present:
        raise ValueError('Satellite payload is missing s/sensor_type and v/value')

    gateway_number = gateway_number_from_name(gateway)
    if sensor_type == 'F':
        if gateway_number not in (1, 3):
            raise ValueError('Fire sensor F is only valid for gateway1 or gateway3')
        if isinstance(sensor_value, bool):
            fire_detected = sensor_value
        elif isinstance(sensor_value, str) and sensor_value.strip().lower() in ('true', 'false'):
            fire_detected = sensor_value.strip().lower() == 'true'
        else:
            raise ValueError('Fire sensor value must be true or false')
        return {
            'sensor_type': 'F',
            'sensor_value': 1 if fire_detected else 0,
            'fire_detected': 1 if fire_detected else 0,
            'wind_speed': None,
        }

    if sensor_type == 'WS':
        if gateway_number != 2:
            raise ValueError('Wind sensor WS is only valid for gateway2')
        if isinstance(sensor_value, bool) or not isinstance(sensor_value, (int, float)):
            raise ValueError('Wind sensor value must be numeric')
        wind_speed = float(sensor_value)
        if wind_speed < 0:
            raise ValueError('Wind speed cannot be negative')
        return {
            'sensor_type': 'WS',
            'sensor_value': wind_speed,
            'fire_detected': None,
            'wind_speed': wind_speed,
        }

    raise ValueError('Satellite sensor type must be F or WS')


def extract_satellite_records(payload):
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []

    for key in ('data', 'records', 'items', 'messages', 'result'):
        wrapped = payload.get(key)
        if isinstance(wrapped, list):
            return [item for item in wrapped if isinstance(item, dict)]
        if isinstance(wrapped, dict) and (
            wrapped.get('gateway') or wrapped.get('message_id')
        ):
            return [wrapped]

    if payload.get('gateway') or payload.get('message_id'):
        return [payload]
    return []


def build_satellite_record(packet):
    source_record_id = packet.get('_source_record_id')
    packet_for_storage = {
        key: value for key, value in packet.items() if not str(key).startswith('_')
    }
    content = packet.get('content') if isinstance(packet.get('content'), dict) else {}
    gateway = normalize_gateway_name(
        packet.get('gateway') or content.get('gateway') or content.get('g')
    )
    event_time = normalize_satellite_timestamp(
        packet.get('timestamp') or content.get('timestamp') or content.get('t')
    )
    server_received_at = normalize_satellite_timestamp(packet.get('server_received_timestamp'))
    if not gateway or not event_time or not server_received_at:
        return None

    message_id = str(packet.get('message_id') or '').strip()
    sequence = str(packet.get('sequence') or '').strip()
    terminal_id = str(packet.get('terminal_id') or '').strip()
    if not message_id:
        message_id = '|'.join((gateway, terminal_id, event_time, sequence))

    sensor_fields = parse_satellite_sensor_fields(packet, content, gateway)

    return {
        'gateway': gateway,
        'gateway_number': gateway_number_from_name(gateway),
        'source_record_id': source_record_id,
        'event_time': event_time,
        'server_received_at': server_received_at,
        'satellite_received_at': normalize_satellite_timestamp(
            packet.get('satellite_received_timestamp')
        ),
        'forwarded_at': normalize_satellite_timestamp(packet.get('forwarded_timestamp')),
        'terminal_id': terminal_id,
        'message_id': message_id,
        'sequence': sequence,
        'raw_content_hex': str(packet.get('raw_content_hex') or ''),
        'sensor_type': sensor_fields['sensor_type'],
        'sensor_value': sensor_fields['sensor_value'],
        'fire_detected': sensor_fields['fire_detected'],
        'wind_speed': sensor_fields['wind_speed'],
        'raw_payload_json': json.dumps(
            packet_for_storage, ensure_ascii=False, separators=(',', ':')
        ),
    }


def init_satellite_record_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        f'''
        CREATE TABLE IF NOT EXISTS {SATELLITE_RECORD_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_record_id INTEGER,
            message_id TEXT NOT NULL UNIQUE,
            event_time TEXT NOT NULL,
            sensor_type TEXT NOT NULL,
            sensor_value REAL NOT NULL,
            gateway_number INTEGER NOT NULL,
            gateway TEXT NOT NULL,
            fire_detected INTEGER,
            wind_speed REAL,
            satellite_received_at TEXT,
            server_received_at TEXT NOT NULL,
            forwarded_at TEXT,
            terminal_id TEXT,
            sequence TEXT,
            raw_content_hex TEXT,
            raw_payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    cursor.execute(
        f'''
        CREATE INDEX IF NOT EXISTS idx_{SATELLITE_RECORD_TABLE}_gateway_id
        ON {SATELLITE_RECORD_TABLE}(gateway, id DESC)
        '''
    )
    cursor.execute(
        f'''
        CREATE INDEX IF NOT EXISTS idx_{SATELLITE_RECORD_TABLE}_sensor_time
        ON {SATELLITE_RECORD_TABLE}(sensor_type, event_time DESC)
        '''
    )
    cursor.execute(
        f'''
        CREATE INDEX IF NOT EXISTS idx_{SATELLITE_RECORD_TABLE}_source_record
        ON {SATELLITE_RECORD_TABLE}(source_record_id DESC)
        '''
    )
    conn.commit()
    conn.close()


def get_satellite_resume_cursor():
    """Resume from the newest core-gateway record already committed locally."""
    conn = get_db_connection()
    row = conn.execute(
        f'SELECT MAX(source_record_id) AS max_id FROM {SATELLITE_RECORD_TABLE}'
    ).fetchone()
    conn.close()
    return int(row['max_id'] or 0) if row else 0


def save_satellite_records(records):
    normalized = []
    for packet in records:
        try:
            record = build_satellite_record(packet)
        except (TypeError, ValueError) as exc:
            message_id = packet.get('message_id') if isinstance(packet, dict) else None
            print(f'[10014] Skipped unsupported record message_id={message_id}: {exc}')
            continue
        if record:
            normalized.append(record)
    if not normalized:
        return 0

    conn = get_db_connection()
    cursor = conn.cursor()
    inserted = 0
    touched_gateways = set()
    for record in normalized:
        cursor.execute(
            f'''
            INSERT OR IGNORE INTO {SATELLITE_RECORD_TABLE} (
                source_record_id, message_id, event_time, sensor_type, sensor_value,
                gateway_number, gateway, fire_detected, wind_speed,
                satellite_received_at, server_received_at, forwarded_at,
                terminal_id, sequence, raw_content_hex, raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                record['source_record_id'], record['message_id'], record['event_time'],
                record['sensor_type'],
                record['sensor_value'], record['gateway_number'], record['gateway'],
                record['fire_detected'], record['wind_speed'],
                record['satellite_received_at'], record['server_received_at'],
                record['forwarded_at'], record['terminal_id'], record['sequence'],
                record['raw_content_hex'], record['raw_payload_json'],
            ),
        )
        if cursor.rowcount > 0:
            inserted += 1
        touched_gateways.add(record['gateway'])

    for gateway in touched_gateways:
        cursor.execute(
            f'''
            DELETE FROM {SATELLITE_RECORD_TABLE}
            WHERE gateway = ? AND id NOT IN (
                SELECT id FROM {SATELLITE_RECORD_TABLE}
                WHERE gateway = ?
                ORDER BY id DESC
                LIMIT ?
            )
            ''',
            (gateway, gateway, SATELLITE_HISTORY_LIMIT),
        )
    conn.commit()
    conn.close()
    return inserted


def satellite_poll_loop():
    event_cursor = None
    was_offline = False
    while not SATELLITE_POLL_STOP.is_set():
        try:
            if event_cursor is None:
                event_cursor = get_satellite_resume_cursor()
                print(f'[10014] Resume cursor: {event_cursor}')
            events_url = (
                f'{SATELLITE_SOURCE_EVENTS_URL}?'
                + urlencode({'after_id': event_cursor})
            )
            source_request = Request(
                events_url,
                headers={
                    'Accept': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'User-Agent': 'leo-satellite-platform/1.0',
                },
            )
            with urlopen(source_request, timeout=30.0) as response:
                data_lines = []
                pending_event_id = None
                for raw_line in response:
                    if SATELLITE_POLL_STOP.is_set():
                        return
                    line = raw_line.decode('utf-8', errors='replace').rstrip('\r\n')
                    if not line:
                        if data_lines:
                            payload = json.loads('\n'.join(data_lines))
                            records = extract_satellite_records(payload)
                            if pending_event_id is not None:
                                records = [
                                    dict(record, _source_record_id=pending_event_id)
                                    for record in records
                                ]
                            save_satellite_records(records)
                            if pending_event_id is not None:
                                event_cursor = max(event_cursor, pending_event_id)
                            data_lines = []
                            pending_event_id = None
                        continue
                    if line.startswith('id:'):
                        pending_event_id = int(line[3:].strip())
                    if line.startswith('data:'):
                        data_lines.append(line[5:].lstrip())
            if was_offline:
                print(f'[10014] SSE reconnected: {events_url}')
            was_offline = False
        except Exception as exc:
            if not was_offline:
                print(f'[10014] SSE unavailable: {exc}')
            was_offline = True
        SATELLITE_POLL_STOP.wait(1.0)


def start_satellite_polling():
    global SATELLITE_POLL_THREAD
    init_satellite_record_table()
    print('[database] Existing satellite records preserved')
    if SATELLITE_POLL_THREAD and SATELLITE_POLL_THREAD.is_alive():
        return
    SATELLITE_POLL_STOP.clear()
    SATELLITE_POLL_THREAD = threading.Thread(
        target=satellite_poll_loop,
        name='satellite-http-10014-poller',
        daemon=True,
    )
    SATELLITE_POLL_THREAD.start()


def stop_satellite_polling():
    SATELLITE_POLL_STOP.set()
    thread = SATELLITE_POLL_THREAD
    if thread and thread.is_alive():
        thread.join(timeout=SATELLITE_SOURCE_TIMEOUT_SECONDS + 1.0)


def get_satellite_rows(gateway, limit=SATELLITE_HISTORY_LIMIT):
    safe_gateway = normalize_gateway_name(gateway) or DEFAULT_SN_CODE
    safe_limit = max(1, min(int(limit), SATELLITE_HISTORY_LIMIT))
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        f'''
        SELECT * FROM {SATELLITE_RECORD_TABLE}
        WHERE gateway = ?
        ORDER BY id DESC
        LIMIT ?
        ''',
        (safe_gateway, safe_limit),
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def format_satellite_data(record):
    gateway = record_get(record, 'gateway', DEFAULT_SN_CODE)
    fire_value = record_get(record, 'fire_detected')
    return {
        'id': record_get(record, 'id'),
        'source_record_id': record_get(record, 'source_record_id'),
        'sn_code': gateway,
        'gateway': gateway,
        'gateway_number': record_get(record, 'gateway_number'),
        'recv_time': record_get(record, 'server_received_at'),
        'create_time': record_get(record, 'server_received_at'),
        'msg_id': record_get(record, 'message_id'),
        'message_id': record_get(record, 'message_id'),
        'payload_time': record_get(record, 'event_time'),
        'source_time': record_get(record, 'event_time'),
        'satellite_received_timestamp': record_get(record, 'satellite_received_at'),
        'forwarded_timestamp': record_get(record, 'forwarded_at'),
        'terminal_id': record_get(record, 'terminal_id'),
        'sequence': record_get(record, 'sequence'),
        'raw_hex': record_get(record, 'raw_content_hex'),
        'sensor_type': record_get(record, 'sensor_type'),
        'sensor_value': record_get(record, 'sensor_value'),
        'fire_detected': bool(fire_value) if fire_value is not None else None,
        'wind_speed': record_get(record, 'wind_speed'),
        'wind_speed_unit': 'm/s' if record_get(record, 'wind_speed') is not None else None,
        'ch1_raw': 0,
        'ch2_raw': None,
        'ch3_raw': None,
        'ch4_raw': None,
        'temperature': 0.0,
        'humidity': None,
        'pressure': None,
        'noise': None,
        'access_point': gateway,
        'data_source': SATELLITE_DATA_SOURCE,
        'weather_source': 'unavailable',
        'noise_source': 'unavailable',
    }


def build_open_meteo_query(config):
    query = {
        'latitude': config['lat'],
        'longitude': config['lng'],
        'current': LIVE_WEATHER_VARIABLES,
        'hourly': LIVE_WEATHER_VARIABLES,
        'past_hours': LIVE_CHART_HISTORY_HOURS,
        'forecast_hours': 0,
        'timezone': 'auto',
        'cell_selection': config.get('weather_cell_selection', 'land'),
    }
    return f'{LIVE_WEATHER_API_URL}?{urlencode(query)}'


def fetch_open_meteo_payload(sn_code):
    config = ACCESS_POINTS.get(sn_code)
    if not config:
        raise ValueError(f'Unknown access point: {sn_code}')

    now = time.time()
    with WEATHER_CACHE_LOCK:
        cached = WEATHER_CACHE.get(sn_code)
        if cached and now - cached['fetched_at'] < LIVE_WEATHER_CACHE_TTL_SECONDS:
            return cached['payload']

    request_url = build_open_meteo_query(config)
    request = Request(request_url, headers={'User-Agent': 'project2-0-live-weather/1.0'})
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode('utf-8'))

    current_payload = payload.get('current') or {}
    if current_payload.get('time') is None:
        raise ValueError(f'Weather API returned no current data for {sn_code}')

    with WEATHER_CACHE_LOCK:
        WEATHER_CACHE[sn_code] = {'fetched_at': now, 'payload': payload}
    return payload


def get_access_point_config(sn_code):
    return ACCESS_POINTS.get(sn_code, ACCESS_POINTS[DEFAULT_SN_CODE])


def get_latest_simulated_row(sn_code):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT * FROM sensor_logs
        WHERE sn_code = ?
        ORDER BY payload_time DESC, id DESC
        LIMIT 1
        ''',
        (sn_code,),
    )
    row = cursor.fetchone()
    conn.close()
    return row


def build_live_snapshot_record(sn_code, payload, simulated_noise_row=None):
    current = payload.get('current') or {}
    source_time = current.get('time')
    temperature = current.get('temperature_2m')
    humidity = current.get('relative_humidity_2m')
    surface_pressure_hpa = current.get('surface_pressure')
    pressure_kpa = round(surface_pressure_hpa / 10, 2) if surface_pressure_hpa is not None else None
    ch4 = record_get(simulated_noise_row, 'ch4')
    noise_source = NOISE_FALLBACK_SOURCE if ch4 is not None else 'unavailable'
    recv_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    compact_source_time = str(source_time).replace('-', '').replace(':', '').replace('T', '')

    return {
        'sn_code': sn_code,
        'recv_time': recv_time,
        'msg_id': f'live-{sn_code}-{compact_source_time}',
        'payload_time': normalize_payload_time(source_time),
        'source_time': source_time,
        'raw_hex': f'OPEN_METEO|T={temperature}|H={humidity}|P={surface_pressure_hpa}',
        'ch1': build_scaled_raw(temperature, 100),
        'ch2': build_scaled_raw(humidity, 100),
        'ch3': build_scaled_raw(pressure_kpa, 100),
        'ch4': ch4,
        'data_source': LIVE_DATA_SOURCE,
        'weather_source': LIVE_WEATHER_SOURCE,
        'noise_source': noise_source,
    }


def save_live_snapshot(snapshot):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        f'''
        INSERT INTO {LIVE_SENSOR_TABLE} (
            sn_code,
            recv_time,
            msg_id,
            payload_time,
            source_time,
            raw_hex,
            ch1,
            ch2,
            ch3,
            ch4,
            data_source,
            weather_source,
            noise_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sn_code, source_time) DO UPDATE SET
            recv_time = excluded.recv_time,
            msg_id = excluded.msg_id,
            raw_hex = excluded.raw_hex,
            ch1 = excluded.ch1,
            ch2 = excluded.ch2,
            ch3 = excluded.ch3,
            ch4 = excluded.ch4,
            data_source = excluded.data_source,
            weather_source = excluded.weather_source,
            noise_source = excluded.noise_source
        ''',
        (
            snapshot['sn_code'],
            snapshot['recv_time'],
            snapshot['msg_id'],
            snapshot['payload_time'],
            snapshot['source_time'],
            snapshot['raw_hex'],
            snapshot['ch1'],
            snapshot['ch2'],
            snapshot['ch3'],
            snapshot['ch4'],
            snapshot['data_source'],
            snapshot['weather_source'],
            snapshot['noise_source'],
        ),
    )
    conn.commit()
    conn.close()


def get_live_snapshot_rows(sn_code, limit=2):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        f'''
        SELECT * FROM {LIVE_SENSOR_TABLE}
        WHERE sn_code = ?
        ORDER BY payload_time DESC, id DESC
        LIMIT ?
        ''',
        (sn_code, limit),
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def ensure_live_snapshot(sn_code):
    live_error = None
    try:
        weather_payload = fetch_open_meteo_payload(sn_code)
        snapshot = build_live_snapshot_record(sn_code, weather_payload, get_latest_simulated_row(sn_code))
        save_live_snapshot(snapshot)
    except Exception as exc:
        live_error = exc

    rows = get_live_snapshot_rows(sn_code, limit=2)
    if rows:
        return rows, live_error
    return [], live_error


def format_sensor_data(record):
    ch1 = record_get(record, 'ch1')
    ch2 = record_get(record, 'ch2')
    ch3 = record_get(record, 'ch3')
    ch4 = record_get(record, 'ch4')
    sn_code = record_get(record, 'sn_code', DEFAULT_SN_CODE)

    return {
        'id': record_get(record, 'id'),
        'sn_code': sn_code,
        'recv_time': record_get(record, 'recv_time'),
        'msg_id': record_get(record, 'msg_id'),
        'payload_time': record_get(record, 'payload_time'),
        'source_time': record_get(record, 'source_time', record_get(record, 'payload_time')),
        'raw_hex': record_get(record, 'raw_hex'),
        'ch1_raw': ch1,
        'ch2_raw': ch2,
        'ch3_raw': ch3,
        'ch4_raw': ch4,
        'temperature': round_scaled_value(ch1, 100, 2),
        'humidity': round_scaled_value(ch2, 100, 2),
        'pressure': round_scaled_value(ch3, 100, 2),
        'noise': round_scaled_value(ch4, 10, 1),
        'access_point': sn_code,
        'data_source': record_get(record, 'data_source', 'simulated'),
        'weather_source': record_get(record, 'weather_source', 'simulated'),
        'noise_source': record_get(record, 'noise_source', 'simulated'),
    }


def enrich_sensor_payload(data, sn_code):
    ap_config = get_access_point_config(sn_code)
    if data is None:
        return None
    data['access_point_name'] = ap_config.get('name', '未知接入点')
    data['access_point_location'] = ap_config.get('location', '未知位置')
    data['weather_provider_label'] = '卫星网关 HTTP 10014'
    data['noise_provider_label'] = '当前数据报未提供温度，暂按 0℃ 展示'
    return data


def get_simulated_rows(sn_code, limit=2):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT * FROM sensor_logs
        WHERE sn_code = ?
        ORDER BY payload_time DESC, id DESC
        LIMIT ?
        ''',
        (sn_code, limit),
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def build_simulated_fallback_response(sn_code, live_error=None):
    rows = get_simulated_rows(sn_code, limit=2)
    if not rows:
        return None

    latest = format_sensor_data(rows[0])
    latest['data_source'] = 'simulated-fallback'
    latest['weather_source'] = 'simulated-fallback'
    latest['noise_source'] = 'simulated-fallback'
    if live_error:
        latest['live_error'] = str(live_error)
    enrich_sensor_payload(latest, sn_code)

    response_data = {'success': True, 'data': latest}
    if len(rows) > 1:
        previous = format_sensor_data(rows[1])
        previous['data_source'] = 'simulated-fallback'
        previous['weather_source'] = 'simulated-fallback'
        previous['noise_source'] = 'simulated-fallback'
        response_data['previous_data'] = previous
    return response_data


def build_live_chart_rows(sn_code, limit):
    weather_payload = fetch_open_meteo_payload(sn_code)
    latest_rows, _ = ensure_live_snapshot(sn_code)
    live_rows_by_source_time = {
        record_get(row, 'source_time'): format_sensor_data(row)
        for row in get_live_snapshot_rows(sn_code, limit=max(limit * 2, 8))
    }

    hourly = weather_payload.get('hourly') or {}
    times = hourly.get('time') or []
    temperatures = hourly.get('temperature_2m') or []
    humidities = hourly.get('relative_humidity_2m') or []
    pressures_hpa = hourly.get('surface_pressure') or []

    points = []
    hourly_points = list(zip(times, temperatures, humidities, pressures_hpa))
    take_count = max(0, limit - 1)
    for source_time, temperature, humidity, surface_pressure_hpa in hourly_points[-take_count:]:
        live_row = live_rows_by_source_time.get(source_time)
        payload = format_sensor_data(
            {
                'sn_code': sn_code,
                'recv_time': normalize_payload_time(source_time),
                'msg_id': f'hourly-{sn_code}-{str(source_time).replace("-", "").replace(":", "").replace("T", "")}',
                'payload_time': normalize_payload_time(source_time),
                'source_time': source_time,
                'raw_hex': f'OPEN_METEO_HOURLY|T={temperature}|H={humidity}|P={surface_pressure_hpa}',
                'ch1': build_scaled_raw(temperature, 100),
                'ch2': build_scaled_raw(humidity, 100),
                'ch3': build_scaled_raw((surface_pressure_hpa / 10) if surface_pressure_hpa is not None else None, 100),
                'ch4': live_row['ch4_raw'] if live_row else None,
                'data_source': LIVE_DATA_SOURCE,
                'weather_source': LIVE_WEATHER_SOURCE,
                'noise_source': live_row['noise_source'] if live_row else 'unavailable',
            }
        )
        points.append(enrich_sensor_payload(payload, sn_code))

    if latest_rows:
        latest = enrich_sensor_payload(format_sensor_data(latest_rows[0]), sn_code)
        if not points or points[-1]['source_time'] != latest['source_time']:
            points.append(latest)

    return points[-limit:]


# ==================== 闂堟瑦鈧焦鏋冩禒鎯扮熅閻?====================

@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response

@app.route('/')
def index():
    return send_from_directory(WEB_ROOT, 'index.html')


@app.route('/index.html')
def serve_index_html():
    return send_from_directory(WEB_ROOT, 'index.html')


@app.route('/assets/<path:filename>')
def serve_assets(filename):
    lower_name = filename.lower()
    if lower_name.endswith('.js'):
        return send_from_directory(ASSETS_ROOT, filename, mimetype='application/javascript')
    if lower_name.endswith('.css'):
        return send_from_directory(ASSETS_ROOT, filename, mimetype='text/css')
    return send_from_directory(ASSETS_ROOT, filename)


# ==================== API 鐠烘暠 ====================

@app.route('/api/access_points')
def get_access_points():
    points = []
    for sn_code, config in ACCESS_POINTS.items():
        points.append({
            'sn_code': sn_code,
            'name': config['name'],
            'location': config['location'],
            'lat': config.get('lat'),
            'lng': config.get('lng')
        })
    return jsonify({
        'success': True,
        'data': sorted(points, key=lambda x: x['sn_code'])
    })


@app.route('/api/latest')
def get_latest():
    try:
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE
        rows = get_satellite_rows(sn_code, limit=2)

        if rows:
            data = enrich_sensor_payload(format_satellite_data(rows[0]), sn_code)
            response_data = {'success': True, 'data': data}
            if len(rows) > 1:
                response_data['previous_data'] = enrich_sensor_payload(format_satellite_data(rows[1]), sn_code)
            return jsonify(response_data)
        return jsonify({'success': False, 'message': '未找到数据'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/incremental')
def get_incremental():
    try:
        since_id = request.args.get('since_id', 0, type=int)
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            f'''
            SELECT * FROM {SATELLITE_RECORD_TABLE}
            WHERE id > ? AND gateway = ?
            ORDER BY id ASC
            LIMIT ?
            ''',
            (since_id, sn_code, SATELLITE_HISTORY_LIMIT),
        )
        rows = cursor.fetchall()
        data = [format_satellite_data(row) for row in rows]
        max_id = max([d['id'] for d in data if d.get('id') is not None], default=since_id)
        cursor.execute(
            f'''
            SELECT * FROM {SATELLITE_RECORD_TABLE}
            WHERE gateway = ?
            ORDER BY id DESC
            LIMIT 1
            ''',
            (sn_code,),
        )
        latest_row = cursor.fetchone()
        conn.close()

        latest_data = enrich_sensor_payload(format_satellite_data(latest_row), sn_code) if latest_row else None
        return jsonify({
            'success': True,
            'data': [enrich_sensor_payload(item, sn_code) for item in data],
            'max_id': max_id,
            'count': len(data),
            'latest': latest_data
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/chart')
def get_chart_data():
    try:
        limit = request.args.get('limit', SATELLITE_HISTORY_LIMIT, type=int)
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE
        rows = get_satellite_rows(sn_code, limit=limit)

        data = [enrich_sensor_payload(format_satellite_data(row), sn_code) for row in reversed(rows)]
        return jsonify({'success': True, 'data': data})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/all')
def get_all_data():
    try:
        page = request.args.get('page', 1, type=int)
        size = request.args.get('size', 10, type=int)
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE
        size = max(1, min(size, SATELLITE_HISTORY_LIMIT))
        
        offset = (page - 1) * size
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            f'SELECT COUNT(*) FROM {SATELLITE_RECORD_TABLE} WHERE gateway = ?',
            (sn_code,),
        )
        total = cursor.fetchone()[0]
        
        cursor.execute(f'''
            SELECT * FROM {SATELLITE_RECORD_TABLE}
            WHERE gateway = ?
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        ''', (sn_code, size, offset))
        rows = cursor.fetchall()
        conn.close()
        
        data = [enrich_sensor_payload(format_satellite_data(row), sn_code) for row in rows]
        
        return jsonify({
            'success': True,
            'data': data,
            'pagination': {
                'page': page,
                'size': size,
                'total': total,
                'totalPages': (total + size - 1) // size if total > 0 else 1
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500



@app.route('/api/stats')
def get_stats():
    try:
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            f'''
            SELECT
                COUNT(*) as total_records,
                MIN(event_time) as first_record_time,
                MAX(event_time) as last_record_time,
                SUM(CASE WHEN sensor_type = 'F' THEN 1 ELSE 0 END) as fire_records,
                SUM(CASE WHEN sensor_type = 'F' AND fire_detected = 1 THEN 1 ELSE 0 END) as fire_alarm_records,
                AVG(CASE WHEN sensor_type = 'WS' THEN wind_speed END) as avg_wind_speed
            FROM {SATELLITE_RECORD_TABLE}
            WHERE gateway = ?
            ''',
            (sn_code,),
        )
        row = cursor.fetchone()
        conn.close()

        if row and row['total_records'] > 0:
            ap_config = ACCESS_POINTS.get(sn_code, {})
            return jsonify({
                'success': True,
                'data': {
                    'sn_code': sn_code,
                    'access_point_name': ap_config.get('name', '南京邮电大学物联网研究院'),
                    'access_point_location': ap_config.get('location', '物联网国家大学科技园'),
                    'total_records': row['total_records'],
                    'first_record_time': row['first_record_time'],
                    'last_record_time': row['last_record_time'],
                    'avg_temperature': None,
                    'avg_humidity': None,
                    'avg_pressure': None,
                    'avg_noise': None,
                    'fire_records': row['fire_records'],
                    'fire_alarm_records': row['fire_alarm_records'],
                    'avg_wind_speed': round(row['avg_wind_speed'], 1) if row['avg_wind_speed'] is not None else None,
                    'data_source': SATELLITE_DATA_SOURCE,
                }
            })
        return jsonify({'success': False, 'message': '未找到数据'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== Layout Synchronization API ====================

def init_live_sensor_tables():
    """Ensure live weather snapshot tables exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        f'''
        CREATE TABLE IF NOT EXISTS {LIVE_SENSOR_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sn_code TEXT NOT NULL,
            recv_time TEXT NOT NULL,
            msg_id TEXT,
            payload_time TEXT NOT NULL,
            source_time TEXT NOT NULL,
            raw_hex TEXT,
            ch1 INTEGER,
            ch2 INTEGER,
            ch3 INTEGER,
            ch4 INTEGER,
            data_source TEXT NOT NULL DEFAULT '{LIVE_DATA_SOURCE}',
            weather_source TEXT,
            noise_source TEXT
        )
        '''
    )
    cursor.execute(
        f'''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_{LIVE_SENSOR_TABLE}_sn_source_time
        ON {LIVE_SENSOR_TABLE}(sn_code, source_time)
        '''
    )
    cursor.execute(
        f'''
        CREATE INDEX IF NOT EXISTS idx_{LIVE_SENSOR_TABLE}_sn_payload_time
        ON {LIVE_SENSOR_TABLE}(sn_code, payload_time DESC)
        '''
    )
    cursor.execute(
        f'''
        CREATE INDEX IF NOT EXISTS idx_{LIVE_SENSOR_TABLE}_sn_id
        ON {LIVE_SENSOR_TABLE}(sn_code, id DESC)
        '''
    )
    conn.commit()
    conn.close()


def init_layout_tables():
    """Ensure layout tables exist."""
    os.makedirs(LAYOUT_BACKUP_DIR, exist_ok=True)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS graph_layout (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS graph_layout_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_graph_layout_history_key_created_at ON graph_layout_history(key, created_at DESC)')
    conn.commit()
    conn.close()


def prune_layout_backups():
    """Keep only the newest layout backup files on disk."""
    if LAYOUT_BACKUP_RETENTION < 1 or not os.path.isdir(LAYOUT_BACKUP_DIR):
        return

    backup_files = []
    for entry in os.scandir(LAYOUT_BACKUP_DIR):
        if not entry.is_file() or not entry.name.endswith('.json'):
            continue
        backup_files.append((entry.stat().st_mtime, entry.name, entry.path))

    if len(backup_files) <= LAYOUT_BACKUP_RETENTION:
        return

    backup_files.sort(reverse=True)
    for _, _, file_path in backup_files[LAYOUT_BACKUP_RETENTION:]:
        try:
            os.remove(file_path)
        except FileNotFoundError:
            continue


def ensure_layout_image_dir():
    os.makedirs(LAYOUT_IMAGE_DIR, exist_ok=True)


def save_layout_image(file_storage):
    original_name = str(getattr(file_storage, 'filename', '') or '').strip()
    _, ext = os.path.splitext(original_name)
    normalized_ext = ext.lower()
    if normalized_ext not in ALLOWED_LAYOUT_IMAGE_EXTENSIONS:
        raise ValueError('Unsupported image type')

    ensure_layout_image_dir()
    filename = f'layout_img_{uuid.uuid4().hex}{normalized_ext}'
    absolute_path = os.path.join(LAYOUT_IMAGE_DIR, filename)
    file_storage.save(absolute_path)
    return f'{LAYOUT_IMAGE_PREFIX}/{filename}'

# Initialize tables on startup
try:
    init_layout_tables()
    ensure_layout_image_dir()
    prune_layout_backups()
    print("Layout tables initialized.")
except Exception as e:
    print(f"Error initializing layout tables: {e}")


@app.route('/api/layout', methods=['GET'])
def get_layout():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT value FROM graph_layout WHERE key = ?', ('architecture_graph',))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return jsonify({'success': True, 'data': json.loads(row['value'])})
        else:
            return jsonify({'success': True, 'data': None}) # No saved layout yet
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/layout', methods=['POST'])
def save_layout():
    try:
        data = request.json
        if not data:
            return jsonify({'success': False, 'message': 'No data provided'}), 400
            
        json_str = json.dumps(data)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        layout_key = 'architecture_graph'

        cursor.execute('SELECT value FROM graph_layout WHERE key = ?', (layout_key,))
        existing = cursor.fetchone()
        existing_value = existing['value'] if existing else None

        # Save previous value into history before overwrite.
        if existing_value and existing_value != json_str:
            cursor.execute('INSERT INTO graph_layout_history (key, value) VALUES (?, ?)', (layout_key, existing_value))

        # Upsert logic (SQLite specific)
        cursor.execute('''
            INSERT INTO graph_layout (key, value, updated_at) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
        ''', (layout_key, json_str))
        conn.commit()
        conn.close()

        # File backup for easier manual rollback.
        ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        backup_path = os.path.join(LAYOUT_BACKUP_DIR, f'architecture_graph_{ts}.json')
        with open(backup_path, 'w', encoding='utf-8') as backup_file:
            backup_file.write(json_str)
        prune_layout_backups()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/layout/upload-image', methods=['POST'])
def upload_layout_image():
    try:
        uploaded_file = request.files.get('file')
        if uploaded_file is None:
            return jsonify({'success': False, 'message': 'Missing file'}), 400
        if not uploaded_file.filename:
            return jsonify({'success': False, 'message': 'Empty filename'}), 400

        image_url = save_layout_image(uploaded_file)
        return jsonify({'success': True, 'image_url': image_url})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'message': str(exc)}), 500


@app.route('/api/layout/history', methods=['GET'])
def get_layout_history():
    try:
        limit = request.args.get('limit', default=20, type=int)
        if limit is None or limit <= 0:
            limit = 20
        limit = min(limit, 200)

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, key, created_at FROM graph_layout_history WHERE key = ? ORDER BY id DESC LIMIT ?',
            ('architecture_graph', limit)
        )
        rows = cursor.fetchall()
        conn.close()

        history = [{'id': row['id'], 'key': row['key'], 'created_at': row['created_at']} for row in rows]
        return jsonify({'success': True, 'data': history})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/layout/restore', methods=['POST'])
def restore_layout_from_history():
    try:
        payload = request.json or {}
        history_id = payload.get('id')
        if not history_id:
            return jsonify({'success': False, 'message': 'Missing history id'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT value FROM graph_layout_history WHERE id = ? AND key = ?', (history_id, 'architecture_graph'))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({'success': False, 'message': 'History item not found'}), 404

        restore_value = row['value']
        cursor.execute(
            '''
            INSERT INTO graph_layout (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
            ''',
            ('architecture_graph', restore_value)
        )
        conn.commit()
        conn.close()

        ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        backup_path = os.path.join(LAYOUT_BACKUP_DIR, f'architecture_graph_restored_{ts}.json')
        with open(backup_path, 'w', encoding='utf-8') as backup_file:
            backup_file.write(restore_value)
        prune_layout_backups()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


if __name__ == '__main__':
    print("=" * 50)
    print("Server starting")
    print("=" * 50)
    print(f"Database: {DATABASE}")
    print(f"Access points: {len(ACCESS_POINTS)}")
    for sn, config in ACCESS_POINTS.items():
        print(f"  - {sn}: {config['name']} ({config['location']})")
    print(f"Base URL: http://localhost:{BACKEND_PORT}")
    print(f"Satellite source: {SATELLITE_SOURCE_BASE_URL}")
    print(f"History limit: {SATELLITE_HISTORY_LIMIT} per gateway")
    print("=" * 50)
    print()
    start_satellite_polling()

    try:
        app.run(debug=True, host='0.0.0.0', port=BACKEND_PORT, use_reloader=False)
    finally:
        stop_satellite_polling()
