#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键清空网页后端的卫星接收记录。

只清理 satellite_sensor_records，不删除数据库文件，也不影响：
- graph_layout（当前结构图布局）
- graph_layout_history（结构图布局历史）
- 其他后端表

默认清理前会通过 SQLite backup API 创建完整一致性备份。注意：如果核心
网关的 /events 仍可访问且核心 SQLite 中还有历史数据，网页后端可能在清理
后重新接收这些记录。要做整条链路的完全清空，还需要清理核心网关数据库。
"""

import argparse
import datetime
import os
import sqlite3
import sys


BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
DEFAULT_DATABASE = os.path.join(PROJECT_ROOT, "data", "satellite_data.db")
DEFAULT_BACKUP_DIR = os.path.join(PROJECT_ROOT, "data", "database_backups")
SATELLITE_TABLE = "satellite_sensor_records"
BACKUP_RETENTION = 5


def timestamp():
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")


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
        "%s_before_satellite_clear_%s.db" % (base_name, timestamp()),
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
        if not entry.is_file() or not entry.name.endswith(".db"):
            continue
        if "_before_satellite_clear_" not in entry.name:
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
        raise FileNotFoundError("数据库不存在：%s" % database_path)

    conn = sqlite3.connect(database_path, timeout=10.0)
    conn.execute("PRAGMA busy_timeout = 10000")
    backup_path = None
    try:
        if not table_exists(conn, SATELLITE_TABLE):
            raise RuntimeError("数据库中不存在表：%s" % SATELLITE_TABLE)

        before_count = conn.execute(
            "SELECT COUNT(*) FROM %s" % SATELLITE_TABLE
        ).fetchone()[0]

        if make_backup:
            backup_path = create_backup(conn, database_path, backup_dir)

        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM %s" % SATELLITE_TABLE)
        if table_exists(conn, "sqlite_sequence"):
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name = ?",
                (SATELLITE_TABLE,),
            )
        conn.commit()

        after_count = conn.execute(
            "SELECT COUNT(*) FROM %s" % SATELLITE_TABLE
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
        description="一键清空网页后端卫星数据，保留布局和其他数据库表"
    )
    parser.add_argument("--db", default=DEFAULT_DATABASE, help="SQLite 数据库路径")
    parser.add_argument(
        "--backup-dir",
        default=DEFAULT_BACKUP_DIR,
        help="清理前数据库备份目录",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="不创建备份（不推荐）",
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
            print("备份完成：%s" % backup_path)
        print("清理完成：%s 条 -> %s 条" % (before, after))
        print("已保留结构图布局、布局历史和其他数据库表。")
        return 0
    except Exception as exc:
        print("清理失败：%s" % exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
