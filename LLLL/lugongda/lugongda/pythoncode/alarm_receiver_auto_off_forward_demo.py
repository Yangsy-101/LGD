#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
alarm_receiver_auto_off_forward.py
HTTP receiver + RS485 alarm control + auto-off + forward raw JSON to a wired target.

- POST /alarm with JSON body, e.g. {"source":"fire_board","fire":true,"timestamp":"2026-05-24 16:30:12"}
- fire=true triggers alarm; repeated fire=true refreshes auto-off timer.
- fire=false is supported for manual reset.
- GET /status returns state.
- Forwarder sends the original raw JSON body to another device.
"""

import argparse
import json
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple

import requests
import serial

FORWARD_HTTP = {
    "url": "http://172.16.110.1:9000/alarm",
    "timeout": 0.4,
    "retry_interval": 0.1,
}


def now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def parse_fire(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        value = value.strip().lower()
        if value in ("true", "1", "on", "alarm", "fire"):
            return True
        if value in ("false", "0", "off", "clear", "safe", "nofire"):
            return False
    return None


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = ((crc >> 1) ^ 0xA001) if (crc & 1) else (crc >> 1)
    return crc & 0xFFFF


def add_crc(data: bytes) -> bytes:
    crc = crc16_modbus(data)
    return data + bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def hex_bytes(data: bytes) -> str:
    return " ".join("{:02X}".format(x) for x in data)


class AlarmLightController:
    """Modbus-RTU alarm light control."""

    def __init__(self, port: str, addr: int = 1, baudrate: int = 9600,
                 timeout: float = 0.8, red_blink_value: int = 5) -> None:
        self.port = port
        self.addr = int(addr)
        self.baudrate = int(baudrate)
        self.timeout = max(0.1, float(timeout))
        self.red_blink_value = max(1, min(10, int(red_blink_value)))
        self.ser: Optional[serial.Serial] = None
        self._lock = threading.Lock()

    def open(self) -> None:
        self.ser = serial.Serial(
            port=self.port, baudrate=self.baudrate, bytesize=8,
            parity="N", stopbits=1, timeout=self.timeout
        )
        self.ser.reset_input_buffer()
        self.ser.reset_output_buffer()
        print("[{}] SERIAL | opened port={} addr={} baud={}".format(
            now_str(), self.port, self.addr, self.baudrate))

    def close(self) -> None:
        with self._lock:
            if self.ser is not None:
                try:
                    self.ser.close()
                except Exception:
                    pass
                self.ser = None

    def _write_state(self, red: int = 0, green: int = 0, yellow: int = 0,
                     blue: int = 0, white: int = 0, buzzer: int = 0) -> Tuple[bool, str]:
        if self.ser is None:
            return False, "serial port is not open"

        values = [red, green, yellow, blue, white, 0, 0, 0, 0, 0, buzzer]
        qty = len(values)
        frame = bytearray([self.addr, 0x10, 0x00, 0x00, 0x00, qty, qty * 2])
        for value in values:
            value = int(value) & 0xFFFF
            frame.extend([(value >> 8) & 0xFF, value & 0xFF])
        tx = add_crc(bytes(frame))

        with self._lock:
            try:
                self.ser.reset_input_buffer()
                self.ser.write(tx)
                self.ser.flush()
                rx = self.ser.read(8)
            except Exception as exc:
                return False, "serial error: {}".format(exc)

        print("[{}] RS485  | TX {}".format(now_str(), hex_bytes(tx)))
        if not rx:
            print("[{}] RS485  | RX <no response>".format(now_str()))
            return False, "no response"
        print("[{}] RS485  | RX {}".format(now_str(), hex_bytes(rx)))

        if len(rx) != 8:
            return False, "bad response length={}".format(len(rx))
        if crc16_modbus(rx[:-2]) != (rx[-2] | (rx[-1] << 8)):
            return False, "bad response CRC"
        if rx[0] != self.addr or rx[1] != 0x10:
            return False, "unexpected response"
        return True, "ok"

    def alarm_on(self) -> Tuple[bool, str]:
        return self._write_state(red=self.red_blink_value, yellow=99, buzzer=0)

    def alarm_off(self) -> Tuple[bool, str]:
        return self._write_state()


class AlarmSerialWorker:
    """Async serial worker that keeps only the latest requested action."""

    def __init__(self, light: AlarmLightController, on_result) -> None:
        self.light = light
        self.on_result = on_result
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._stop = False
        self._latest_action: Optional[Dict[str, Any]] = None
        self._thread = threading.Thread(target=self._worker_loop, name="alarm-serial-worker", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop = True
        self._event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1.5)

    def submit(self, action: str, reason: str) -> None:
        if action not in ("on", "off"):
            return
        with self._lock:
            self._latest_action = {
                "action": action,
                "reason": reason,
                "ts": time.time(),
            }
        self._event.set()

    def _pop_latest(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            action = self._latest_action
            self._latest_action = None
            self._event.clear()
        return action

    def _worker_loop(self) -> None:
        while not self._stop:
            self._event.wait(timeout=0.5)
            item = self._pop_latest()
            if item is None:
                continue
            if item["action"] == "on":
                ok, detail = self.light.alarm_on()
            else:
                ok, detail = self.light.alarm_off()
            self.on_result(item, ok, detail)


class HttpForwarder:
    """Forward raw JSON bytes in background, keep only the latest payload."""

    def __init__(self, url: str, timeout: float = 0.4, retry_interval: float = 0.1) -> None:
        self.url = url
        self.timeout = max(0.1, float(timeout))
        self.retry_interval = max(0.05, float(retry_interval))
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._stop = False
        self._latest: Optional[Tuple[bytes, str]] = None
        self._session = requests.Session()
        self._thread = threading.Thread(target=self._worker_loop, name="http-forwarder", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop = True
        self._event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1.0)
        self._session.close()

    def submit(self, raw_body: bytes, content_type: str) -> None:
        if not self.url:
            return
        with self._lock:
            self._latest = (raw_body, content_type)
        self._event.set()

    def _pop_latest(self) -> Optional[Tuple[bytes, str]]:
        with self._lock:
            item = self._latest
            self._latest = None
            self._event.clear()
        return item

    def _worker_loop(self) -> None:
        while not self._stop:
            self._event.wait(timeout=0.5)
            item = self._pop_latest()
            if item is None:
                continue
            raw_body, content_type = item
            self._send(raw_body, content_type)

    def _send(self, raw_body: bytes, content_type: str) -> None:
        try:
            headers = {"Content-Type": content_type or "application/json"}
            response = self._session.post(self.url, data=raw_body, headers=headers, timeout=self.timeout)
            if response.status_code >= 400:
                print("[FWD] send failed: HTTP {}".format(response.status_code))
        except requests.exceptions.RequestException as exc:
            print("[FWD] send failed: {}".format(exc))


class ReceiverState:
    def __init__(self, light: AlarmLightController, auto_off_seconds: float = 10.0) -> None:
        self.light = light
        self.auto_off_seconds = max(0.5, float(auto_off_seconds))
        self._lock = threading.RLock()
        self._stop = False

        self.alarm_active = False
        self.lamp_on = False
        self.last_trigger_epoch: Optional[float] = None
        self.last_trigger_time: Optional[str] = None
        self.last_source: Optional[str] = None
        self.last_seq: Any = None
        self.last_sender_timestamp: Any = None
        self.last_light_result: Optional[str] = None
        self.message_count = 0
        self.refresh_count = 0
        self.auto_off_count = 0
        self._last_off_retry_epoch = 0.0

        self._serial_worker = AlarmSerialWorker(light, self._on_serial_result)
        self._timer = threading.Thread(target=self._timer_loop, name="alarm-auto-off", daemon=True)
        self._timer.start()

    def close(self) -> None:
        self._stop = True
        self._timer.join(timeout=1.5)
        self._serial_worker.close()

    def _queue_serial(self, action: str, reason: str) -> None:
        self.last_light_result = "{}_queued ({})".format(action, reason)
        self._serial_worker.submit(action, reason)

    def _on_serial_result(self, item: Dict[str, Any], ok: bool, detail: str) -> None:
        action = item.get("action")
        reason = item.get("reason")
        with self._lock:
            self.last_light_result = "{}: {}".format(action, detail)
            if action == "on":
                if ok:
                    self.lamp_on = True
                    self.alarm_active = True
                    print("[{}] RX     | source={} seq={} fire=true | alarm triggered".format(
                        now_str(), self.last_source, self.last_seq))
                    print("[{}] LIGHT  | ON: red=blink{} yellow=on buzzer=off; auto-off={:.1f}s".format(
                        now_str(), self.light.red_blink_value, self.auto_off_seconds))
                else:
                    self.lamp_on = False
                    print("[{}] ERROR  | alarm ON failed: {}".format(now_str(), detail))
            elif action == "off":
                if ok:
                    self.lamp_on = False
                    if reason in ("auto_off", "manual_off"):
                        self.alarm_active = False
                    if reason == "auto_off":
                        self.auto_off_count += 1
                        print("[{}] TIMER  | no trigger for {:.1f}s -> lights automatically OFF".format(
                            now_str(), self.auto_off_seconds))
                    else:
                        print("[{}] LIGHT  | OFF: manual fire=false received".format(now_str()))
                else:
                    print("[{}] ERROR  | alarm OFF failed: {}".format(now_str(), detail))

    def handle_message(self, msg: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        fire = parse_fire(msg.get("fire"))
        if fire is None:
            return 400, {"ok": False, "error": "field 'fire' must be true or false"}
        source = str(msg.get("source", msg.get("device_id", "unknown")))
        seq = msg.get("seq")
        timestamp = msg.get("timestamp")
        return self._trigger(source, seq, timestamp) if fire else self._manual_off(source, seq, timestamp)

    def _trigger(self, source: str, seq: Any, timestamp: Any) -> Tuple[int, Dict[str, Any]]:
        with self._lock:
            self.message_count += 1
            self.last_source = source
            self.last_seq = seq
            self.last_sender_timestamp = timestamp
            self.last_trigger_epoch = time.time()
            self.last_trigger_time = now_str()

            if self.alarm_active:
                self.refresh_count += 1
                print("[{}] RX     | source={} seq={} fire=true | refresh timer {:.1f}s".format(
                    now_str(), source, seq, self.auto_off_seconds))
                if not self.lamp_on:
                    self._queue_serial("on", "retry")
                return 200, {
                    "ok": True, "action": "timer_refreshed", "alarm_active": True,
                    "lamp_on": self.lamp_on, "auto_off_seconds": self.auto_off_seconds, "seq": seq
                }

            self.alarm_active = True
            self._queue_serial("on", "trigger")
            return 200, {
                "ok": True, "action": "alarm_on_queued",
                "alarm_active": self.alarm_active, "lamp_on": self.lamp_on,
                "auto_off_seconds": self.auto_off_seconds, "seq": seq
            }

    def _manual_off(self, source: str, seq: Any, timestamp: Any) -> Tuple[int, Dict[str, Any]]:
        with self._lock:
            self.message_count += 1
            self.last_source = source
            self.last_seq = seq
            self.last_sender_timestamp = timestamp
            if not self.alarm_active:
                return 200, {"ok": True, "action": "already_off", "alarm_active": False, "seq": seq}
            self._queue_serial("off", "manual_off")
            return 200, {
                "ok": True, "action": "manual_off_queued",
                "alarm_active": self.alarm_active, "lamp_on": self.lamp_on, "seq": seq
            }

    def status(self) -> Dict[str, Any]:
        with self._lock:
            if self.alarm_active and self.last_trigger_epoch is not None:
                age = max(0.0, time.time() - self.last_trigger_epoch)
                remaining = max(0.0, self.auto_off_seconds - age)
            else:
                age = None
                remaining = 0.0
            return {
                "ok": True,
                "alarm_active": self.alarm_active,
                "lamp_on": self.lamp_on,
                "auto_off_seconds": self.auto_off_seconds,
                "remaining_seconds": round(remaining, 2),
                "last_trigger_age_seconds": None if age is None else round(age, 2),
                "last_trigger_time": self.last_trigger_time,
                "last_source": self.last_source,
                "last_seq": self.last_seq,
                "last_sender_timestamp": self.last_sender_timestamp,
                "last_light_result": self.last_light_result,
                "message_count": self.message_count,
                "timer_refresh_count": self.refresh_count,
                "auto_off_count": self.auto_off_count,
                "serial": {"port": self.light.port, "addr": self.light.addr, "baudrate": self.light.baudrate},
                "rule": "fire=true refreshes timer; no new trigger before timeout automatically turns lights off"
            }

    def _timer_loop(self) -> None:
        while not self._stop:
            time.sleep(0.2)
            with self._lock:
                if not self.alarm_active or self.last_trigger_epoch is None:
                    continue
                elapsed = time.time() - self.last_trigger_epoch
                if elapsed < self.auto_off_seconds:
                    continue
                if time.time() - self._last_off_retry_epoch < 1.0:
                    continue
                self._last_off_retry_epoch = time.time()
                self._queue_serial("off", "auto_off")


class AlarmRequestHandler(BaseHTTPRequestHandler):
    state: ReceiverState = None  # type: ignore
    forwarder: Optional[HttpForwarder] = None

    def log_message(self, fmt: str, *args) -> None:
        return

    def send_json(self, status_code: int, obj: Dict[str, Any]) -> None:
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_json(200, {"ok": True})

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] in ("/", "/status", "/health"):
            self.send_json(200, self.state.status())
        else:
            self.send_json(404, {"ok": False, "error": "use GET /status or POST /alarm"})

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/alarm":
            self.send_json(404, {"ok": False, "error": "use POST /alarm"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                raise ValueError("invalid JSON body length")
            raw_body = self.rfile.read(length)
            payload = json.loads(raw_body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON body must be an object")
        except Exception as exc:
            self.send_json(400, {"ok": False, "error": "bad JSON: {}".format(exc)})
            return

        status_code, result = self.state.handle_message(payload)
        self.send_json(status_code, result)

        if self.forwarder is not None:
            content_type = self.headers.get("Content-Type", "application/json")
            self.forwarder.submit(raw_body, content_type)


def main() -> None:
    parser = argparse.ArgumentParser(description="Alarm receiver + RS485 + auto-off + forward")
    parser.add_argument("--alarm-port", required=True, help="alarm RS485 port, e.g. /dev/ttyUSB0")
    parser.add_argument("--alarm-addr", type=int, default=1)
    parser.add_argument("--alarm-baudrate", type=int, default=9600)
    parser.add_argument("--alarm-timeout", type=float, default=0.8)
    parser.add_argument("--red-blink-value", type=int, default=5)
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=8766)
    parser.add_argument("--auto-off-seconds", type=float, default=10.0)
    parser.add_argument("--keep-light-on-start", action="store_true")
    parser.add_argument("--forward-url", type=str, default=None, help="forward target URL")
    parser.add_argument("--forward-timeout", type=float, default=FORWARD_HTTP["timeout"])
    parser.add_argument("--forward-retry-interval", type=float, default=FORWARD_HTTP["retry_interval"])
    args = parser.parse_args()

    light = AlarmLightController(
        port=args.alarm_port, addr=args.alarm_addr, baudrate=args.alarm_baudrate,
        timeout=args.alarm_timeout, red_blink_value=args.red_blink_value)
    try:
        light.open()
    except Exception as exc:
        print("[{}] ERROR  | cannot open alarm port {}: {}".format(now_str(), args.alarm_port, exc))
        sys.exit(1)

    if not args.keep_light_on_start:
        ok, detail = light.alarm_off()
        print("[{}] LIGHT  | startup all OFF | {}".format(now_str(), detail))
        if not ok:
            print("[{}] WARN   | startup off failed; check power/A-B/addr/baud".format(now_str()))

    state = ReceiverState(light, auto_off_seconds=args.auto_off_seconds)
    AlarmRequestHandler.state = state

    forward_url = FORWARD_HTTP["url"] if args.forward_url is None else args.forward_url.strip()
    forwarder = None
    if forward_url:
        forwarder = HttpForwarder(
            url=forward_url,
            timeout=args.forward_timeout,
            retry_interval=args.forward_retry_interval,
        )
        AlarmRequestHandler.forwarder = forwarder
        print("[FWD] enabled: {}".format(forward_url))
    else:
        print("[FWD] disabled (no URL configured)")

    try:
        server = ThreadingHTTPServer((args.listen_host, args.listen_port), AlarmRequestHandler)
    except Exception as exc:
        state.close()
        light.close()
        if forwarder:
            forwarder.close()
        print("[{}] ERROR  | cannot listen {}:{}: {}".format(now_str(), args.listen_host, args.listen_port, exc))
        sys.exit(1)

    closing = threading.Event()
    def request_stop(signum=None, frame=None) -> None:
        if closing.is_set():
            return
        closing.set()
        print("\n[{}] INFO   | shutting down...".format(now_str()))
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    print("====== Alarm Receiver (Auto-Off + Forward) ======")
    print("listen : http://<ip>:{}{}".format(args.listen_port, "/alarm"))
    print("status : http://<ip>:{}/status".format(args.listen_port))
    print("serial : port={} addr={} baud={}".format(args.alarm_port, args.alarm_addr, args.alarm_baudrate))
    print("rule   : fire=true -> red blink({}) + yellow on".format(light.red_blink_value))
    print("rule   : refresh timer; auto-off {:.1f}s".format(args.auto_off_seconds))
    print("note   : fire=false kept for manual reset")
    print("-----------------------------------------------")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        state.close()
        light.close()
        if forwarder:
            forwarder.close()
        print("[{}] INFO   | receiver exited".format(now_str()))


if __name__ == "__main__":
    main()
