#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
env_collector_py38.py

用途：
- 固定时间采集 温湿度传感器（RS485 / Modbus-RTU）
- 固定时间采集 WiFi烟感/气体传感器（HTTP）
- 把最新数据统一保存到本地 JSON 文件，供火灾主代码读取

适配：
- Python 3.8+
- 温湿度：默认 9600, 8N1, Modbus-RTU
- WiFi烟感：HTTP POST 到 http://设备IP/v3，请求体 {"status":{}}

依赖：
    pip install pyserial
"""

import argparse
import json
import threading
import time
from pathlib import Path
from typing import Dict
from urllib import request

import serial


DEFAULT_OUTPUT = str(Path(__file__).resolve().parent / "env_latest.json")

TEMP_PORT_DEFAULT = "/dev/ttyUSB0"
TEMP_ADDR_DEFAULT = 1
TEMP_BAUDRATE_DEFAULT = 9600
TEMP_TIMEOUT_DEFAULT = 1.0
TEMP_INTERVAL_DEFAULT = 2.0
TEMP_READ_DEW_DEFAULT = True

SMOKE_IP_DEFAULT = "10.73.2.180"
SMOKE_TIMEOUT_DEFAULT = 2.0
SMOKE_INTERVAL_DEFAULT = 2.0

WRITE_PERIOD_DEFAULT = 2.0


def now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc & 0xFFFF


def add_crc(data: bytes) -> bytes:
    crc = crc16_modbus(data)
    return data + bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def hex_bytes(data: bytes) -> str:
    return " ".join("{:02X}".format(x) for x in data)


def u16_to_i16(v: int) -> int:
    return v - 0x10000 if (v & 0x8000) else v


class TempHumiditySensor(object):
    def __init__(self, port: str, addr: int = 1, baudrate: int = 9600, timeout: float = 1.0):
        self.port = port
        self.addr = int(addr)
        self.baudrate = int(baudrate)
        self.timeout = float(timeout)
        self.ser = None

    def open(self) -> None:
        self.ser = serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=8,
            parity='N',
            stopbits=1,
            timeout=self.timeout,
        )
        self.ser.reset_input_buffer()
        self.ser.reset_output_buffer()

    def close(self) -> None:
        if self.ser is not None:
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None

    def _transceive(self, req: bytes) -> bytes:
        if self.ser is None:
            raise RuntimeError("serial port is not open")

        self.ser.reset_input_buffer()
        self.ser.write(req)
        self.ser.flush()

        buf = bytearray()
        deadline = time.time() + self.timeout

        while time.time() < deadline:
            n = self.ser.in_waiting
            if n:
                buf.extend(self.ser.read(n))
            else:
                chunk = self.ser.read(1)
                if chunk:
                    buf.extend(chunk)

            if len(buf) >= 5 and buf[1] == 0x03:
                total = 3 + buf[2] + 2
                if len(buf) >= total:
                    frame = bytes(buf[:total])
                    self._check_crc(frame)
                    return frame

        raise TimeoutError("response timeout, raw={}".format(hex_bytes(bytes(buf))))

    @staticmethod
    def _check_crc(frame: bytes) -> None:
        if len(frame) < 4:
            raise ValueError("response too short")
        body = frame[:-2]
        crc_got = frame[-2] | (frame[-1] << 8)
        crc_exp = crc16_modbus(body)
        if crc_got != crc_exp:
            raise ValueError(
                "CRC mismatch, expected=0x{:04X}, got=0x{:04X}, raw={}".format(
                    crc_exp, crc_got, hex_bytes(frame)
                )
            )

    def read_holding_registers(self, start_addr: int, count: int):
        req = add_crc(bytes([
            self.addr,
            0x03,
            (start_addr >> 8) & 0xFF,
            start_addr & 0xFF,
            (count >> 8) & 0xFF,
            count & 0xFF,
        ]))
        resp = self._transceive(req)
        if resp[0] != self.addr or resp[1] != 0x03:
            raise ValueError("unexpected response: {}".format(hex_bytes(resp)))
        byte_count = resp[2]
        if byte_count != count * 2:
            raise ValueError("unexpected byte count: {}, raw={}".format(byte_count, hex_bytes(resp)))
        regs = []
        data = resp[3:3 + byte_count]
        for i in range(0, len(data), 2):
            regs.append((data[i] << 8) | data[i + 1])
        return regs

    def read_temp_humidity(self) -> Dict:
        regs = self.read_holding_registers(0x0000, 2)
        temp_raw = u16_to_i16(regs[0])
        hum_raw = regs[1]
        return {
            "temperature_c": temp_raw / 10.0,
            "humidity_rh": hum_raw / 10.0,
        }

    def read_temp_humidity_dew(self) -> Dict:
        regs = self.read_holding_registers(0x0000, 3)
        temp_raw = u16_to_i16(regs[0])
        hum_raw = regs[1]
        dew_raw = u16_to_i16(regs[2])
        return {
            "temperature_c": temp_raw / 10.0,
            "humidity_rh": hum_raw / 10.0,
            "dewpoint_c": dew_raw / 10.0,
        }


def fetch_smoke_status(device_ip: str, timeout: float = 2.0) -> Dict:
    url = "http://{}/v3".format(device_ip)
    payload = json.dumps({"status": {}}).encode("utf-8")
    req = request.Request(
        url=url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")

    data = json.loads(raw)

    # 关键修正：真正的数据在 data["status"] 里面
    status = data.get("status", {})
    if not isinstance(status, dict):
        status = {}

    def to_float_or_none(v):
        if v is None:
            return None
        try:
            return float(v)
        except Exception:
            return None

    return {
        "device_id": status.get("device_id"),
        "device_time": status.get("date_time"),
        "smoke_ppm": to_float_or_none(status.get("smoke_ppm")),
        "co_ppm": to_float_or_none(status.get("co_ppm")),
        "lpg_ppm": to_float_or_none(status.get("lpg_ppm")),
        "mq2_state": status.get("mq2_state"),
        "ip": device_ip,
    }


class EnvCollector(object):
    def __init__(
        self,
        output_path: str,
        temp_enabled: bool,
        temp_port: str,
        temp_addr: int,
        temp_baudrate: int,
        temp_timeout: float,
        temp_interval: float,
        temp_read_dew: bool,
        smoke_enabled: bool,
        smoke_ip: str,
        smoke_timeout: float,
        smoke_interval: float,
        write_period: float,
    ):
        self.output_path = Path(output_path)
        self.temp_enabled = bool(temp_enabled)
        self.temp_port = temp_port
        self.temp_addr = int(temp_addr)
        self.temp_baudrate = int(temp_baudrate)
        self.temp_timeout = float(temp_timeout)
        self.temp_interval = float(temp_interval)
        self.temp_read_dew = bool(temp_read_dew)

        self.smoke_enabled = bool(smoke_enabled)
        self.smoke_ip = smoke_ip
        self.smoke_timeout = float(smoke_timeout)
        self.smoke_interval = float(smoke_interval)

        self.write_period = float(write_period)
        self._stop = False
        self._lock = threading.Lock()
        self._threads = []

        self.state = {
            "collector_time": now_str(),
            "temp_humidity": {
                "enabled": self.temp_enabled,
                "ok": False,
                "sample_time": None,
                "port": self.temp_port,
                "device_addr": self.temp_addr,
                "temperature_c": None,
                "humidity_rh": None,
                "dewpoint_c": None,
                "error": None,
            },
            "smoke": {
                "enabled": self.smoke_enabled,
                "ok": False,
                "sample_time": None,
                "ip": self.smoke_ip,
                "device_id": None,
                "device_time": None,
                "smoke_ppm": None,
                "co_ppm": None,
                "lpg_ppm": None,
                "mq2_state": None,
                "error": None,
            }
        }

    def start(self) -> None:
        if self.temp_enabled:
            t = threading.Thread(target=self._temp_worker, name="temp-worker", daemon=True)
            self._threads.append(t)
            t.start()

        if self.smoke_enabled:
            t = threading.Thread(target=self._smoke_worker, name="smoke-worker", daemon=True)
            self._threads.append(t)
            t.start()

        t = threading.Thread(target=self._writer_worker, name="json-writer", daemon=True)
        self._threads.append(t)
        t.start()

    def stop(self) -> None:
        self._stop = True
        for t in self._threads:
            if t.is_alive():
                t.join(timeout=2.0)

    def _temp_worker(self) -> None:
        sensor = TempHumiditySensor(
            port=self.temp_port,
            addr=self.temp_addr,
            baudrate=self.temp_baudrate,
            timeout=self.temp_timeout,
        )

        while not self._stop:
            try:
                if sensor.ser is None:
                    sensor.open()

                result = sensor.read_temp_humidity_dew() if self.temp_read_dew else sensor.read_temp_humidity()

                with self._lock:
                    self.state["temp_humidity"].update({
                        "enabled": True,
                        "ok": True,
                        "sample_time": now_str(),
                        "port": self.temp_port,
                        "device_addr": self.temp_addr,
                        "temperature_c": result.get("temperature_c"),
                        "humidity_rh": result.get("humidity_rh"),
                        "dewpoint_c": result.get("dewpoint_c"),
                        "error": None,
                    })
            except Exception as e:
                try:
                    sensor.close()
                except Exception:
                    pass
                with self._lock:
                    self.state["temp_humidity"].update({
                        "enabled": True,
                        "ok": False,
                        "sample_time": now_str(),
                        "port": self.temp_port,
                        "device_addr": self.temp_addr,
                        "error": str(e),
                    })
            time.sleep(self.temp_interval)

        sensor.close()

    def _smoke_worker(self) -> None:
        while not self._stop:
            try:
                result = fetch_smoke_status(self.smoke_ip, timeout=self.smoke_timeout)
                with self._lock:
                    self.state["smoke"].update({
                        "enabled": True,
                        "ok": True,
                        "sample_time": now_str(),
                        "ip": self.smoke_ip,
                        "device_id": result.get("device_id"),
                        "device_time": result.get("device_time"),
                        "smoke_ppm": result.get("smoke_ppm"),
                        "co_ppm": result.get("co_ppm"),
                        "lpg_ppm": result.get("lpg_ppm"),
                        "mq2_state": result.get("mq2_state"),
                        "error": None,
                    })
            except Exception as e:
                with self._lock:
                    self.state["smoke"].update({
                        "enabled": True,
                        "ok": False,
                        "sample_time": now_str(),
                        "ip": self.smoke_ip,
                        "error": str(e),
                    })
            time.sleep(self.smoke_interval)

    def _writer_worker(self) -> None:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        while not self._stop:
            try:
                with self._lock:
                    snapshot = json.loads(json.dumps(self.state, ensure_ascii=False))
                snapshot["collector_time"] = now_str()
                self._atomic_write_json(snapshot)
            except Exception:
                pass
            time.sleep(self.write_period)

    def _atomic_write_json(self, obj: Dict) -> None:
        tmp_path = self.output_path.with_suffix(self.output_path.suffix + ".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        tmp_path.replace(self.output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="环境采集器：温湿度(RS485) + WiFi烟感 -> 本地JSON (Python 3.8)")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="输出 JSON 文件路径")

    parser.add_argument("--no-temp", action="store_true", help="禁用温湿度采集")
    parser.add_argument("--temp-port", default=TEMP_PORT_DEFAULT, help="温湿度串口，例如 /dev/ttyUSB0")
    parser.add_argument("--temp-addr", type=int, default=TEMP_ADDR_DEFAULT, help="温湿度设备地址，默认1")
    parser.add_argument("--temp-baudrate", type=int, default=TEMP_BAUDRATE_DEFAULT, help="温湿度波特率，默认9600")
    parser.add_argument("--temp-timeout", type=float, default=TEMP_TIMEOUT_DEFAULT, help="温湿度串口超时")
    parser.add_argument("--temp-interval", type=float, default=TEMP_INTERVAL_DEFAULT, help="温湿度采集周期，秒")
    parser.add_argument("--temp-no-dew", action="store_true", help="温湿度不读取露点")

    parser.add_argument("--no-smoke", action="store_true", help="禁用WiFi烟感采集")
    parser.add_argument("--smoke-ip", default=SMOKE_IP_DEFAULT, help="WiFi烟感IP")
    parser.add_argument("--smoke-timeout", type=float, default=SMOKE_TIMEOUT_DEFAULT, help="WiFi烟感HTTP超时")
    parser.add_argument("--smoke-interval", type=float, default=SMOKE_INTERVAL_DEFAULT, help="WiFi烟感采集周期，秒")

    parser.add_argument("--write-period", type=float, default=WRITE_PERIOD_DEFAULT, help="写JSON周期，秒")

    args = parser.parse_args()

    collector = EnvCollector(
        output_path=args.output,
        temp_enabled=(not args.no_temp),
        temp_port=args.temp_port,
        temp_addr=args.temp_addr,
        temp_baudrate=args.temp_baudrate,
        temp_timeout=args.temp_timeout,
        temp_interval=args.temp_interval,
        temp_read_dew=(not args.temp_no_dew),
        smoke_enabled=(not args.no_smoke),
        smoke_ip=args.smoke_ip,
        smoke_timeout=args.smoke_timeout,
        smoke_interval=args.smoke_interval,
        write_period=args.write_period,
    )

    print("环境采集器启动")
    print("  输出文件:", args.output)
    print("  温湿度采集:", "开启" if (not args.no_temp) else "关闭")
    if not args.no_temp:
        print("    port={} addr={} baud={} interval={}s dew={}".format(
            args.temp_port, args.temp_addr, args.temp_baudrate, args.temp_interval, (not args.temp_no_dew)
        ))
    print("  WiFi烟感采集:", "开启" if (not args.no_smoke) else "关闭")
    if not args.no_smoke:
        print("    ip={} interval={}s".format(args.smoke_ip, args.smoke_interval))
    print("  JSON写入周期: {}s".format(args.write_period))
    print("按 Ctrl+C 退出")

    collector.start()

    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\\n收到 Ctrl+C，准备退出...")
    finally:
        collector.stop()
        print("环境采集器已退出")


if __name__ == "__main__":
    main()
