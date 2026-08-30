#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
边缘网关 JSON 转发程序。

用途：
  - 部署在板子上运行。
  - 本地监听 socketproject JSON 数据，默认 0.0.0.0:8888。
  - 给 JSON 自动补充 gateway 字段。
  - 转发到云服务器 old_server.py 的 11500 入口。

云服务器 old_server.py 会把：
  - Gateway1 JSON 分流到 11406
  - Gateway2 JSON 分流到 11407
"""

import argparse
import codecs
import json
import queue
import socket
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from collections import deque


DEFAULT_LISTEN_HOST = "0.0.0.0"
DEFAULT_LISTEN_PORT = 8888
DEFAULT_CLOUD_HOST = "47.99.47.169"
DEFAULT_CLOUD_PORT = 11500
DEFAULT_GATEWAY_ID = "Gateway1"
DEFAULT_MAX_BUFFER_SIZE = 20 * 1024 * 1024
DEFAULT_MAX_QUEUE_SIZE = 1000
RECONNECT_INTERVAL = 3.0
REPORT_INTERVAL = 5.0
TIME_SET_INTERVAL = 2.0

# ---- 白名单 (HTTP, 服务器 11502 端口) ----
DEFAULT_WHITELIST_CLOUD_PORT = 11502
DEFAULT_WHITELIST_INTERVAL = 30.0      # 从服务器拉取(接收)白名单的周期(秒)
DEFAULT_WHITELIST_FILE = "whitelist.json"
DEFAULT_WHITELIST_HTTP_TIMEOUT = 5     # HTTP 请求超时(秒)

RESYNC_MARKERS = (
    '{"packet_type"',
    '{"type"',
    '{"timestamp"',
    '{"gateway"',
    '{"gateway_id"',
    '{"data_source"',
)


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(message):
    print("[{}] {}".format(now_str(), message), flush=True)


class DroppingQueue:
    def __init__(self, maxsize):
        self.maxsize = maxsize
        self._items = deque()
        self._cond = threading.Condition()

    def put(self, item):
        with self._cond:
            if len(self._items) >= self.maxsize:
                self._items.popleft()
            self._items.append(item)
            self._cond.notify()

    def put_front(self, item):
        with self._cond:
            if len(self._items) >= self.maxsize:
                self._items.pop()
            self._items.appendleft(item)
            self._cond.notify()

    def get(self, timeout=None):
        with self._cond:
            if timeout is None:
                while not self._items:
                    self._cond.wait()
            else:
                deadline = time.time() + timeout
                while not self._items:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        raise queue.Empty()
                    self._cond.wait(timeout=remaining)
            return self._items.popleft()

    def qsize(self):
        with self._cond:
            return len(self._items)


class JsonStreamExtractor:
    """从连续 TCP 文本流里提取 JSON 对象，遇到坏包会尝试重新同步。"""

    def __init__(self, max_buffer_size):
        self.max_buffer_size = max_buffer_size
        self.buffer = ""
        self.decoder = json.JSONDecoder()
        self.dropped_bytes = 0
        self.bad_objects = 0

    @property
    def remainder(self):
        return self.buffer

    def feed(self, text):
        self.buffer += text
        objects = []

        while True:
            start = self.buffer.find("{")
            if start < 0:
                self.dropped_bytes += len(self.buffer.encode("utf-8", errors="ignore"))
                self.buffer = ""
                break
            if start > 0:
                self.dropped_bytes += len(self.buffer[:start].encode("utf-8", errors="ignore"))
                self.buffer = self.buffer[start:]

            try:
                payload, end = self.decoder.raw_decode(self.buffer)
            except json.JSONDecodeError:
                next_start = self._find_next_object_start()
                if next_start is not None:
                    self.bad_objects += 1
                    self.dropped_bytes += len(self.buffer[:next_start].encode("utf-8", errors="ignore"))
                    self.buffer = self.buffer[next_start:]
                    continue

                if len(self.buffer.encode("utf-8", errors="ignore")) > self.max_buffer_size:
                    self.bad_objects += 1
                    self.dropped_bytes += len(self.buffer.encode("utf-8", errors="ignore"))
                    self.buffer = ""
                    raise BufferError("JSON 缓冲区超过最大容量 {} 字节，已清空".format(self.max_buffer_size))

                break

            self.buffer = self.buffer[end:]
            if isinstance(payload, dict):
                objects.append(payload)
            else:
                self.bad_objects += 1

        return objects

    def _find_next_object_start(self):
        positions = []
        for marker in RESYNC_MARKERS:
            pos = self.buffer.find(marker, 1)
            if pos >= 0:
                positions.append(pos)
        if not positions:
            return None
        return min(positions)

    def remainder_preview(self, max_chars=200):
        text = self.buffer.strip()
        if len(text) <= max_chars:
            return text
        return text[:max_chars] + "...<truncated>"


def enrich_payload(payload, gateway_id):
    if not isinstance(payload, dict):
        raise ValueError("JSON 顶层必须是对象")

    if "gateway" not in payload and "gateway_id" not in payload:
        payload["gateway"] = gateway_id
    if "edge_gateway" not in payload:
        payload["edge_gateway"] = gateway_id

    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def extract_device_id(payload):
    """从 payload 中提取设备 ID, 用于白名单匹配。默认取 data_content.id。"""
    if not isinstance(payload, dict):
        return None
    content = payload.get("data_content")
    if isinstance(content, dict):
        dev = content.get("id") or content.get("device_id") or content.get("mac")
    elif isinstance(content, str):
        try:
            parsed = json.loads(content)
            dev = parsed.get("id") if isinstance(parsed, dict) else None
        except Exception:
            dev = None
    else:
        dev = None
    if not dev:
        dev = payload.get("device_id") or payload.get("mac")
    return str(dev) if dev is not None else None


def _whitelist_allow(payload, whitelist, gateway_id):
    """白名单检查: 放行返回 True。
    id 不在白名单时, 构造一条'发送失败'消息(结构同正常发送、内容改为失败),
    打印到日志方便调试, 并返回 False(原始数据不转发)。"""
    dev_id = extract_device_id(payload)
    if dev_id is None or whitelist.is_allowed(dev_id):
        return True
    reject = {
        "packet_type": payload.get("packet_type", payload.get("type", "")),
        "timestamp": payload.get("timestamp", ""),
        "id": dev_id,
        "send_status": "发送失败",
        "reason": "not_in_whitelist",
        "encrypted": payload.get("encrypted", ""),
        "gateway": gateway_id,
        "edge_gateway": gateway_id,
    }
    reject_out = json.dumps(reject, ensure_ascii=False, separators=(",", ":"))
    log("[白名单][拦截] id={} 不在白名单 -> 构造'发送失败'消息(不转发): {}".format(dev_id, reject_out))
    return False


class WhitelistManager:
    """通过 HTTP 与服务器 11502 端口同步白名单。

    - fetch():       GET  拉取(接收)服务器白名单, 更新本地缓存
    - push(devices): POST 把白名单下发到服务器
    - sync_loop():   周期性 fetch
    - is_allowed():  白名单为空 => 放行全部; 否则仅放行白名单内设备
    """

    def __init__(self, base_url, interval, cache_file,
                 timeout=DEFAULT_WHITELIST_HTTP_TIMEOUT):
        self.url = base_url.rstrip("/")
        if not self.url.endswith("/"):
            self.url += "/"
        self.interval = interval
        self.cache_file = cache_file
        self.timeout = timeout
        self._lock = threading.Lock()
        self._devices = set()
        self._load_cache()

    def _load_cache(self):
        try:
            with open(self.cache_file, "r", encoding="utf-8") as f:
                self._devices = set(json.load(f).get("devices", []))
        except Exception:
            self._devices = set()

    def get_devices(self):
        with self._lock:
            return set(self._devices)

    def is_allowed(self, device_id):
        with self._lock:
            if not self._devices:
                return True
            return device_id in self._devices

    def fetch(self):
        log("[白名单] 正在从 {} 拉取白名单...".format(self.url))
        req = urllib.request.Request(self.url, method="GET")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        devices = set(data.get("devices", []))
        with self._lock:
            self._devices = devices
        try:
            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump({"devices": sorted(devices)}, f, ensure_ascii=False, indent=2)
        except Exception as exc:
            log("[白名单] 本地缓存写入失败: {}".format(exc))
        log("[白名单] 已接收 {} 个设备: {}".format(
            len(devices), json.dumps(sorted(devices), ensure_ascii=False)))
        return devices

    def push(self, devices):
        body = json.dumps({"devices": list(devices)}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.url, data=body, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            resp.read()
        log("[白名单] 已向服务器下发 {} 个设备".format(len(devices)))

    def sync_loop(self):
        while True:
            time.sleep(self.interval)
            try:
                self.fetch()
            except urllib.error.URLError as exc:
                log("[白名单] 同步失败(网络): {}".format(exc))
            except Exception as exc:
                log("[白名单] 同步失败: {}".format(exc))


class CloudSender:
    def __init__(self, host, port, send_queue):
        self.host = host
        self.port = port
        self.send_queue = send_queue
        self._sock = None
        self._sent_total = 0
        self._last_sent_total = 0
        self._last_report = time.time()

    def run_forever(self):
        while True:
            json_data = self.send_queue.get()
            while True:
                try:
                    self._ensure_connected()
                    self._sock.sendall(json_data.encode("utf-8") + b"\n")
                    self._sent_total += 1
                    self._report_if_needed()
                    break
                except OSError as exc:
                    log("发送到云服务器失败: {}，{} 秒后重连".format(exc, RECONNECT_INTERVAL))
                    self._close()
                    time.sleep(RECONNECT_INTERVAL)

    def _ensure_connected(self):
        if self._sock is not None:
            return
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10.0)
        sock.connect((self.host, self.port))
        sock.settimeout(None)
        self._sock = sock
        log("已连接云服务器 {}:{}".format(self.host, self.port))

    def _close(self):
        if self._sock is None:
            return
        try:
            self._sock.close()
        except OSError:
            pass
        self._sock = None

    def _report_if_needed(self):
        now = time.time()
        elapsed = now - self._last_report
        if elapsed < REPORT_INTERVAL:
            return
        speed = (self._sent_total - self._last_sent_total) / elapsed
        log("云端发送统计: 累计 {} 条 | {:.1f} 条/秒 | 队列 {}/{}".format(
            self._sent_total,
            speed,
            self.send_queue.qsize(),
            self.send_queue.maxsize,
        ))
        self._last_report = now
        self._last_sent_total = self._sent_total


def time_set_downlink_loop(conn, addr):
    log("[TIME_SET] downlink started {}:{} every {:.1f}s".format(addr[0], addr[1], TIME_SET_INTERVAL))
    sent_total = 0

    while True:
        payload = json.dumps(
            {"cmd": "time_set", "val": now_str()},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
        try:
            conn.sendall(payload)
            sent_total += 1
            log("[TIME_SET] downlink sent {}:{} total={} {}".format(
                addr[0],
                addr[1],
                sent_total,
                payload.decode("utf-8").strip(),
            ))
        except OSError as exc:
            log("[TIME_SET] downlink stopped {}:{} {}".format(addr[0], addr[1], exc))
            break

        time.sleep(TIME_SET_INTERVAL)


def handle_local_client(conn, addr, send_queue, gateway_id, max_buffer_size, whitelist=None, whitelist_filter=False):
    log("本地 JSON 客户端已连接 {}:{}".format(addr[0], addr[1]))
    extractor = JsonStreamExtractor(max_buffer_size)
    decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
    received_total = 0
    queued_total = 0
    last_received_total = 0
    last_report = time.time()

    try:
        with conn:
            threading.Thread(
                target=time_set_downlink_loop,
                args=(conn, addr),
                daemon=True,
            ).start()

            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                text = decoder.decode(chunk)
                try:
                    payloads = extractor.feed(text)
                except BufferError as exc:
                    log("本地 JSON 缓冲区已清空: {}".format(exc))
                    continue

                for payload in payloads:
                    received_total += 1
                    if whitelist_filter and whitelist is not None:
                        if not _whitelist_allow(payload, whitelist, gateway_id):
                            continue
                    try:
                        outgoing = enrich_payload(payload, gateway_id)
                    except Exception as exc:
                        log("JSON 无法转发: {}，packet_id={}".format(exc, payload.get("packet_id", "")))
                        continue
                    send_queue.put(outgoing)
                    queued_total += 1

                now = time.time()
                elapsed = now - last_report
                if elapsed >= REPORT_INTERVAL:
                    speed = (received_total - last_received_total) / elapsed
                    log("本地接收统计 {}:{}: 累计 {} 条 | {:.1f} 条/秒 | 已入队 {} 条 | 队列 {}/{} | 坏包 {} | 丢弃 {} 字节".format(
                        addr[0],
                        addr[1],
                        received_total,
                        speed,
                        queued_total,
                        send_queue.qsize(),
                        send_queue.maxsize,
                        extractor.bad_objects,
                        extractor.dropped_bytes,
                    ))
                    last_report = now
                    last_received_total = received_total

            final_text = decoder.decode(b"", final=True)
            if final_text:
                for payload in extractor.feed(final_text):
                    if whitelist_filter and whitelist is not None:
                        if not _whitelist_allow(payload, whitelist, gateway_id):
                            continue
                    try:
                        outgoing = enrich_payload(payload, gateway_id)
                    except Exception as exc:
                        log("JSON 无法转发: {}，packet_id={}".format(exc, payload.get("packet_id", "")))
                        continue
                    send_queue.put(outgoing)
    except (ConnectionResetError, UnicodeDecodeError, OSError) as exc:
        log("本地 JSON 客户端异常 {}:{} {}".format(addr[0], addr[1], exc))
    finally:
        if extractor.remainder.strip():
            log("本地客户端断开，存在未完整 JSON: 剩余 {} 字节，预览 {}".format(
                len(extractor.remainder.encode("utf-8", errors="ignore")),
                extractor.remainder_preview(),
            ))
        log("本地 JSON 客户端统计 {}:{}: 接收 {} 条，入队 {} 条，坏包 {}，丢弃 {} 字节".format(
            addr[0],
            addr[1],
            received_total,
            queued_total,
            extractor.bad_objects,
            extractor.dropped_bytes,
        ))
        log("本地 JSON 客户端已断开 {}:{}".format(addr[0], addr[1]))


def serve_local_json(host, port, send_queue, gateway_id, max_buffer_size, whitelist=None, whitelist_filter=False):
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_sock.bind((host, port))
    server_sock.listen(20)
    log("本地 JSON 监听已启动 {}:{}，网关标识 {}".format(host, port, gateway_id))

    try:
        while True:
            conn, addr = server_sock.accept()
            threading.Thread(
                target=handle_local_client,
                args=(conn, addr, send_queue, gateway_id, max_buffer_size, whitelist, whitelist_filter),
                daemon=True,
            ).start()
    finally:
        server_sock.close()


def send_once(host, port, gateway_id, json_text):
    outgoing = enrich_payload(json.loads(json_text), gateway_id)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(10.0)
        sock.connect((host, port))
        sock.sendall(outgoing.encode("utf-8") + b"\n")
    log("测试 JSON 已发送到云服务器 {}:{}".format(host, port))


def main():
    parser = argparse.ArgumentParser(description="边缘网关 JSON 转发程序")
    parser.add_argument("--listen-host", default=DEFAULT_LISTEN_HOST)
    parser.add_argument("--listen-port", type=int, default=DEFAULT_LISTEN_PORT)
    parser.add_argument("--cloud-host", default=DEFAULT_CLOUD_HOST)
    parser.add_argument("--cloud-port", type=int, default=DEFAULT_CLOUD_PORT)
    parser.add_argument("--gateway", default=DEFAULT_GATEWAY_ID, help="Gateway1 或 Gateway2")
    parser.add_argument("--max-buffer", type=int, default=DEFAULT_MAX_BUFFER_SIZE)
    parser.add_argument("--max-queue", type=int, default=DEFAULT_MAX_QUEUE_SIZE)
    parser.add_argument("--send-once", help="只发送一条 JSON 后退出，用于连通性测试")
    parser.add_argument("--whitelist-url", default=None,
                        help="白名单 HTTP 地址; 默认 http://<cloud-host>:11502/")
    parser.add_argument("--whitelist-interval", type=float, default=DEFAULT_WHITELIST_INTERVAL,
                        help="从服务器拉取(接收)白名单的周期(秒), <=0 则关闭自动拉取")
    parser.add_argument("--whitelist-file", default=DEFAULT_WHITELIST_FILE,
                        help="本地白名单缓存文件")
    parser.add_argument("--whitelist-filter", action="store_true",
                        help="启用白名单过滤: 仅转发白名单内设备的数据")
    parser.add_argument("--post-whitelist", default=None,
                        help="一次性: 把该 JSON 文件中的白名单 POST 下发到服务器后退出")
    args = parser.parse_args()

    if args.send_once:
        send_once(args.cloud_host, args.cloud_port, args.gateway, args.send_once)
        return

    if args.post_whitelist:
        wl_url = args.whitelist_url or "http://{}:{}/".format(args.cloud_host, DEFAULT_WHITELIST_CLOUD_PORT)
        manager = WhitelistManager(wl_url, args.whitelist_interval, args.whitelist_file)
        with open(args.post_whitelist, "r", encoding="utf-8") as f:
            devices = json.load(f).get("devices", [])
        manager.push(devices)
        return

    send_queue = DroppingQueue(args.max_queue)
    sender = CloudSender(args.cloud_host, args.cloud_port, send_queue)
    threading.Thread(target=sender.run_forever, daemon=True).start()

    # ---- 白名单: 与服务器 11502 端口同步 (GET 接收 / POST 下发) ----
    wl_url = args.whitelist_url or "http://{}:{}/".format(args.cloud_host, DEFAULT_WHITELIST_CLOUD_PORT)
    whitelist = WhitelistManager(wl_url, args.whitelist_interval, args.whitelist_file)
    log("[白名单] 启动首次拉取: {}".format(wl_url))
    try:
        whitelist.fetch()
    except Exception as exc:
        log("[白名单] 首次拉取失败: {}".format(exc))
    if args.whitelist_filter:
        log("[白名单] 过滤已启用, 当前白名单 {} 个设备".format(len(whitelist.get_devices())))
    if args.whitelist_interval > 0:
        threading.Thread(target=whitelist.sync_loop, daemon=True).start()
        log("[白名单] 同步线程已启动, 周期 {}s".format(args.whitelist_interval))

    serve_local_json(
        args.listen_host,
        args.listen_port,
        send_queue,
        args.gateway,
        args.max_buffer,
        whitelist,
        args.whitelist_filter,
    )


if __name__ == "__main__":
    main()
