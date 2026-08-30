"""Insert a one-shot forest fire demo record into the local SQLite database."""

import argparse
import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta


BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
DEFAULT_DATABASE = os.path.join(PROJECT_ROOT, 'data', 'satellite_data.db')
TABLE_NAME = 'satellite_sensor_records'
GATEWAY = 'gateway1'
HISTORY_LIMIT = 30


def parse_args():
    parser = argparse.ArgumentParser(
        description='向森林场景写入一条演示火情记录（不生成气象数据）。'
    )
    parser.add_argument(
        '--state',
        choices=('alarm', 'normal'),
        default='alarm',
        help='alarm 写入报警，normal 写入恢复正常；默认 alarm。',
    )
    parser.add_argument(
        '--database',
        default=DEFAULT_DATABASE,
        help='SQLite 数据库路径。',
    )
    return parser.parse_args()


def ensure_target_table(conn):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (TABLE_NAME,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f'目标表不存在：{TABLE_NAME}')


def insert_demo_record(database, alarm):
    received_at = datetime.now()
    event_at = received_at - timedelta(seconds=1)
    event_time = event_at.strftime('%Y-%m-%d %H:%M:%S')
    server_received_at = received_at.strftime('%Y-%m-%d %H:%M:%S')
    event_token = received_at.strftime('%Y%m%d%H%M%S%f')
    sequence = event_token[-3:]
    message_id = f'demo-fire-{event_token}-{uuid.uuid4().hex[:8]}'
    fire_value = 1 if alarm else 0
    payload = {
        'demo': True,
        'gateway': GATEWAY,
        'timestamp': event_time,
        'server_received_timestamp': server_received_at,
        'sensor_type': 'F',
        'value': bool(alarm),
        'message_id': message_id,
        'sequence': sequence,
    }

    conn = sqlite3.connect(database, timeout=10)
    try:
        ensure_target_table(conn)
        cursor = conn.cursor()
        cursor.execute('BEGIN IMMEDIATE')
        cursor.execute(
            f'''
            INSERT INTO {TABLE_NAME} (
                source_record_id, message_id, event_time, sensor_type, sensor_value,
                gateway_number, gateway, fire_detected, wind_speed,
                satellite_received_at, server_received_at, forwarded_at,
                terminal_id, sequence, raw_content_hex, raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                None,
                message_id,
                event_time,
                'F',
                fire_value,
                1,
                GATEWAY,
                fire_value,
                None,
                event_time,
                server_received_at,
                server_received_at,
                'demo-forest-fire',
                sequence,
                'DEMO_FIRE_ALARM' if alarm else 'DEMO_FIRE_NORMAL',
                json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
            ),
        )
        record_id = cursor.lastrowid
        cursor.execute(
            f'''
            DELETE FROM {TABLE_NAME}
            WHERE gateway = ? AND id NOT IN (
                SELECT id FROM {TABLE_NAME}
                WHERE gateway = ?
                ORDER BY id DESC
                LIMIT ?
            )
            ''',
            (GATEWAY, GATEWAY, HISTORY_LIMIT),
        )
        conn.commit()
        return record_id, message_id, event_time, server_received_at
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    args = parse_args()
    alarm = args.state == 'alarm'
    record_id, message_id, event_time, received_at = insert_demo_record(
        os.path.abspath(args.database),
        alarm,
    )
    print(f'state={args.state}')
    print(f'id={record_id}')
    print(f'message_id={message_id}')
    print(f'event_time={event_time}')
    print(f'server_received_at={received_at}')


if __name__ == '__main__':
    main()
