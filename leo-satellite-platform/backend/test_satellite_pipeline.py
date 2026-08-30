import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path


SERVER_PATH = Path(__file__).with_name('server.py')


def forwarded_packet(message_id, gateway, sensor_type, value, source_record_id):
    gateway_number = int(gateway.removeprefix('gateway'))
    compact_time = '260814120000'
    packet = {
        'gateway': gateway,
        'timestamp': '2026-08-14 12:00:00',
        'satellite_received_timestamp': '2026-08-14 12:00:01',
        'server_received_timestamp': '2026-08-14T12:00:02.123+08:00',
        'forwarded_timestamp': '2026-08-14T12:00:02.456+08:00',
        'terminal_id': {'gateway1': '11309', 'gateway2': '11310', 'gateway3': '11311'}[gateway],
        'message_id': message_id,
        'sequence': message_id.rsplit('_', 1)[-1],
        'raw_content_hex': '00',
        'content': {'t': compact_time, 's': sensor_type, 'v': value, 'g': gateway_number},
        'sensor_type': sensor_type,
        'value': value,
        '_source_record_id': source_record_id,
    }
    if sensor_type == 'TH':
        packet.update(temperature=value['tp'], humidity=value['rh'])
    elif sensor_type == 'WS':
        packet.update(wind_speed=value, wind_speed_unit='m/s')
    elif sensor_type == 'F':
        packet.update(fire=str(value).lower())
    return packet


class SatellitePipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.database = str(Path(cls.temp_dir.name) / 'satellite-test.db')
        previous_database = os.environ.get('PROJECT20_DATABASE')
        os.environ['PROJECT20_DATABASE'] = cls.database
        try:
            spec = importlib.util.spec_from_file_location('satellite_server_test', SERVER_PATH)
            cls.server = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.server)
        finally:
            if previous_database is None:
                os.environ.pop('PROJECT20_DATABASE', None)
            else:
                os.environ['PROJECT20_DATABASE'] = previous_database

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def setUp(self):
        conn = sqlite3.connect(self.database)
        conn.execute(f'DELETE FROM {self.server.SATELLITE_RECORD_TABLE}')
        conn.commit()
        conn.close()

    def test_f_ws_th_persist_and_api_streams_do_not_overlap(self):
        packets = [
            forwarded_packet('11309_20260814120000_001', 'gateway1', 'F', False, 101),
            forwarded_packet('11309_20260814120000_002', 'gateway1', 'TH', {'tp': 23.4, 'rh': 82.1}, 102),
            forwarded_packet('11310_20260814120000_003', 'gateway2', 'WS', 24.5, 103),
            forwarded_packet('11311_20260814120000_004', 'gateway3', 'F', True, 104),
        ]
        self.assertEqual(self.server.save_satellite_records(packets), 4)
        self.assertEqual(self.server.save_satellite_records(packets), 0)
        self.assertEqual(self.server.get_satellite_resume_cursor(), 104)

        client = self.server.app.test_client()
        forest_latest = client.get('/api/latest?sn_code=gateway1').get_json()
        forest_chart = client.get('/api/chart?sn_code=gateway1').get_json()
        environment = client.get('/api/environment?sn_code=gateway1').get_json()
        ocean_latest = client.get('/api/latest?sn_code=gateway2').get_json()
        ocean_chart = client.get('/api/chart?sn_code=gateway2').get_json()

        self.assertEqual(forest_latest['data']['sensor_type'], 'F')
        self.assertTrue(all(row['sensor_type'] == 'F' for row in forest_chart['data']))
        self.assertEqual(environment['data'][0]['sensor_type'], 'TH')
        self.assertEqual(environment['data'][0]['temperature'], 23.4)
        self.assertEqual(environment['data'][0]['humidity'], 82.1)
        self.assertEqual(ocean_latest['data']['sensor_type'], 'WS')
        self.assertEqual(ocean_latest['data']['wind_speed'], 24.5)
        self.assertTrue(all(row['sensor_type'] == 'WS' for row in ocean_chart['data']))

    def test_validation_rejects_invalid_th_without_partial_insert(self):
        valid = forwarded_packet(
            '11309_20260814120000_011', 'gateway1', 'F', False, 111
        )
        invalid = forwarded_packet(
            '11309_20260814120000_012', 'gateway1', 'TH', {'tp': 23.4, 'rh': 101}, 112
        )
        with self.assertRaises(ValueError):
            self.server.save_satellite_records([valid, invalid])
        conn = sqlite3.connect(self.database)
        count = conn.execute(
            f'SELECT COUNT(*) FROM {self.server.SATELLITE_RECORD_TABLE}'
        ).fetchone()[0]
        conn.close()
        self.assertEqual(count, 0)

    def test_migration_adds_th_columns_idempotently(self):
        migration_database = str(Path(self.temp_dir.name) / 'migration-test.db')
        conn = sqlite3.connect(migration_database)
        conn.execute(
            f'''
            CREATE TABLE {self.server.SATELLITE_RECORD_TABLE} (
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
        conn.commit()
        conn.close()

        original_database = self.server.DATABASE
        self.server.DATABASE = migration_database
        try:
            self.server.init_satellite_record_table()
            self.server.init_satellite_record_table()
            conn = sqlite3.connect(migration_database)
            columns = {
                row[1] for row in conn.execute(
                    f'PRAGMA table_info({self.server.SATELLITE_RECORD_TABLE})'
                )
            }
            conn.close()
        finally:
            self.server.DATABASE = original_database
        self.assertTrue({'temperature', 'humidity'} <= columns)


if __name__ == '__main__':
    unittest.main()
