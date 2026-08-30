#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
===========================================================
  gateway.py - Core gateway: server.py -> frontend HTTP
===========================================================

Upstream framed channels:
  Connect to server.py ports 11400-11405.

Framed packet from server.py:
  [1B gateway_id_len]
  [gateway_id]
  [8B timestamp, double]
  [4B frame_seq, uint32]
  [4B packet_type: VID0/SNAP]
  [8B body_size]
  [4B metadata_len]
  [metadata JSON]
  [JPEG payload]

Upstream JSON channels:
  Connect to server.py ports 11406, 11407, 11408, 11409.
  Each JSON object is newline-delimited UTF-8 text:
    {...}\n

Frontend outputs:

  VID0 video:
    10000 /stream -> 11400 VID0
    10001 /stream -> 11401 VID0
    10002 /stream -> 11402 VID0
    10003 /stream -> 11403 VID0
    10004 /stream -> 11404 VID0

  SNAP image:
    10005 /latest.jpg -> 11400 SNAP
    10006 /latest.jpg -> 11402 SNAP
    10007 /latest.jpg -> 11405 SNAP

  JSON:
    10008 /events or /latest.json -> 11406 JSON
    10009 /events or /latest.json -> 11407 JSON
    10011 /events or /latest.json -> 11408 JSON
    10012 /events or /latest.json -> 11409 JSON

JSON file output:
  11408 latest JSON -> /root/newjson/newjs3_sensor.json
  11409 latest JSON -> /root/newjson/newjs4_inf.json

Notes:
  11401, 11403, 11404 SNAP are ignored.
  11405 is SNAP-only; no /stream is created for 11405.
  gateway.py does not forward raw server packet headers to frontend.
  It parses packets and exports HTTP MJPEG / JPEG / JSON / SSE.
"""

import argparse
import json
import os
import socket
import struct
import threading
import time
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs


# ======================== Configuration ========================

DEFAULT_SERVER_HOST = "127.0.0.1"

FRAMED_SERVER_INPUT_PORTS = [11400, 11401, 11402, 11403, 11404, 11405]

JSON_SERVER_INPUT_PORTS = [11406, 11407, 11408, 11409]

VIDEO_FORWARD_MAP = {
    11400: 10000,
    11401: 10001,
    11402: 10002,
    11403: 10003,
    11404: 10004,
}

SNAP_FORWARD_MAP = {
    11400: 10005,
    11402: 10006,
    11405: 10007,
}

IGNORED_SNAP_PORTS = {11401, 11403, 11404}

JSON_FORWARD_MAP = {
    11406: 10008,
    11407: 10009,
    11408: 10011,
    11409: 10012,
}

CHANNEL_NAME = {
    11400: "ch0",
    11401: "ch1",
    11402: "ch2",
    11403: "ch3",
    11404: "ch4",
    11405: "ch5_snap",
    11406: "json_ch6",
    11407: "json_ch7",
    11408: "json_ch8",
    11409: "json_ch9",
}

FRONTEND_LISTEN_HOST = "0.0.0.0"

BUFFER_SIZE = 65536
MAX_BODY_SIZE = 20 * 1024 * 1024
MAX_META_SIZE = 1024 * 1024
MAX_GATEWAY_ID_SIZE = 255
MAX_JSON_LINE_SIZE = 1024 * 1024

RECONNECT_INTERVAL = 3.0

PACKET_HEADER = struct.Struct("!4sQ")
META_LENGTH = struct.Struct("!I")
TIMESTAMP_STRUCT = struct.Struct("!d")
FRAME_SEQ_STRUCT = struct.Struct("!I")

VALID_PACKET_TYPES = {"VID0", "SNAP"}

MJPEG_BOUNDARY = "myboundary"

LOG_EVERY_VIDEO = 30
FPS_REPORT_INTERVAL = 5.0
JSON_REPORT_INTERVAL = 5.0

# 防止前端重启后长期拿到旧缓存。
# JSON 当前大约 5 秒一条，所以这里给 30 秒。
SNAPSHOT_MAX_AGE_SECONDS = 8.0
JSON_MAX_AGE_SECONDS = 300.0

BJ_TZ = timezone(timedelta(hours=8))

# gateway.py 位于 /root/lgd/gateway.py 时，输出目录为 /root/newjson/
JSON_FILE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "newjson")
)

JSON_FILE_ROUTE_MAP = {
    11408: os.path.join(JSON_FILE_DIR, "newjs3_sensor.json"),
    11409: os.path.join(JSON_FILE_DIR, "newjs4_inf.json"),
}


# ======================== Logging ========================

def bj_time_str():
    return datetime.now(BJ_TZ).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def log(msg):
    print("[{}] {}".format(bj_time_str(), msg), flush=True)


# ======================== TCP helpers ========================

def recv_exact(sock, size):
    chunks = []
    received = 0

    while received < size:
        data = sock.recv(min(BUFFER_SIZE, size - received))
        if not data:
            if received == 0:
                return None
            raise ConnectionError(
                "connection closed while reading: expected={} received={}".format(
                    size, received
                )
            )
        chunks.append(data)
        received += len(data)

    return b"".join(chunks)


def set_socket_options(sock):
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass

    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    except OSError:
        pass


# ======================== Framed packet parsing ========================

def read_server_forward_packet(sock):
    id_len_bytes = recv_exact(sock, 1)
    if id_len_bytes is None:
        return None

    id_len = struct.unpack("!B", id_len_bytes)[0]
    if id_len <= 0 or id_len > MAX_GATEWAY_ID_SIZE:
        raise ValueError("invalid gateway_id length: {}".format(id_len))

    gateway_id_bytes = recv_exact(sock, id_len)
    if gateway_id_bytes is None:
        raise ConnectionError("connection closed while reading gateway_id")

    gateway_id = gateway_id_bytes.decode("utf-8", errors="replace")

    timestamp_bytes = recv_exact(sock, TIMESTAMP_STRUCT.size)
    if timestamp_bytes is None:
        raise ConnectionError("connection closed while reading timestamp")
    timestamp = TIMESTAMP_STRUCT.unpack(timestamp_bytes)[0]

    seq_bytes = recv_exact(sock, FRAME_SEQ_STRUCT.size)
    if seq_bytes is None:
        raise ConnectionError("connection closed while reading frame_seq")
    frame_seq = FRAME_SEQ_STRUCT.unpack(seq_bytes)[0]

    original_header = recv_exact(sock, PACKET_HEADER.size)
    if original_header is None:
        raise ConnectionError("connection closed while reading original header")

    packet_type_bytes, body_size = PACKET_HEADER.unpack(original_header)
    packet_type = packet_type_bytes.decode("ascii", errors="replace")

    if packet_type not in VALID_PACKET_TYPES:
        raise ValueError(
            "unknown packet_type={!r}, gateway_id={}, seq={}".format(
                packet_type, gateway_id, frame_seq
            )
        )

    if body_size < META_LENGTH.size:
        raise ValueError("invalid body_size too small: {}".format(body_size))

    if body_size > MAX_BODY_SIZE:
        raise ValueError("body_size too large: {}".format(body_size))

    body = recv_exact(sock, body_size)
    if body is None:
        raise ConnectionError("connection closed while reading original body")

    metadata, jpeg = parse_body(body)

    return {
        "gateway_id": gateway_id,
        "timestamp": timestamp,
        "frame_seq": frame_seq,
        "packet_type": packet_type,
        "body_size": body_size,
        "body": body,
        "metadata": metadata,
        "jpeg": jpeg,
    }


def parse_body(body):
    if len(body) < META_LENGTH.size:
        return {}, b""

    meta_size = META_LENGTH.unpack(body[:META_LENGTH.size])[0]

    if meta_size > MAX_META_SIZE:
        return {}, b""

    image_offset = META_LENGTH.size + meta_size
    if image_offset > len(body):
        return {}, b""

    meta_bytes = body[META_LENGTH.size:image_offset]
    jpeg = body[image_offset:]

    metadata = {}
    if meta_bytes:
        try:
            metadata = json.loads(meta_bytes.decode("utf-8"))
        except Exception:
            metadata = {}

    return metadata, jpeg


def is_jpeg(data):
    return data.startswith(b"\xff\xd8")


# ======================== Freshness helpers ========================

def parse_since_ts(raw_path):
    """
    Supported:
      ?since=1710000000000  milliseconds
      ?since=1710000000     seconds
    """
    try:
        parsed = urlparse(raw_path)
        qs = parse_qs(parsed.query)
        values = qs.get("since") or qs.get("start") or qs.get("frontend_start")
        if not values:
            return None

        value = float(values[0])
        if value > 1000000000000:
            return value / 1000.0
        return value
    except Exception:
        return None


def is_fresh_for_request(item, raw_path, max_age_seconds):
    if item is None:
        return False

    update_time = float(item.get("update_time", 0.0) or 0.0)
    if update_time <= 0:
        return False

    since_ts = parse_since_ts(raw_path)
    if since_ts is not None:
        return update_time > since_ts

    if max_age_seconds is not None and max_age_seconds > 0:
        return (time.time() - update_time) <= max_age_seconds

    return True


def send_no_content(handler):
    handler.send_response(204)
    handler.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
    handler.send_header("Pragma", "no-cache")
    handler.send_header("Expires", "0")
    send_cors_headers(handler)
    handler.end_headers()


# ======================== VideoHub ========================

class VideoHub:
    def __init__(self, name):
        self.name = name
        self.cond = threading.Condition()
        self.seq = 0
        self.jpeg = None
        self.metadata = {}
        self.gateway_id = ""
        self.server_seq = 0
        self.last_update = 0.0

    def update(self, jpeg, metadata, gateway_id, server_seq):
        if not jpeg:
            return

        with self.cond:
            self.seq += 1
            self.jpeg = jpeg
            self.metadata = metadata or {}
            self.gateway_id = gateway_id
            self.server_seq = server_seq
            self.last_update = time.time()
            self.cond.notify_all()

    def current_seq(self):
        with self.cond:
            return self.seq

    def wait_next(self, last_seq, timeout=10.0):
        with self.cond:
            if self.seq <= last_seq:
                self.cond.wait(timeout=timeout)

            if self.seq <= last_seq or self.jpeg is None:
                return None

            return {
                "seq": self.seq,
                "jpeg": self.jpeg,
                "metadata": self.metadata,
                "gateway_id": self.gateway_id,
                "server_seq": self.server_seq,
                "update_time": self.last_update,
            }


# ======================== SnapshotStore ========================

class SnapshotStore:
    def __init__(self, name):
        self.name = name
        self.lock = threading.Lock()
        self.seq = 0
        self.jpeg = None
        self.filename = ""
        self.metadata = {}
        self.gateway_id = ""
        self.channel = ""
        self.source_port = 0
        self.update_time = 0.0

    def update(self, jpeg, metadata, gateway_id, channel, source_port, server_seq):
        if not jpeg:
            return

        filename = make_snapshot_filename(metadata, gateway_id, channel, server_seq)

        with self.lock:
            self.seq += 1
            self.jpeg = jpeg
            self.filename = filename
            self.metadata = metadata or {}
            self.gateway_id = gateway_id
            self.channel = channel
            self.source_port = source_port
            self.update_time = time.time()

    def get_latest(self):
        with self.lock:
            if self.jpeg is None:
                return None

            return {
                "seq": self.seq,
                "jpeg": self.jpeg,
                "filename": self.filename,
                "metadata": self.metadata,
                "gateway_id": self.gateway_id,
                "channel": self.channel,
                "source_port": self.source_port,
                "update_time": self.update_time,
            }


def sanitize_filename(name):
    name = str(name or "").strip()
    if not name:
        return ""

    name = os.path.basename(name)
    name = name.replace("\r", "_").replace("\n", "_").replace('"', "_")
    name = name.replace("/", "_").replace("\\", "_")

    if not name.lower().endswith((".jpg", ".jpeg")):
        name += ".jpg"

    return name


def make_snapshot_filename(metadata, gateway_id, channel, server_seq):
    filename = sanitize_filename((metadata or {}).get("filename", ""))

    if filename:
        return filename

    ts = datetime.now(BJ_TZ).strftime("%Y%m%d_%H%M%S_%f")[:-3]
    return "SNAP_{}_{}_{}_{}.jpg".format(channel, gateway_id, ts, server_seq)


# ======================== JsonHub ========================

class JsonHub:
    def __init__(self, name, source_port, file_path=None):
        self.name = name
        self.source_port = source_port
        self.file_path = file_path
        self.cond = threading.Condition()
        self.seq = 0
        self.text = ""
        self.obj = None
        self.update_time = 0.0
        self._last_write_log = 0.0

    def update(self, text, obj):
        with self.cond:
            self.seq += 1
            self.text = text
            self.obj = obj
            self.update_time = time.time()
            self.cond.notify_all()

        if self.file_path:
            self.write_latest_to_file(text)

    def write_latest_to_file(self, text):
        """
        Write latest JSON to file.

        Use tmp + os.replace to avoid half-written files.
        Print success log at most once per second.
        Print explicit ERROR log on failure.
        """
        try:
            directory = os.path.dirname(self.file_path)
            if directory:
                os.makedirs(directory, exist_ok=True)

            tmp_path = self.file_path + ".tmp"

            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(text)
                f.write("\n")

            os.replace(tmp_path, self.file_path)

            now = time.time()
            if now - self._last_write_log >= 1.0:
                log("[JSON-FILE][{}] written {} bytes -> {}".format(
                    self.name,
                    len(text.encode("utf-8")),
                    self.file_path,
                ))
                self._last_write_log = now

        except Exception as exc:
            log("[JSON-FILE][{}][ERROR] write failed! path={!r} err={}".format(
                self.name,
                self.file_path,
                exc,
            ))

    def current_seq(self):
        with self.cond:
            return self.seq

    def get_latest(self):
        with self.cond:
            if not self.text:
                return None
            return {
                "seq": self.seq,
                "text": self.text,
                "obj": self.obj,
                "update_time": self.update_time,
                "source_port": self.source_port,
                "name": self.name,
            }

    def wait_next(self, last_seq, timeout=15.0):
        with self.cond:
            if self.seq <= last_seq:
                self.cond.wait(timeout=timeout)

            if self.seq <= last_seq or not self.text:
                return None

            return {
                "seq": self.seq,
                "text": self.text,
                "obj": self.obj,
                "update_time": self.update_time,
                "source_port": self.source_port,
                "name": self.name,
            }


# ======================== HTTP Server base ========================

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def send_cors_headers(handler):
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type, Cache-Control, X-Requested-With"
    )
    handler.send_header(
        "Access-Control-Expose-Headers",
        "Content-Disposition, X-Image-Name, X-Gateway-ID, X-Channel, X-Source-Port, X-Frame-Seq, X-Json-Seq"
    )


# ======================== MJPEG HTTP Handler ========================

def make_mjpeg_handler(video_hub):
    class MjpegHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            return

        def do_OPTIONS(self):
            self.send_response(204)
            send_cors_headers(self)
            self.end_headers()

        def do_GET(self):
            path = urlparse(self.path).path

            if path != "/stream":
                self.send_response(404)
                send_cors_headers(self)
                self.end_headers()
                self.wfile.write(b"Not Found")
                return

            try:
                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "multipart/x-mixed-replace; boundary={}".format(MJPEG_BOUNDARY)
                )
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Connection", "close")
                send_cors_headers(self)
                self.end_headers()

                log("[HTTP][{}] MJPEG client connected: {}".format(
                    video_hub.name,
                    self.client_address
                ))

                # Do not push old frame when frontend reconnects.
                last_seq = video_hub.current_seq()

                while True:
                    item = video_hub.wait_next(last_seq, timeout=15.0)
                    if item is None:
                        continue

                    last_seq = item["seq"]
                    jpeg = item["jpeg"]
                    if not jpeg:
                        continue

                    part_header = (
                        "--{}\r\n"
                        "Content-Type: image/jpeg\r\n"
                        "Content-Length: {}\r\n"
                        "X-Gateway-ID: {}\r\n"
                        "X-Channel: {}\r\n"
                        "X-Frame-Seq: {}\r\n"
                        "\r\n"
                    ).format(
                        MJPEG_BOUNDARY,
                        len(jpeg),
                        item.get("gateway_id", ""),
                        video_hub.name,
                        item.get("server_seq", 0),
                    ).encode("utf-8")

                    self.wfile.write(part_header)
                    self.wfile.write(jpeg)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()

            except (BrokenPipeError, ConnectionResetError, OSError):
                log("[HTTP][{}] MJPEG client disconnected: {}".format(
                    video_hub.name,
                    self.client_address
                ))

    return MjpegHandler


# ======================== SNAP HTTP Handler ========================

def make_snapshot_handler(snapshot_store):
    class SnapshotHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            return

        def do_OPTIONS(self):
            self.send_response(204)
            send_cors_headers(self)
            self.end_headers()

        def do_GET(self):
            path = urlparse(self.path).path

            if path not in ("/latest.jpg", "/latest.jpeg", "/"):
                self.send_response(404)
                send_cors_headers(self)
                self.end_headers()
                self.wfile.write(b"Not Found")
                return

            item = snapshot_store.get_latest()

            if not is_fresh_for_request(item, self.path, SNAPSHOT_MAX_AGE_SECONDS):
                send_no_content(self)
                return

            jpeg = item["jpeg"]
            filename = sanitize_filename(item.get("filename", "")) or "latest.jpg"

            try:
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(jpeg)))
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("Content-Disposition", 'inline; filename="{}"'.format(filename))
                self.send_header("X-Image-Name", filename)
                self.send_header("X-Gateway-ID", item.get("gateway_id", ""))
                self.send_header("X-Channel", item.get("channel", ""))
                self.send_header("X-Source-Port", str(item.get("source_port", "")))
                send_cors_headers(self)
                self.end_headers()
                self.wfile.write(jpeg)
                self.wfile.flush()

            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

    return SnapshotHandler


# ======================== JSON HTTP Handler ========================

def make_json_handler(json_hub):
    class JsonHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            return

        def do_OPTIONS(self):
            self.send_response(204)
            send_cors_headers(self)
            self.end_headers()

        def do_GET(self):
            path = urlparse(self.path).path

            if path in ("/", "/latest.json"):
                self.handle_latest_json()
                return

            if path == "/events":
                self.handle_sse()
                return

            self.send_response(404)
            send_cors_headers(self)
            self.end_headers()
            self.wfile.write(b"Not Found")

        def handle_latest_json(self):
            item = json_hub.get_latest()

            if not is_fresh_for_request(item, self.path, JSON_MAX_AGE_SECONDS):
                send_no_content(self)
                return

            body = item["text"].encode("utf-8")

            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("X-Json-Seq", str(item["seq"]))
                self.send_header("X-Source-Port", str(item["source_port"]))
                self.send_header("X-Channel", item["name"])
                send_cors_headers(self)
                self.end_headers()
                self.wfile.write(body)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

        def handle_sse(self):
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("X-Accel-Buffering", "no")
                send_cors_headers(self)
                self.end_headers()

                log("[HTTP][{}] JSON SSE client connected: {}".format(
                    json_hub.name,
                    self.client_address
                ))

                self.wfile.write(b": connected\n\n")
                self.wfile.flush()

                # Do not push old JSON when frontend reconnects.
                last_seq = json_hub.current_seq()

                while True:
                    item = json_hub.wait_next(last_seq, timeout=15.0)

                    if item is None:
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
                        continue

                    last_seq = item["seq"]
                    text = item["text"]

                    msg = "id: {}\n".format(last_seq)
                    msg += "event: json\n"

                    for line in text.splitlines() or [""]:
                        msg += "data: {}\n".format(line)

                    msg += "\n"

                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()

            except (BrokenPipeError, ConnectionResetError, OSError):
                log("[HTTP][{}] JSON SSE client disconnected: {}".format(
                    json_hub.name,
                    self.client_address
                ))

    return JsonHandler


def start_http_server(port, handler_cls, name):
    server = ThreadingHTTPServer((FRONTEND_LISTEN_HOST, port), handler_cls)
    log("[HTTP][{}] listening on {}:{}".format(name, FRONTEND_LISTEN_HOST, port))
    server.serve_forever()


# ======================== Framed upstream pull ========================

def server_framed_pull_loop(server_host, server_port, video_hub, snapshot_store_map):
    ch = CHANNEL_NAME.get(server_port, str(server_port))
    snap_output_port = SNAP_FORWARD_MAP.get(server_port)
    snapshot_store = snapshot_store_map.get(snap_output_port)

    recv_video = 0
    recv_snap = 0
    ignored_snap = 0
    ignored_video = 0

    last_video_report_count = 0
    last_report_time = time.time()

    while True:
        sock = None

        try:
            log("[UPSTREAM][{}] connecting to {}:{} ...".format(ch, server_host, server_port))

            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            set_socket_options(sock)
            sock.settimeout(10.0)
            sock.connect((server_host, server_port))
            sock.settimeout(None)

            log("[UPSTREAM][{}] connected to {}:{} | VID0 -> {} | SNAP -> {}".format(
                ch,
                server_host,
                server_port,
                VIDEO_FORWARD_MAP.get(server_port, "ignored"),
                snap_output_port if snap_output_port is not None else "ignored",
            ))

            while True:
                packet = read_server_forward_packet(sock)

                if packet is None:
                    raise ConnectionError("server closed connection")

                gateway_id = packet["gateway_id"]
                frame_seq = packet["frame_seq"]
                packet_type = packet["packet_type"]
                metadata = packet["metadata"]
                jpeg = packet["jpeg"]

                if not jpeg:
                    continue

                if not is_jpeg(jpeg):
                    log("[UPSTREAM][{}][WARN] payload is not JPEG | type={} | seq={}".format(
                        ch, packet_type, frame_seq
                    ))
                    continue

                if packet_type == "VID0":
                    recv_video += 1

                    if video_hub is None:
                        ignored_video += 1
                        if ignored_video % LOG_EVERY_VIDEO == 1:
                            log("[UPSTREAM][{}][VID0][WARN] received VID0 on non-video port {} | ignored".format(
                                ch, server_port
                            ))
                        continue

                    video_hub.update(jpeg, metadata, gateway_id, frame_seq)

                    if recv_video % LOG_EVERY_VIDEO == 0:
                        log(
                            "[UPSTREAM][{}][VID0] recv={} | gateway={} | seq={} | "
                            "frame_id={} | jpeg={} bytes | video_http={}".format(
                                ch,
                                recv_video,
                                gateway_id,
                                frame_seq,
                                metadata.get("frame_id", ""),
                                len(jpeg),
                                VIDEO_FORWARD_MAP.get(server_port, ""),
                            )
                        )

                elif packet_type == "SNAP":
                    recv_snap += 1

                    if snapshot_store is None:
                        ignored_snap += 1
                        if ignored_snap % 50 == 1:
                            log("[UPSTREAM][{}][SNAP] ignored | source_port={} | ignored_count={}".format(
                                ch, server_port, ignored_snap
                            ))
                        continue

                    snapshot_store.update(
                        jpeg=jpeg,
                        metadata=metadata,
                        gateway_id=gateway_id,
                        channel=ch,
                        source_port=server_port,
                        server_seq=frame_seq,
                    )

                    log(
                        "[UPSTREAM][{}][SNAP] recv={} | gateway={} | seq={} | "
                        "filename={} | event={} | event_id={} | jpeg={} bytes | snap_http={}".format(
                            ch,
                            recv_snap,
                            gateway_id,
                            frame_seq,
                            metadata.get("filename", ""),
                            metadata.get("event", ""),
                            metadata.get("event_id", ""),
                            len(jpeg),
                            snap_output_port,
                        )
                    )

                now = time.time()
                dt = now - last_report_time
                if dt >= FPS_REPORT_INTERVAL:
                    fps = (recv_video - last_video_report_count) / dt
                    log("[UPSTREAM][{}][FPS] video_fps={:.1f} | total_video={} | total_snap={} | ignored_snap={}".format(
                        ch, fps, recv_video, recv_snap, ignored_snap
                    ))
                    last_report_time = now
                    last_video_report_count = recv_video

        except (ConnectionError, BrokenPipeError, ConnectionResetError, OSError, ValueError) as exc:
            log("[UPSTREAM][{}][WARN] disconnected/error: {}".format(ch, exc))

        finally:
            if sock:
                try:
                    sock.close()
                except OSError:
                    pass

            log("[UPSTREAM][{}] reconnect after {:.1f}s".format(ch, RECONNECT_INTERVAL))
            time.sleep(RECONNECT_INTERVAL)


# ======================== JSON upstream pull ========================

def server_json_pull_loop(server_host, server_port, json_hub):
    ch = CHANNEL_NAME.get(server_port, str(server_port))
    frontend_port = JSON_FORWARD_MAP[server_port]

    total_json = 0
    last_total_json = 0
    last_report_time = time.time()

    last_json_text = ""
    last_json_bytes = 0
    last_json_time = 0.0

    while True:
        sock = None

        try:
            log("[JSON-UP][{}] connecting to {}:{} ...".format(ch, server_host, server_port))

            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            set_socket_options(sock)
            sock.settimeout(10.0)
            sock.connect((server_host, server_port))
            sock.settimeout(None)

            log("[JSON-UP][{}] connected to {}:{} | JSON -> http://{}:{}/events".format(
                ch,
                server_host,
                server_port,
                FRONTEND_LISTEN_HOST,
                frontend_port,
            ))

            f = sock.makefile("rb")

            while True:
                line = f.readline(MAX_JSON_LINE_SIZE + 1)

                if not line:
                    raise ConnectionError("server JSON channel closed")

                if len(line) > MAX_JSON_LINE_SIZE:
                    log("[JSON-UP][{}][WARN] JSON line too large | bytes={}".format(
                        ch, len(line)
                    ))
                    continue

                text = line.decode("utf-8", errors="replace").strip()

                if not text:
                    continue

                try:
                    obj = json.loads(text)
                except Exception as exc:
                    log("[JSON-UP][{}][WARN] invalid JSON | raw={!r} | error={}".format(
                        ch, text, exc
                    ))
                    continue

                total_json += 1
                last_json_text = text
                last_json_bytes = len(text.encode("utf-8"))
                last_json_time = time.time()

                json_hub.update(text, obj)

                now = time.time()
                dt = now - last_report_time

                if dt >= JSON_REPORT_INTERVAL:
                    rate = (total_json - last_total_json) / dt

                    # 日志长度保护，避免单条 JSON 太长刷屏。
                    display_json = last_json_text
                    if len(display_json) > 500:
                        display_json = display_json[:500] + "...<truncated>"

                    log(
                        "[JSON-UP][{}][DETAIL] rate={:.2f} json/s | total={} | "
                        "bytes={} | last_age={:.2f}s | http_port={} | last_json={}".format(
                            ch,
                            rate,
                            total_json,
                            last_json_bytes,
                            now - last_json_time,
                            frontend_port,
                            display_json,
                        )
                    )

                    last_report_time = now
                    last_total_json = total_json

        except (ConnectionError, BrokenPipeError, ConnectionResetError, OSError, ValueError) as exc:
            log("[JSON-UP][{}][WARN] disconnected/error: {}".format(ch, exc))

        finally:
            if sock:
                try:
                    sock.close()
                except OSError:
                    pass

            log("[JSON-UP][{}] reconnect after {:.1f}s".format(ch, RECONNECT_INTERVAL))
            time.sleep(RECONNECT_INTERVAL)


# ======================== Main ========================

def main():
    parser = argparse.ArgumentParser(
        description="Core Gateway: framed + JSON router from server.py to frontend HTTP services"
    )

    parser.add_argument(
        "--server-host",
        default=DEFAULT_SERVER_HOST,
        help="server.py host, default: {}".format(DEFAULT_SERVER_HOST)
    )

    args = parser.parse_args()

    log("=" * 90)
    log("[MAIN] gateway.py started")
    log("[MAIN] upstream server host: {}".format(args.server_host))

    log("[MAIN] VID0 route:")
    for upstream_port, frontend_port in VIDEO_FORWARD_MAP.items():
        log("[MAIN]   server:{} VID0 -> http://{}:{}/stream".format(
            upstream_port,
            FRONTEND_LISTEN_HOST,
            frontend_port,
        ))

    log("[MAIN] SNAP route:")
    for upstream_port, frontend_port in SNAP_FORWARD_MAP.items():
        log("[MAIN]   server:{} SNAP -> http://{}:{}/latest.jpg".format(
            upstream_port,
            FRONTEND_LISTEN_HOST,
            frontend_port,
        ))

    log("[MAIN] JSON route:")
    for upstream_port, frontend_port in JSON_FORWARD_MAP.items():
        log("[MAIN]   server:{} JSON -> http://{}:{}/events and /latest.json".format(
            upstream_port,
            FRONTEND_LISTEN_HOST,
            frontend_port,
        ))

    log("[MAIN] JSON file output:")
    for upstream_port, file_path in JSON_FILE_ROUTE_MAP.items():
        log("[MAIN]   server:{} latest JSON -> {}".format(upstream_port, file_path))

    log("[MAIN] ignored SNAP ports: {}".format(sorted(IGNORED_SNAP_PORTS)))
    log("[MAIN] 11405 is SNAP-only; no video /stream is created for 11405")
    log("[MAIN] latest TTL: snapshot={}s, json={}s".format(
        SNAPSHOT_MAX_AGE_SECONDS,
        JSON_MAX_AGE_SECONDS,
    ))
    log("[MAIN] local image storage: disabled")
    log("=" * 90)

    video_hubs = {}
    for server_port in VIDEO_FORWARD_MAP.keys():
        ch = CHANNEL_NAME[server_port]
        video_hubs[server_port] = VideoHub(name=ch)

    snapshot_store_map = {}
    for snap_port in sorted(set(SNAP_FORWARD_MAP.values())):
        snapshot_store_map[snap_port] = SnapshotStore(name="snap_{}".format(snap_port))

    json_hubs = {}
    for server_port, frontend_port in JSON_FORWARD_MAP.items():
        ch = CHANNEL_NAME[server_port]
        json_hubs[server_port] = JsonHub(
            name=ch,
            source_port=server_port,
            file_path=JSON_FILE_ROUTE_MAP.get(server_port),
        )

    for server_port, frontend_port in VIDEO_FORWARD_MAP.items():
        handler_cls = make_mjpeg_handler(video_hubs[server_port])
        t = threading.Thread(
            target=start_http_server,
            args=(frontend_port, handler_cls, CHANNEL_NAME[server_port]),
            daemon=True,
        )
        t.start()

    for snap_port, snap_store in snapshot_store_map.items():
        handler_cls = make_snapshot_handler(snap_store)
        t = threading.Thread(
            target=start_http_server,
            args=(snap_port, handler_cls, "snapshot_{}".format(snap_port)),
            daemon=True,
        )
        t.start()

    for server_port, frontend_port in JSON_FORWARD_MAP.items():
        handler_cls = make_json_handler(json_hubs[server_port])
        t = threading.Thread(
            target=start_http_server,
            args=(frontend_port, handler_cls, "json_{}".format(frontend_port)),
            daemon=True,
        )
        t.start()

    for server_port in FRAMED_SERVER_INPUT_PORTS:
        t = threading.Thread(
            target=server_framed_pull_loop,
            args=(
                args.server_host,
                server_port,
                video_hubs.get(server_port),
                snapshot_store_map,
            ),
            daemon=True,
        )
        t.start()

    for server_port in JSON_SERVER_INPUT_PORTS:
        t = threading.Thread(
            target=server_json_pull_loop,
            args=(
                args.server_host,
                server_port,
                json_hubs[server_port],
            ),
            daemon=True,
        )
        t.start()

    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()