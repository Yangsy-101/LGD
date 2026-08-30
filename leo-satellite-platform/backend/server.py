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
DATABASE = os.path.abspath(os.getenv(
    'PROJECT20_DATABASE',
    os.path.join(DATA_ROOT, 'satellite_data.db'),
))
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
LEGACY_ENVIRONMENT_RECORD_TABLE = 'sensor_logs'
SATELLITE_DATA_SOURCE = 'gateway-http-10014'
SATELLITE_POLL_STOP = threading.Event()
SATELLITE_POLL_THREAD = None
SATELLITE_LINK_LOCK = threading.Lock()
SATELLITE_LINK_STATE = {
    'source_online': False,
    'connected_at': None,
    'last_event_at': None,
    'last_error': None,
}
DEFAULT_SN_CODE = 'gateway1'
SUPPORTED_INGEST_GATEWAYS = {'gateway1', 'gateway2', 'gateway3'}
RECENT_PAYLOAD_WINDOW_MINUTES = max(1, int(os.getenv('PROJECT20_RECENT_PAYLOAD_WINDOW_MINUTES', '1')))

# Some Windows Python environments map ".js" to "text/plain", which breaks
# <script type="module"> loading in browsers. Register explicit types here.
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')

# Access point configuration
ACCESS_POINTS = {
    'gateway1': {
        'name': '溧水森林监测站',
        'short_name': '溧水',
        'location': '南京 · 溧水林区',
        'scene': 'forest',
        'scene_name': '森林防火',
        'sensor_type': 'F',
        'scene_order': 1,
        'lat': 31.6500,
        'lng': 119.0200,
    },
    'gateway2': {
        'name': '海南远洋监测站',
        'short_name': '海南',
        'location': '海南 · 海口',
        'scene': 'ocean',
        'scene_name': '远洋远域',
        'sensor_type': 'WS',
        'scene_order': 2,
        'lat': 20.0440,
        'lng': 110.1999,
    },
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


def sqlite_datetime_expr(column_name):
    return f"datetime(substr({column_name} || ':00:00', 1, 19))"


def normalize_gateway_name(value):
    gateway = str(value or '').strip().lower().replace('_', '')
    if gateway.startswith('gw') and gateway[2:].isdigit():
        gateway = f'gateway{gateway[2:]}'
    if gateway in SUPPORTED_INGEST_GATEWAYS:
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
            'temperature': None,
            'humidity': None,
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
            'temperature': None,
            'humidity': None,
        }

    if sensor_type == 'TH':
        if gateway_number != 1:
            raise ValueError('Temperature/humidity sensor TH is only valid for gateway1')
        if not isinstance(sensor_value, dict):
            raise ValueError('Temperature/humidity sensor value must be an object')
        temperature = sensor_value.get('tp')
        humidity = sensor_value.get('rh')
        if (
            isinstance(temperature, bool)
            or not isinstance(temperature, (int, float))
            or isinstance(humidity, bool)
            or not isinstance(humidity, (int, float))
        ):
            raise ValueError('TH value must contain numeric tp and rh fields')
        temperature = float(temperature)
        humidity = float(humidity)
        if not -50 <= temperature <= 100:
            raise ValueError('TH temperature must be between -50 and 100 degrees Celsius')
        if not 0 <= humidity <= 100:
            raise ValueError('TH humidity must be between 0 and 100 percent')
        return {
            'sensor_type': 'TH',
            # Keep the legacy non-null scalar column populated for old databases.
            'sensor_value': temperature,
            'fire_detected': None,
            'wind_speed': None,
            'temperature': temperature,
            'humidity': humidity,
        }

    raise ValueError('Satellite sensor type must be F, WS or TH')


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
        'temperature': sensor_fields['temperature'],
        'humidity': sensor_fields['humidity'],
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
            temperature REAL,
            humidity REAL,
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
    existing_columns = {
        row['name'] for row in cursor.execute(
            f'PRAGMA table_info({SATELLITE_RECORD_TABLE})'
        ).fetchall()
    }
    for column_name in ('temperature', 'humidity'):
        if column_name not in existing_columns:
            cursor.execute(
                f'ALTER TABLE {SATELLITE_RECORD_TABLE} ADD COLUMN {column_name} REAL'
            )
    cursor.execute(
        f'''
        CREATE INDEX IF NOT EXISTS idx_{SATELLITE_RECORD_TABLE}_gateway_sensor_id
        ON {SATELLITE_RECORD_TABLE}(gateway, sensor_type, id DESC)
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
        record = build_satellite_record(packet)
        if record is None:
            message_id = packet.get('message_id') if isinstance(packet, dict) else None
            raise ValueError(f'Incomplete satellite record message_id={message_id}')
        normalized.append(record)
    if not normalized:
        return 0

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        inserted = 0
        touched_streams = set()
        for record in normalized:
            cursor.execute(
                f'''
                INSERT OR IGNORE INTO {SATELLITE_RECORD_TABLE} (
                    source_record_id, message_id, event_time, sensor_type, sensor_value,
                    gateway_number, gateway, fire_detected, wind_speed, temperature, humidity,
                    satellite_received_at, server_received_at, forwarded_at,
                    terminal_id, sequence, raw_content_hex, raw_payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    record['source_record_id'], record['message_id'], record['event_time'],
                    record['sensor_type'], record['sensor_value'],
                    record['gateway_number'], record['gateway'],
                    record['fire_detected'], record['wind_speed'],
                    record['temperature'], record['humidity'],
                    record['satellite_received_at'], record['server_received_at'],
                    record['forwarded_at'], record['terminal_id'], record['sequence'],
                    record['raw_content_hex'], record['raw_payload_json'],
                ),
            )
            if cursor.rowcount > 0:
                inserted += 1
            touched_streams.add((record['gateway'], record['sensor_type']))

        for gateway, sensor_type in touched_streams:
            cursor.execute(
                f'''
                DELETE FROM {SATELLITE_RECORD_TABLE}
                WHERE gateway = ? AND sensor_type = ? AND id NOT IN (
                    SELECT id FROM {SATELLITE_RECORD_TABLE}
                    WHERE gateway = ? AND sensor_type = ?
                    ORDER BY id DESC
                    LIMIT ?
                )
                ''',
                (gateway, sensor_type, gateway, sensor_type, SATELLITE_HISTORY_LIMIT),
            )
        conn.commit()
        return inserted
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


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
                with SATELLITE_LINK_LOCK:
                    SATELLITE_LINK_STATE.update({
                        'source_online': True,
                        'connected_at': datetime.now().astimezone().isoformat(timespec='seconds'),
                        'last_error': None,
                    })
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
                            if not records:
                                raise ValueError(
                                    f'SSE event id={pending_event_id} contains no satellite records'
                                )
                            if pending_event_id is not None:
                                records = [
                                    dict(record, _source_record_id=pending_event_id)
                                    for record in records
                                ]
                            save_satellite_records(records)
                            with SATELLITE_LINK_LOCK:
                                SATELLITE_LINK_STATE['last_event_at'] = (
                                    datetime.now().astimezone().isoformat(timespec='seconds')
                                )
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
            with SATELLITE_LINK_LOCK:
                SATELLITE_LINK_STATE.update({
                    'source_online': False,
                    'last_error': str(exc),
                })
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


def get_satellite_rows(gateway, limit=SATELLITE_HISTORY_LIMIT, sensor_type=None):
    safe_gateway = normalize_gateway_name(gateway) or DEFAULT_SN_CODE
    safe_limit = max(1, min(int(limit), SATELLITE_HISTORY_LIMIT))
    conn = get_db_connection()
    cursor = conn.cursor()
    if sensor_type:
        cursor.execute(
            f'''
            SELECT * FROM {SATELLITE_RECORD_TABLE}
            WHERE gateway = ? AND sensor_type = ?
            ORDER BY id DESC
            LIMIT ?
            ''',
            (safe_gateway, str(sensor_type).upper(), safe_limit),
        )
    else:
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


def get_legacy_environment_rows(limit=SATELLITE_HISTORY_LIMIT):
    """Read the original forest temperature/humidity rows as a display fallback."""
    safe_limit = max(1, min(int(limit), SATELLITE_HISTORY_LIMIT))
    conn = get_db_connection()
    try:
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (LEGACY_ENVIRONMENT_RECORD_TABLE,),
        ).fetchone()
        if not table_exists:
            return []
        return conn.execute(
            f'''
            SELECT * FROM {LEGACY_ENVIRONMENT_RECORD_TABLE}
            WHERE sn_code = ? AND ch1 IS NOT NULL AND ch2 IS NOT NULL
            ORDER BY payload_time DESC, id DESC
            LIMIT ?
            ''',
            ('14196', safe_limit),
        ).fetchall()
    finally:
        conn.close()


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
        'temperature': record_get(record, 'temperature'),
        'humidity': record_get(record, 'humidity'),
        'pressure': None,
        'noise': None,
        'access_point': gateway,
        'data_source': SATELLITE_DATA_SOURCE,
        'weather_source': 'unavailable',
        'noise_source': 'unavailable',
    }


def format_legacy_environment_data(record, gateway=DEFAULT_SN_CODE):
    """Map the original ch1/ch2 representation to the current TH API shape."""
    ch1 = record_get(record, 'ch1')
    ch2 = record_get(record, 'ch2')
    message_id = record_get(record, 'msg_id')
    data = {
        'id': record_get(record, 'id'),
        'source_record_id': None,
        'sn_code': gateway,
        'gateway': gateway,
        'gateway_number': gateway_number_from_name(gateway),
        'recv_time': record_get(record, 'recv_time'),
        'create_time': record_get(record, 'recv_time'),
        'msg_id': message_id,
        'message_id': message_id,
        'payload_time': record_get(record, 'payload_time'),
        'source_time': record_get(record, 'payload_time'),
        'satellite_received_timestamp': record_get(record, 'payload_time'),
        'forwarded_timestamp': None,
        'terminal_id': record_get(record, 'sn_code'),
        'sequence': str(message_id).rsplit('_', 1)[-1] if message_id else None,
        'raw_hex': record_get(record, 'raw_hex'),
        'sensor_type': 'TH',
        'sensor_value': None,
        'fire_detected': None,
        'wind_speed': None,
        'wind_speed_unit': None,
        'ch1_raw': ch1,
        'ch2_raw': ch2,
        'ch3_raw': record_get(record, 'ch3'),
        'ch4_raw': record_get(record, 'ch4'),
        'temperature': round_scaled_value(ch1, 100, 2),
        'humidity': round_scaled_value(ch2, 100, 2),
        'pressure': None,
        'noise': None,
        'access_point': gateway,
        'data_source': 'legacy-sensor-logs',
        'weather_source': 'legacy-database-record',
        'noise_source': 'unavailable',
    }
    return enrich_sensor_payload(data, gateway)


def get_access_point_config(sn_code):
    return ACCESS_POINTS.get(sn_code, ACCESS_POINTS[DEFAULT_SN_CODE])


def primary_sensor_type_for_gateway(gateway):
    config = get_access_point_config(gateway)
    return str(config.get('sensor_type') or '').upper() or None


def enrich_sensor_payload(data, sn_code):
    ap_config = get_access_point_config(sn_code)
    if data is None:
        return None
    data['access_point_name'] = ap_config.get('name', '未知接入点')
    data['access_point_location'] = ap_config.get('location', '未知位置')
    data['scene'] = ap_config.get('scene')
    data['scene_name'] = ap_config.get('scene_name')
    data['weather_provider_label'] = '核心卫星网关 SSE 10014'
    data['noise_provider_label'] = {
        'WS': '风速任务载荷',
        'TH': '温湿度任务载荷',
    }.get(data.get('sensor_type'), '火情任务载荷')
    return data


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
            'short_name': config.get('short_name', config['name']),
            'location': config['location'],
            'scene': config.get('scene'),
            'scene_name': config.get('scene_name'),
            'sensor_type': config.get('sensor_type'),
            'scene_order': config.get('scene_order', 99),
            'lat': config.get('lat'),
            'lng': config.get('lng')
        })
    return jsonify({
        'success': True,
        'data': sorted(points, key=lambda x: x['scene_order'])
    })


@app.route('/api/link-status')
def get_link_status():
    with SATELLITE_LINK_LOCK:
        source_state = dict(SATELLITE_LINK_STATE)

    gateways = []
    for sn_code, config in sorted(
        ACCESS_POINTS.items(), key=lambda item: item[1].get('scene_order', 99)
    ):
        rows = get_satellite_rows(
            sn_code,
            limit=1,
            sensor_type=primary_sensor_type_for_gateway(sn_code),
        )
        latest = format_satellite_data(rows[0]) if rows else None
        gateways.append({
            'sn_code': sn_code,
            'short_name': config.get('short_name', config['name']),
            'scene': config.get('scene'),
            'online': bool(source_state['source_online']),
            'has_telemetry': latest is not None,
            'last_event_time': latest.get('payload_time') if latest else None,
            'last_received_time': latest.get('recv_time') if latest else None,
        })

    return jsonify({
        'success': True,
        'data': {
            'source_online': bool(source_state['source_online']),
            'status': 'online' if source_state['source_online'] else 'reconnecting',
            'source_url': SATELLITE_SOURCE_EVENTS_URL,
            'connected_at': source_state['connected_at'],
            'last_event_at': source_state['last_event_at'],
            'last_error': source_state['last_error'],
            'gateways': gateways,
        },
    })


@app.route('/api/latest')
def get_latest():
    try:
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE
        sensor_type = primary_sensor_type_for_gateway(sn_code)
        rows = get_satellite_rows(sn_code, limit=2, sensor_type=sensor_type)

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
        sensor_type = primary_sensor_type_for_gateway(sn_code)

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            f'''
            SELECT * FROM {SATELLITE_RECORD_TABLE}
            WHERE id > ? AND gateway = ? AND sensor_type = ?
            ORDER BY id ASC
            LIMIT ?
            ''',
            (since_id, sn_code, sensor_type, SATELLITE_HISTORY_LIMIT),
        )
        rows = cursor.fetchall()
        data = [format_satellite_data(row) for row in rows]
        max_id = max([d['id'] for d in data if d.get('id') is not None], default=since_id)
        cursor.execute(
            f'''
            SELECT * FROM {SATELLITE_RECORD_TABLE}
            WHERE gateway = ? AND sensor_type = ?
            ORDER BY id DESC
            LIMIT 1
            ''',
            (sn_code, sensor_type),
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
        rows = get_satellite_rows(
            sn_code,
            limit=limit,
            sensor_type=primary_sensor_type_for_gateway(sn_code),
        )

        data = [enrich_sensor_payload(format_satellite_data(row), sn_code) for row in reversed(rows)]
        return jsonify({'success': True, 'data': data})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/environment')
def get_environment_data():
    """Return gateway1 TH history persisted from the core-gateway SSE stream."""
    try:
        limit = request.args.get('limit', SATELLITE_HISTORY_LIMIT, type=int)
        limit = max(2, min(limit, SATELLITE_HISTORY_LIMIT))
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE
        config = get_access_point_config(sn_code)
        if config.get('scene') != 'forest':
            return jsonify({'success': True, 'data': []})
        rows = get_satellite_rows(sn_code, limit=limit, sensor_type='TH')
        if rows:
            data = [
                enrich_sensor_payload(format_satellite_data(row), sn_code)
                for row in reversed(rows)
            ]
            data_source = 'satellite-database'
        else:
            legacy_rows = get_legacy_environment_rows(limit)
            data = [
                format_legacy_environment_data(row, sn_code)
                for row in reversed(legacy_rows)
            ]
            data_source = 'legacy-sensor-logs'
        return jsonify({
            'success': True,
            'data': data,
            'data_source': data_source,
        })
    except Exception as exc:
        return jsonify({'success': False, 'message': str(exc), 'data': []}), 500


@app.route('/api/all')
def get_all_data():
    try:
        page = request.args.get('page', 1, type=int)
        size = request.args.get('size', 10, type=int)
        sn_code = normalize_gateway_name(request.args.get('sn_code')) or DEFAULT_SN_CODE
        sensor_type = primary_sensor_type_for_gateway(sn_code)
        size = max(1, min(size, SATELLITE_HISTORY_LIMIT))
        
        offset = (page - 1) * size
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            f'SELECT COUNT(*) FROM {SATELLITE_RECORD_TABLE} WHERE gateway = ? AND sensor_type = ?',
            (sn_code, sensor_type),
        )
        total = cursor.fetchone()[0]
        
        cursor.execute(f'''
            SELECT * FROM {SATELLITE_RECORD_TABLE}
            WHERE gateway = ? AND sensor_type = ?
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        ''', (sn_code, sensor_type, size, offset))
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
                AVG(CASE WHEN sensor_type = 'WS' THEN wind_speed END) as avg_wind_speed,
                AVG(CASE WHEN sensor_type = 'TH' THEN temperature END) as avg_temperature,
                AVG(CASE WHEN sensor_type = 'TH' THEN humidity END) as avg_humidity
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
                    'avg_temperature': round(row['avg_temperature'], 1) if row['avg_temperature'] is not None else None,
                    'avg_humidity': round(row['avg_humidity'], 1) if row['avg_humidity'] is not None else None,
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
    init_satellite_record_table()
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
