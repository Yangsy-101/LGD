#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===========================================================
  server.py - old framed protocol + new JSON protocol router
  + HTTP Device State API

  Upstream:
    - Listen on 11500 (General upstream TCP).
    - Listen on 11501 (HTTP API for device state).
    - Old framed stream is still supported.
    - New UTF-8 JSON stream from socketproject Gateway1/Gateway2 is supported.

  Downstream:
    - Old framed protocol:
        gateway_1 -> 11400
        gateway_2 -> 11401
        gateway_3 -> 11402
        gateway_4 -> 11403
        gateway_5 -> 11404
        gateway_6 -> 11405
    - New JSON protocol:
        Gateway1 -> 11406
        Gateway2 -> 11407

  JSON forwarded to the core gateway is newline-delimited UTF-8 text.
===========================================================
"""

import argparse
import codecs
import json
import os
import queue
import shutil
import socket
import struct
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ======================== Defaults ========================
DEFAULT_LISTEN_HOST = "0.0.0.0"
DEFAULT_SENDER_PORT = 11500
DEFAULT_HTTP_API_PORT = 11501  # HTTP API 端口
DEFAULT_STORAGE_DIR = "received_images"
DEFAULT_MAX_QUEUE_SIZE = 450
DEFAULT_MAX_JSON_QUEUE_SIZE = 1000
DEFAULT_MAX_FILES_PER_GATEWAY = 500
DEFAULT_JSON_MAX_BUFFER_SIZE = 1024 * 1024
MAX_PACKET_SIZE = 20 * 1024 * 1024


# ======================== Port maps ========================
FRAMED_GATEWAY_PORT_MAP = {
    "gateway_1": 11400,
    "gateway_2": 11401,
    "gateway_3": 11402,
    "gateway_4": 11403,
    "gateway_5": 11404,
    "gateway_6": 11405,
}

JSON_GATEWAY_PORT_MAP = {
    "gateway1": {
        "display": "Gateway1",
        "port": 11406,
        "aliases": {"gateway1", "gateway_1", "gw1", "g1", "1"},
    },
    "gateway2": {
        "display": "Gateway2",
        "port": 11407,
        "aliases": {"gateway2", "gateway_2", "gw2", "g2", "2"},
    },
    "gateway5": {
        "display": "Gateway5",
        "port": 11409,
        "aliases": {"gateway5", "gateway_5", "gw5", "g5", "5"},
    },
    "wifi": {
        "display": "WiFi",
        "port": 11408,
        "aliases": {"wifi", "wifi_gateway", "gw_wifi"},
    },
}

JSON_GATEWAY_ID_FIELDS = (
    "gateway",
    "gateway_id",
    "gateway_name",
    "source_gateway",
    "edge_gateway",
    "device_gateway",
)


# ======================== Common queue ========================
class DroppingQueue:
    def __init__(self, maxsize):
        self.maxsize = maxsize
        self._items = deque()
        self._condition = threading.Condition()

    def put(self, item):
        with self._condition:
            if len(self._items) >= self.maxsize:
                self._items.popleft()
            self._items.append(item)
            self._condition.notify()

    def get(self, timeout=None):
        with self._condition:
            if timeout is None:
                while not self._items:
                    self._condition.wait()
            else:
                deadline = time.time() + timeout
                while not self._items:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        raise queue.Empty()
                    self._condition.wait(timeout=remaining)
            return self._items.popleft()

    def clear(self):
        with self._condition:
            removed = len(self._items)
            self._items.clear()
            return removed

    def qsize(self):
        with self._condition:
            return len(self._items)


framed_queues = {}
json_queues = {}


# ======================== HTTP Device State API ========================
# 全局变量存储设备状态，用于 11501 端口的 GET 和 POST
DEVICE_STATE = {
    "baojingdeng": {"status": 0},
    "shuifa": {"status": 0}
}
state_lock = threading.Lock()

class DeviceStateHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        """发送允许跨域的 Header，前端 fetch 必需"""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        """处理浏览器的预检请求 (Preflight)"""
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        """设备端拉取最新状态"""
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        
        with state_lock:
            response_data = json.dumps(DEVICE_STATE).encode("utf-8")
        
        self.wfile.write(response_data)

    def do_POST(self):
        """处理 POST 请求：/alarm 接收火灾数据，/ 接收设备状态"""
        
        # ========== 处理 /alarm 路径 - 接收火灾检测数据 ==========
        if self.path == "/alarm":
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length <= 0 or content_length > 4096:
                    self.send_response(400)
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(b'{"status":"error", "message":"Invalid content length"}')
                    return
                    
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))
                
                if not isinstance(payload, dict):
                    self.send_response(400)
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(b'{"status":"error", "message":"Not a JSON object"}')
                    return
                
                # 确保有 gateway 字段，如果没有则添加默认值
                if "gateway" not in payload:
                    payload["gateway"] = "wifi"
                    print("[HTTP API] Added default gateway='wifi' to payload")
                
                print("[HTTP API] Received alarm data:", json.dumps(payload, ensure_ascii=False))
                
                # 查找对应的 JSON 队列
                gateway_id = find_json_gateway_id(payload)
                if gateway_id is None:
                    # 如果找不到，默认使用 wifi
                    gateway_id = "wifi"
                    print("[HTTP API] Using default gateway: wifi")
                
                # 放入对应的 JSON 队列
                if gateway_id in json_queues:
                    json_queues[gateway_id].put(json.dumps(payload, ensure_ascii=False))
                    print("[HTTP API] Queued to %s (port %s)" % (
                        gateway_id, 
                        JSON_GATEWAY_PORT_MAP.get(gateway_id, {}).get("port", "unknown")
                    ))
                    
                    self.send_response(200)
                    self._send_cors_headers()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"status":"ok", "gateway":"%s"}' % gateway_id.encode())
                    return
                else:
                    self.send_response(400)
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(b'{"status":"error", "message":"Gateway queue not found"}')
                    return
                    
            except json.JSONDecodeError as e:
                print("[HTTP API] JSON decode error:", e)
                self.send_response(400)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b'{"status":"error", "message":"Invalid JSON"}')
                return
            except Exception as e:
                print("[HTTP API ERROR]", e)
                self.send_response(500)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b'{"status":"error", "message":"Internal server error"}')
                return
        
        # ========== 原有的设备状态 POST 处理 (根路径) ==========
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            new_state = json.loads(post_data.decode('utf-8'))
            
            with state_lock:
                if "baojingdeng" in new_state:
                    DEVICE_STATE["baojingdeng"] = new_state["baojingdeng"]
                if "shuifa" in new_state:
                    DEVICE_STATE["shuifa"] = new_state["shuifa"]
            
            print("[HTTP API] Device state updated:", new_state)
            
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            
        except json.JSONDecodeError as e:
            print("[HTTP API] JSON decode error:", e)
            self.send_response(400)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"error", "message":"Invalid JSON"}')
        except Exception as e:
            print("[HTTP API ERROR]", e)
            self.send_response(500)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"error", "message":"Internal server error"}')

    def log_message(self, format, *args):
        # 屏蔽默认的 HTTP 日志，保持控制台整洁
        pass
    
def start_http_api_server(host, port):
    """启动 HTTP 状态服务"""
    server = ThreadingHTTPServer((host, port), DeviceStateHandler)
    print(" -> HTTP API server ready on %s (for device control)" % port)
    server.serve_forever()


# ======================== Old framed protocol ========================
def recv_exactly(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed")
        buf += chunk
    return buf


def recv_packet(sock, prefix=b""):
    if prefix:
        header = prefix + recv_exactly(sock, 12 - len(prefix))
    else:
        header = recv_exactly(sock, 12)

    packet_type_bytes, body_size = struct.unpack("!4sQ", header)
    packet_type = packet_type_bytes.decode("ascii", errors="replace")

    if body_size > MAX_PACKET_SIZE:
        raise ValueError("packet body too large: %s bytes" % body_size)

    body = recv_exactly(sock, body_size)
    return header, packet_type, body


def extract_jpeg_from_body(body):
    if len(body) < 4:
        return b""
    meta_len = struct.unpack("!I", body[:4])[0]
    if 4 + meta_len > len(body):
        return b""
    return body[4 + meta_len :]


def send_forward_packet(sock, gateway_id, timestamp, frame_seq, original_header, original_body):
    id_bytes = gateway_id.encode("utf-8")
    payload = struct.pack("!B", len(id_bytes))
    payload += id_bytes
    payload += struct.pack("!d", timestamp)
    payload += struct.pack("!I", frame_seq)
    payload += original_header
    payload += original_body
    sock.sendall(payload)


class ImageStorage:
    def __init__(self, base_dir, max_files=500):
        self.base_dir = base_dir
        self.max_files = max_files
        self._counters = defaultdict(int)
        self._write_queue = queue.Queue(maxsize=2000)
        self._pending_writes = defaultdict(int)
        self._lock = threading.Lock()
        self._all_done = threading.Condition(self._lock)
        self._thread = threading.Thread(target=self._writer_loop, daemon=True)
        self._thread.start()
        os.makedirs(base_dir, exist_ok=True)

    def save_async(self, gateway_id, packet_type, jpeg_data):
        if not jpeg_data:
            return
        try:
            self._write_queue.put_nowait((gateway_id, packet_type, jpeg_data))
            with self._lock:
                self._pending_writes[gateway_id] += 1
        except queue.Full:
            pass

    def _writer_loop(self):
        while True:
            gateway_id, packet_type, jpeg_data = self._write_queue.get()
            try:
                self._save_to_disk(gateway_id, packet_type, jpeg_data)
            except Exception:
                pass
            finally:
                with self._lock:
                    self._pending_writes[gateway_id] -= 1
                    if self._pending_writes[gateway_id] <= 0:
                        self._all_done.notify_all()

    def _save_to_disk(self, gateway_id, packet_type, jpeg_data):
        gateway_dir = os.path.join(self.base_dir, gateway_id, packet_type)
        os.makedirs(gateway_dir, exist_ok=True)
        counter_key = "%s_%s" % (gateway_id, packet_type)
        self._counters[counter_key] += 1
        seq = self._counters[counter_key]
        now = datetime.now()
        filename = "%s_%s_%06d.jpg" % (
            packet_type,
            now.strftime("%Y%m%d_%H%M%S"),
            seq,
        )
        with open(os.path.join(gateway_dir, filename), "wb") as writer:
            writer.write(jpeg_data)
        if seq % 100 == 0:
            self._cleanup(gateway_dir)

    def _cleanup(self, directory):
        try:
            files = sorted(os.listdir(directory))
            if len(files) > self.max_files:
                for filename in files[: len(files) - self.max_files]:
                    os.remove(os.path.join(directory, filename))
        except Exception:
            pass

    def clear_gateway(self, gateway_id):
        deadline = time.time() + 5.0
        with self._lock:
            while self._pending_writes[gateway_id] > 0 and deadline > time.time():
                self._all_done.wait(timeout=0.5)

        gateway_dir = os.path.join(self.base_dir, gateway_id)
        if os.path.exists(gateway_dir):
            try:
                shutil.rmtree(gateway_dir)
            except Exception:
                pass


def handle_framed_sender(conn, addr, storage, initial_prefix, custom_id):
    gateway_id = custom_id if custom_id else addr[0]
    if gateway_id not in framed_queues:
        framed_queues[gateway_id] = DroppingQueue(maxsize=DEFAULT_MAX_QUEUE_SIZE)

    frame_queue = framed_queues[gateway_id]
    print(
        "[+OLD UP] framed sender %s connected (%s:%s)"
        % (gateway_id, addr[0], addr[1])
    )

    try:
        frame_count = 0
        last_frame_count = 0
        last_report = time.time()
        prefix = initial_prefix

        while True:
            header, packet_type, body = recv_packet(conn, prefix)
            prefix = b""

            frame_count += 1
            timestamp = time.time()

            jpeg_data = extract_jpeg_from_body(body)
            storage.save_async(gateway_id, packet_type, jpeg_data)

            frame_queue.put((gateway_id, timestamp, frame_count, header, body))

            now = time.time()
            if now - last_report >= 5.0:
                fps = (frame_count - last_frame_count) / (now - last_report)
                print(
                    "[OLD UP STAT] %s total=%s rate=%.1f FPS queue=%s/%s"
                    % (
                        gateway_id,
                        frame_count,
                        fps,
                        frame_queue.qsize(),
                        frame_queue.maxsize,
                    )
                )
                last_report = now
                last_frame_count = frame_count

    except (ConnectionError, BrokenPipeError, ConnectionResetError, OSError):
        print("[-OLD UP] framed sender %s disconnected" % gateway_id)
    except Exception as exc:
        print("[OLD ERROR] framed sender %s failed: %s" % (gateway_id, exc))
    finally:
        removed = frame_queue.clear()
        if removed:
            print("[OLD CLEAN] cleared %s queued frames for %s" % (removed, gateway_id))
        storage.clear_gateway(gateway_id)
        try:
            conn.close()
        except OSError:
            pass


def handle_framed_receiver(conn, addr, gateway_id, pre_buffer_count):
    frame_queue = framed_queues[gateway_id]
    print(
        "[+OLD DOWN] core connected for %s on old channel (%s:%s)"
        % (gateway_id, addr[0], addr[1])
    )

    try:
        buffer = []
        deadline = time.time() + 5.0
        while len(buffer) < pre_buffer_count and time.time() < deadline:
            try:
                buffer.append(frame_queue.get(timeout=0.2))
            except queue.Empty:
                if buffer:
                    break

        for queued in buffer:
            gw_id, timestamp, seq, header, body = queued
            send_forward_packet(conn, gw_id, timestamp, seq, header, body)

        total_sent = len(buffer)
        last_total_sent = total_sent
        last_report = time.time()

        while True:
            try:
                gw_id, timestamp, seq, header, body = frame_queue.get(timeout=10.0)
            except queue.Empty:
                print("[OLD DOWN] %s no new frame, waiting..." % gateway_id)
                continue

            send_forward_packet(conn, gw_id, timestamp, seq, header, body)
            total_sent += 1

            now = time.time()
            if now - last_report >= 5.0:
                fps = (total_sent - last_total_sent) / (now - last_report)
                print(
                    "[OLD DOWN STAT] %s total=%s rate=%.1f FPS"
                    % (gateway_id, total_sent, fps)
                )
                last_report = now
                last_total_sent = total_sent

    except (ConnectionError, BrokenPipeError, ConnectionResetError, OSError):
        print("[-OLD DOWN] core disconnected for %s" % gateway_id)
    finally:
        try:
            conn.close()
        except OSError:
            pass


def start_framed_receiver_port(host, gateway_id, port, pre_buffer_count):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.listen(5)
    print(" -> old framed channel %s for %s" % (port, gateway_id))

    while True:
        try:
            conn, addr = sock.accept()
            threading.Thread(
                target=handle_framed_receiver,
                args=(conn, addr, gateway_id, pre_buffer_count),
                daemon=True,
            ).start()
        except Exception as exc:
            print("[OLD PORT ERROR] %s: %s" % (port, exc))


# ======================== New JSON protocol ========================
def normalize_gateway_id(value):
    text = str(value).strip().lower()
    return "".join(ch for ch in text if ch.isalnum())


def find_json_gateway_id(payload):
    if not isinstance(payload, dict):
        return None

    alias_to_gateway = {}
    for gateway_id, config in JSON_GATEWAY_PORT_MAP.items():
        for alias in config["aliases"]:
            alias_to_gateway[normalize_gateway_id(alias)] = gateway_id

    for field in JSON_GATEWAY_ID_FIELDS:
        if field not in payload:
            continue
        normalized = normalize_gateway_id(payload[field])
        if normalized in alias_to_gateway:
            return alias_to_gateway[normalized]

    for value in payload.values():
        normalized = normalize_gateway_id(value)
        if normalized in alias_to_gateway:
            return alias_to_gateway[normalized]

    return None


class JsonObjectExtractor:
    def __init__(self, max_buffer_size):
        self.max_buffer_size = max_buffer_size
        self.buffer = ""
        self.start = None
        self.depth = 0
        self.in_string = False
        self.escaped = False
        self.scan_position = 0

    @property
    def remainder(self):
        return self.buffer

    def feed(self, text):
        self.buffer += text
        if len(self.buffer.encode("utf-8")) > self.max_buffer_size:
            self.reset()
            raise BufferError("JSON receive buffer exceeded %s bytes" % self.max_buffer_size)

        objects = []
        index = self.scan_position

        while index < len(self.buffer):
            ch = self.buffer[index]

            if self.start is None:
                if ch == "{":
                    if index > 0:
                        self.buffer = self.buffer[index:]
                        index = 0
                    self.start = 0
                    self.depth = 1
                    self.in_string = False
                    self.escaped = False
                    index += 1
                else:
                    index += 1
                continue

            if self.in_string:
                if self.escaped:
                    self.escaped = False
                elif ch == "\\":
                    self.escaped = True
                elif ch == '"':
                    self.in_string = False
            elif ch == '"':
                self.in_string = True
            elif ch == "{":
                self.depth += 1
            elif ch == "}":
                self.depth -= 1
                if self.depth == 0:
                    end = index + 1
                    objects.append(self.buffer[self.start : end])
                    self.buffer = self.buffer[end:]
                    self.start = None
                    self.scan_position = 0
                    index = 0
                    continue

            index += 1

        self.scan_position = index
        return objects

    def reset(self):
        self.buffer = ""
        self.start = None
        self.depth = 0
        self.in_string = False
        self.escaped = False
        self.scan_position = 0


def enqueue_json(json_data, addr):
    try:
        payload = json.loads(json_data)
    except json.JSONDecodeError as exc:
        print("[JSON WARN] invalid JSON from %s:%s: %s" % (addr[0], addr[1], exc))
        return False

    gateway_id = find_json_gateway_id(payload)
    if gateway_id is None:
        print(
            "[JSON WARN] cannot route JSON from %s:%s, missing Gateway1/Gateway2 field: %s"
            % (addr[0], addr[1], json_data)
        )
        return False

    json_queues[gateway_id].put(json_data)
    config = JSON_GATEWAY_PORT_MAP[gateway_id]
    print(
        "[JSON UP] %s -> queued for port %s, queue=%s/%s"
        % (
            config["display"],
            config["port"],
            json_queues[gateway_id].qsize(),
            json_queues[gateway_id].maxsize,
        )
    )
    return True


def handle_json_sender(conn, addr, initial_bytes, max_buffer_size):
    print("[+JSON UP] socketproject gateway connected (%s:%s)" % (addr[0], addr[1]))
    extractor = JsonObjectExtractor(max_buffer_size)
    decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
    total_received = 0
    last_total = 0
    last_report = time.time()

    try:
        with conn:
            if initial_bytes:
                text = decoder.decode(initial_bytes)
                for json_data in extractor.feed(text):
                    if enqueue_json(json_data, addr):
                        total_received += 1

            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break

                text = decoder.decode(chunk)
                try:
                    json_objects = extractor.feed(text)
                except BufferError as exc:
                    print("[JSON WARN] %s:%s buffer reset: %s" % (addr[0], addr[1], exc))
                    continue

                for json_data in json_objects:
                    if enqueue_json(json_data, addr):
                        total_received += 1

                now = time.time()
                if now - last_report >= 5.0:
                    rate = (total_received - last_total) / (now - last_report)
                    print(
                        "[JSON UP STAT] %s:%s total=%s rate=%.1f json/s"
                        % (addr[0], addr[1], total_received, rate)
                    )
                    last_report = now
                    last_total = total_received

            final_text = decoder.decode(b"", final=True)
            if final_text:
                for json_data in extractor.feed(final_text):
                    if enqueue_json(json_data, addr):
                        total_received += 1
    except (ConnectionResetError, UnicodeDecodeError, OSError) as exc:
        print("[JSON ERROR] sender %s:%s failed: %s" % (addr[0], addr[1], exc))
    finally:
        if extractor.remainder.strip():
            print(
                "[JSON WARN] sender %s:%s closed with incomplete data: %s"
                % (addr[0], addr[1], extractor.remainder)
            )
        print("[-JSON UP] socketproject gateway disconnected (%s:%s)" % (addr[0], addr[1]))


def handle_json_receiver(conn, addr, gateway_id):
    config = JSON_GATEWAY_PORT_MAP[gateway_id]
    json_queue = json_queues[gateway_id]
    print(
        "[+JSON DOWN] core connected on %s for %s (%s:%s)"
        % (config["port"], config["display"], addr[0], addr[1])
    )

    total_sent = 0
    last_total = 0
    last_report = time.time()

    try:
        with conn:
            while True:
                try:
                    json_data = json_queue.get(timeout=10.0)
                except queue.Empty:
                    print(
                        "[JSON DOWN] %s port %s has no new JSON, waiting..."
                        % (config["display"], config["port"])
                    )
                    continue

                conn.sendall(json_data.encode("utf-8") + b"\n")
                total_sent += 1

                now = time.time()
                if now - last_report >= 5.0:
                    rate = (total_sent - last_total) / (now - last_report)
                    print(
                        "[JSON DOWN STAT] %s port=%s total=%s rate=%.1f json/s"
                        % (config["display"], config["port"], total_sent, rate)
                    )
                    last_report = now
                    last_total = total_sent

    except (BrokenPipeError, ConnectionResetError, OSError) as exc:
        print(
            "[JSON WARN] core disconnected from %s port %s: %s"
            % (config["display"], config["port"], exc)
        )
    finally:
        print(
            "[-JSON DOWN] core closed for %s (%s:%s)"
            % (config["display"], addr[0], addr[1])
        )


def start_json_receiver_port(host, gateway_id):
    config = JSON_GATEWAY_PORT_MAP[gateway_id]
    port = config["port"]

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.listen(5)
    print(" -> JSON channel %s for %s" % (port, config["display"]))

    while True:
        try:
            conn, addr = sock.accept()
            threading.Thread(
                target=handle_json_receiver,
                args=(conn, addr, gateway_id),
                daemon=True,
            ).start()
        except Exception as exc:
            print("[JSON PORT ERROR] %s: %s" % (port, exc))


# ======================== Upstream protocol dispatcher ========================
def handle_incoming_connection(conn, addr, storage, json_max_buffer_size):
    try:
        first_byte = recv_exactly(conn, 1)
        if first_byte == b"V":
            handle_framed_sender(conn, addr, storage, b"V", None)
        elif first_byte == b"S":
            next_byte = recv_exactly(conn, 1)
            if next_byte == b"N":
                handle_framed_sender(conn, addr, storage, b"SN", None)
            else:
                id_len = struct.unpack("!B", next_byte)[0]
                custom_id = recv_exactly(conn, id_len).decode("utf-8", errors="replace")
                handle_framed_sender(conn, addr, storage, b"", custom_id)
        else:
            handle_json_sender(conn, addr, first_byte, json_max_buffer_size)
    except ConnectionError:
        try:
            conn.close()
        except OSError:
            pass
    except Exception as exc:
        print("[DISPATCH ERROR] %s:%s failed: %s" % (addr[0], addr[1], exc))
        try:
            conn.close()
        except OSError:
            pass


def start_upstream_port(host, port, storage, json_max_buffer_size):
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_sock.bind((host, port))
    server_sock.listen(50)
    print(" -> upstream port %s ready for old framed and new JSON senders" % port)

    try:
        while True:
            conn, addr = server_sock.accept()
            threading.Thread(
                target=handle_incoming_connection,
                args=(conn, addr, storage, json_max_buffer_size),
                daemon=True,
            ).start()
    finally:
        server_sock.close()


# ======================== Main ========================
def main():
    parser = argparse.ArgumentParser(
        description="Server router compatible with old framed protocol and new JSON protocol."
    )
    parser.add_argument("--host", default=DEFAULT_LISTEN_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_SENDER_PORT)
    parser.add_argument("--http-port", type=int, default=DEFAULT_HTTP_API_PORT, help="Port for HTTP Device API (11501)")
    parser.add_argument("--storage", default=DEFAULT_STORAGE_DIR)
    parser.add_argument("--max-queue", type=int, default=DEFAULT_MAX_QUEUE_SIZE)
    parser.add_argument("--max-json-queue", type=int, default=DEFAULT_MAX_JSON_QUEUE_SIZE)
    parser.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES_PER_GATEWAY)
    parser.add_argument("--pre-buffer", type=int, default=15)
    parser.add_argument("--json-max-buffer", type=int, default=DEFAULT_JSON_MAX_BUFFER_SIZE)
    args = parser.parse_args()

    for gateway_id in FRAMED_GATEWAY_PORT_MAP:
        framed_queues[gateway_id] = DroppingQueue(args.max_queue)
    for gateway_id in JSON_GATEWAY_PORT_MAP:
        json_queues[gateway_id] = DroppingQueue(args.max_json_queue)

    storage = ImageStorage(args.storage, args.max_files)

    print("")
    print("=" * 70)
    print(" Server router: old framed protocol + new JSON protocol + HTTP API")
    print(" upstream listen (general TCP): %s:%s" % (args.host, args.port))
    print(" upstream listen (HTTP Device API): %s:%s" % (args.host, args.http_port))
    print("")
    print(" old framed downstream:")
    for gateway_id, port in FRAMED_GATEWAY_PORT_MAP.items():
        print("   %s -> %s" % (gateway_id, port))
    print("")
    print(" new JSON downstream:")
    for config in JSON_GATEWAY_PORT_MAP.values():
        print("   %s -> %s" % (config["display"], config["port"]))
    print("=" * 70)
    print("")

    # 启动所有旧协议下发监听
    for gateway_id, port in FRAMED_GATEWAY_PORT_MAP.items():
        threading.Thread(
            target=start_framed_receiver_port,
            args=(args.host, gateway_id, port, args.pre_buffer),
            daemon=True,
        ).start()

    # 启动所有 JSON 协议下发监听
    for gateway_id in JSON_GATEWAY_PORT_MAP:
        threading.Thread(
            target=start_json_receiver_port,
            args=(args.host, gateway_id),
            daemon=True,
        ).start()

    # 启动 HTTP 状态 API 监听 (11501)
    threading.Thread(
        target=start_http_api_server,
        args=(args.host, args.http_port),
        daemon=True,
    ).start()

    # 启动通用的 11500 监听
    try:
        start_upstream_port(args.host, args.port, storage, args.json_max_buffer)
    except KeyboardInterrupt:
        print("\n[STOP] server stopped")


if __name__ == "__main__":
    main()