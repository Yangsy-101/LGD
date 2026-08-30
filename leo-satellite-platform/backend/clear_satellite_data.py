#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Safely clear received satellite records while preserving layout data."""

import argparse
import datetime
import os
import sqlite3
import sys


BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
DEFAULT_DATABASE = os.path.join(PROJECT_ROOT, 'data', 'satellite_data.db')
DEFAULT_BACKUP_DIR = os.path.join(PROJECT_ROOT, 'data', 'database_backups')
SATELLITE_TABLE = 'satellite_sensor_records'
BACKUP_RETENTION = 5


def timestamp():
    return datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')


def table_exists(conn, table_name):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def create_backup(source_conn, database_path, backup_dir):
    os.makedirs(backup_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(database_path))[0]
    backup_path = os.path.join(
        backup_dir,
        f'{base_name}_before_satellite_clear_{timestamp()}.db',
    )
    backup_conn = sqlite3.connect(backup_path, timeout=10.0)
    try:
        source_conn.backup(backup_conn)
    finally:
        backup_conn.close()
    return backup_path


def prune_backups(backup_dir, retention=BACKUP_RETENTION):
    if retention < 1 or not os.path.isdir(backup_dir):
        return
    backups = []
    for entry in os.scandir(backup_dir):
        if not entry.is_file() or not entry.name.endswith('.db'):
            continue
        if '_before_satellite_clear_' not in entry.name:
            continue
        backups.append((entry.stat().st_mtime, entry.path))
    backups.sort(reverse=True)
    for _, path in backups[retention:]:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def clear_satellite_records(database_path, backup_dir, make_backup=True):
    database_path = os.path.abspath(database_path)
    if not os.path.isfile(database_path):
        raise FileNotFoundError(f'数据库不存在：{database_path}')

    conn = sqlite3.connect(database_path, timeout=10.0)
    conn.execute('PRAGMA busy_timeout = 10000')
    backup_path = None
    try:
        if not table_exists(conn, SATELLITE_TABLE):
            raise RuntimeError(f'数据库中不存在表：{SATELLITE_TABLE}')

        before_count = conn.execute(
            f'SELECT COUNT(*) FROM {SATELLITE_TABLE}'
        ).fetchone()[0]

        if make_backup:
            backup_path = create_backup(conn, database_path, backup_dir)

        conn.execute('BEGIN IMMEDIATE')
        conn.execute(f'DELETE FROM {SATELLITE_TABLE}')
        if table_exists(conn, 'sqlite_sequence'):
            conn.execute(
                'DELETE FROM sqlite_sequence WHERE name = ?',
                (SATELLITE_TABLE,),
            )
        conn.commit()

        after_count = conn.execute(
            f'SELECT COUNT(*) FROM {SATELLITE_TABLE}'
        ).fetchone()[0]
        return before_count, after_count, backup_path
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()


def parse_args():
    parser = argparse.ArgumentParser(
        description='一键清空网页后端卫星数据，保留布局和其他数据库表。'
    )
    parser.add_argument('--db', default=DEFAULT_DATABASE, help='SQLite 数据库路径')
    parser.add_argument(
        '--backup-dir',
        default=DEFAULT_BACKUP_DIR,
        help='清理前数据库备份目录',
    )
    parser.add_argument(
        '--no-backup',
        action='store_true',
        help='不创建备份（不推荐）',
    )
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        before, after, backup_path = clear_satellite_records(
            args.db,
            args.backup_dir,
            make_backup=not args.no_backup,
        )
        if backup_path:
            prune_backups(args.backup_dir)
            print(f'备份完成：{backup_path}')
        print(f'清理完成：{before} 条 -> {after} 条')
        print('已保留结构图布局、布局历史和其他数据库表。')
        return 0
    except Exception as exc:
        print(f'清理失败：{exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
