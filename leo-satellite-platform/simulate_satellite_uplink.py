#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模拟边缘网关通过卫星模组向 A 服务器上传传感器报文。"""

import argparse
import datetime
import json
import random
import socket
import struct
import time
from pathlib import Path


DEFAULT_HOST = "139.196.214.249"
DEFAULT_PORT = 8091
DEFAULT_TOKEN = ""
RESPONSE_LENGTH = 6
DEFAULT_BATCH_COUNT = 3
MAX_SATELLITE_CONTENT_BYTES = 120
WIND_SPEED_MIN = 0.0
WIND_SPEED_MAX = 30.0
TEMPERATURE_MIN = 15.0
TEMPERATURE_MAX = 35.0
HUMIDITY_MIN = 30.0
HUMIDITY_MAX = 90.0
DEFAULT_PERIODIC_INTERVAL = 5.0
DEFAULT_G1_FIRE_STATE_FILE = Path(__file__).with_name("tmp") / "g1_fire_state.json"

# 卫星模组 SN 和边缘网关分别采集。A 服务器的转发器直接读取
# Content 中的 gateway，不通过卫星模组 SN 推断路由。
# 模拟批次中的边缘网关和卫星模组固定对应，不随机分配。
# 地面站实机报文会去掉 SN 的前导零，因此这里使用实机实际产生的短 SN；
# A 转发器的白名单和转发字段也统一使用不带前导零的短 SN。
GATEWAY_SATELLITE_SN_MAP = {
    "gateway1": "11309",
    "gateway2": "11310",
    "gateway3": "11311",
    "gateway5": "11078",
}
# 默认周期批次与现场协议约定一致：
#   gateway1：温湿度传感器，默认每 5 秒生成一条组合报文
#   gateway2：风速传感器，默认每 5 秒生成一条报文
#   gateway3：暂时保持原有火情随机模拟逻辑
# gateway1 火情不在周期批次中；通过 --g1-fire-state 输入状态，仅跳变时立即发送。
# Content 统一使用 {"t":时间,"s":传感器类型,"v":数值,"g":网关编号}。
SENSOR_SCENARIOS = (
    {"s": "TH", "g": 1},
    {"s": "F", "g": 3},
    {"s": "WS", "g": 2},
)


def now_local():
    return datetime.datetime.now().astimezone()


def format_iso(value):
    return value.isoformat(timespec="milliseconds")


def format_sensor_time(value):
    """按卫星业务协议输出 YYMMDDhhmmss。"""
    return value.strftime("%y%m%d%H%M%S")


def recv_exactly(sock, size):
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("A 服务器在响应完整报文前关闭连接")
        data.extend(chunk)
    return bytes(data)


def collect_sensor_data(scenario=None):
    """按 t/s/v/g 协议模拟完成一次传感器采集。"""
    if scenario is None:
        scenario = random.choice(SENSOR_SCENARIOS)
    sensor_type = scenario["s"]
    if "v" in scenario:
        sensor_value = scenario["v"]
    elif sensor_type == "F":
        sensor_value = random.choice((True, False))
    elif sensor_type == "TH":
        sensor_value = {
            "tp": round(random.uniform(TEMPERATURE_MIN, TEMPERATURE_MAX), 1),
            "rh": round(random.uniform(HUMIDITY_MIN, HUMIDITY_MAX), 1),
        }
    elif sensor_type == "WS":
        sensor_value = round(random.uniform(WIND_SPEED_MIN, WIND_SPEED_MAX), 1)
    else:
        raise ValueError("不支持的模拟传感器类型：%s" % sensor_type)

    gateway_number = scenario["g"]
    gateway = "gateway%d" % gateway_number
    satellite_sn = GATEWAY_SATELLITE_SN_MAP[gateway]
    collected_at = now_local()
    content = {
        "t": format_sensor_time(collected_at),
        "s": sensor_type,
        "v": sensor_value,
        "g": gateway_number,
    }
    return satellite_sn, gateway, collected_at, content


def build_message_id(satellite_sn, satellite_received_at, sequence):
    # 国电高科协议：终端编号_数据上星时间_序号
    return "%s_%s_%03d" % (
        satellite_sn,
        satellite_received_at.strftime("%Y%m%d%H%M%S"),
        sequence % 1000,
    )


def encode_packet(token, message_id, content):
    token_bytes = token.encode("ascii")
    if len(token_bytes) > 20:
        raise ValueError("Token 的 ASCII 长度不能超过 20 字节")
    token_bytes = token_bytes.ljust(20, b"\x00")

    message_id_bytes = message_id.encode("ascii")
    if not 1 <= len(message_id_bytes) <= 255:
        raise ValueError("Msg_id 长度必须在 1 到 255 字节之间")

    content_bytes = json.dumps(
        content, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    if len(content_bytes) > MAX_SATELLITE_CONTENT_BYTES:
        raise ValueError(
            "Content 长度为 %d 字节，超过卫星单帧 %d 字节限制"
            % (len(content_bytes), MAX_SATELLITE_CONTENT_BYTES)
        )
    if len(content_bytes) > 65535:
        raise ValueError("Content 长度不能超过 65535 字节")

    body = b"\x01"  # Cmd_code：0x01 报文上传指令
    body += token_bytes
    body += struct.pack("!B", len(message_id_bytes))
    body += message_id_bytes
    body += struct.pack("!H", len(content_bytes))
    body += content_bytes
    return struct.pack("!I", 4 + len(body)) + body


def decode_response(response):
    if len(response) != RESPONSE_LENGTH:
        raise ValueError("响应长度错误：%d" % len(response))
    total_length, command, result = struct.unpack("!IBB", response)
    if total_length != RESPONSE_LENGTH or command != 0x81:
        raise ValueError(
            "响应格式错误：total_len=%d cmd=0x%02x" % (total_length, command)
        )
    return result


def send_packet(host, port, packet, timeout, bind_ip=""):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if bind_ip:
            sock.bind((bind_ip, 0))
        sock.connect((host, port))
        sock.sendall(packet)
        response = recv_exactly(sock, RESPONSE_LENGTH)
    result = decode_response(response)
    if result != 0:
        raise RuntimeError("A 服务器返回失败，Result=0x%02x" % result)
    return response


def prepare_job(args, run_index, sequence):
    """采集一条数据，并为它独立计算计划发送时间。"""
    # 默认三条依次为 gateway1 温湿度、gateway3 火情、gateway2 风速；
    # 更多条数时循环传感器与网关组合，并重新随机生成数值。
    scenario = SENSOR_SCENARIOS[(run_index - 1) % len(SENSOR_SCENARIOS)]
    satellite_sn, gateway, collected_at, content = collect_sensor_data(scenario)
    delay_seconds = random.uniform(args.delay_min, args.delay_max)
    scheduled_at = collected_at + datetime.timedelta(seconds=delay_seconds)
    return {
        "run_index": run_index,
        "sequence": sequence,
        "satellite_sn": satellite_sn,
        "gateway": gateway,
        "collected_at": collected_at,
        "content": content,
        "delay_seconds": delay_seconds,
        "scheduled_at": scheduled_at,
        "display_count": args.count,
    }


def prepare_g1_fire_job(args, fire_state, sequence):
    """构造一条不延时的 gateway1 火情跳变报文。"""
    satellite_sn, gateway, collected_at, content = collect_sensor_data(
        {"s": "F", "g": 1, "v": fire_state}
    )
    return {
        "run_index": 1,
        "sequence": sequence,
        "satellite_sn": satellite_sn,
        "gateway": gateway,
        "collected_at": collected_at,
        "content": content,
        "delay_seconds": 0.0,
        "scheduled_at": collected_at,
        "display_count": 1,
    }


def print_job(job, count):
    print("\n[%d/%d] 已采集数据" % (job["run_index"], count))
    print("  卫星模组 SN：%s" % job["satellite_sn"])
    print("  边缘网关：%s" % job["gateway"])
    print("  采集时间：%s" % format_iso(job["collected_at"]))
    print("  独立传输延时：%.1f 秒" % job["delay_seconds"])
    print("  计划发送时间：%s" % format_iso(job["scheduled_at"]))


def send_job(args, job):
    """等待该条数据自己的到期时间，然后发送给 A 服务器。"""
    if not args.no_wait:
        remaining = (job["scheduled_at"] - now_local()).total_seconds()
        if remaining > 0:
            time.sleep(remaining)

    satellite_received_at = now_local()
    message_id = build_message_id(
        job["satellite_sn"], satellite_received_at, job["sequence"]
    )
    packet = encode_packet(args.token, message_id, job["content"])

    print("\n[%d/%d] 到达发送时间" % (job["run_index"], job["display_count"]))
    print("  数据上星时间：%s" % format_iso(satellite_received_at))
    print("  Msg_id：%s" % message_id)
    content_text = json.dumps(
        job["content"], ensure_ascii=False, separators=(",", ":")
    )
    print("  Content：%s" % content_text)
    print("  Content 长度：%d 字节" % len(content_text.encode("utf-8")))
    print("  二进制报文长度：%d 字节" % len(packet))

    if args.dry_run:
        print("  DRY RUN：未连接 A 服务器")
        print("  报文 HEX：%s" % packet.hex())
        return True

    response = send_packet(
        args.host,
        args.port,
        packet,
        timeout=args.timeout,
        bind_ip=args.bind,
    )
    print("  已发送至 A 服务器：%s:%d" % (args.host, args.port))
    print("  A 服务器确认保存成功：%s" % response.hex())
    return True


def parse_boolean(value):
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise argparse.ArgumentTypeError("必须是 true 或 false")


def load_g1_fire_state(path):
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as state_file:
        data = json.load(state_file)
    state = data.get("state")
    if not isinstance(state, bool):
        raise ValueError("g1 火情状态文件格式无效：%s" % path)
    return state


def save_g1_fire_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    with temporary_path.open("w", encoding="utf-8") as state_file:
        json.dump({"state": state}, state_file, ensure_ascii=False)
    temporary_path.replace(path)


def run_periodic_batch(args):
    first_sequence = random.randint(0, 999)
    jobs = []
    for run_index in range(1, args.count + 1):
        sequence = (first_sequence + run_index - 1) % 1000
        jobs.append(prepare_job(args, run_index, sequence))

    print("一次性采集 %d 条周期数据，每条独立计算发送延时：" % args.count)
    for job in jobs:
        print_job(job, args.count)

    success_count = 0
    failures = []
    for job in sorted(jobs, key=lambda item: item["scheduled_at"]):
        try:
            if send_job(args, job):
                success_count += 1
        except (ConnectionError, OSError, RuntimeError, ValueError) as exc:
            failures.append((job["run_index"], str(exc)))
            print("  [%d/%d] 发送失败：%s" % (job["run_index"], args.count, exc))

    print("\n批次完成：成功 %d 条，失败 %d 条" % (success_count, len(failures)))
    if failures:
        for run_index, error in failures:
            print("  第 %d 条：%s" % (run_index, error))
        raise RuntimeError("本批次存在发送失败")


def handle_g1_fire_state(args):
    state_path = Path(args.fire_state_file).resolve()
    previous_state = load_g1_fire_state(state_path)
    current_state = args.g1_fire_state

    if previous_state is None:
        save_g1_fire_state(state_path, current_state)
        print("g1 火情首次状态为 %s，已建立基准，不发送。" % str(current_state).lower())
        return
    if previous_state == current_state:
        print("g1 火情状态未变化（%s），不发送。" % str(current_state).lower())
        return

    print(
        "g1 火情发生跳变：%s -> %s，立即发送。"
        % (str(previous_state).lower(), str(current_state).lower())
    )
    job = prepare_g1_fire_job(args, current_state, random.randint(0, 999))
    print_job(job, 1)
    send_job(args, job)
    save_g1_fire_state(state_path, current_state)
    print("g1 火情跳变发送成功，状态基准已更新。")


def run_continuous(args):
    """每分钟发送周期数据，并在 g1 火情随机跳变时立即插入一条发送。"""
    fire_state = args.initial_fire
    print("g1 初始火情状态为 %s，只建立基准、不发送。" % str(fire_state).lower())
    next_periodic = time.monotonic()
    next_fire_change = time.monotonic() + random.uniform(
        args.fire_change_min, args.fire_change_max
    )

    while True:
        now = time.monotonic()
        if now >= next_periodic:
            run_periodic_batch(args)
            now = time.monotonic()
            next_periodic += args.interval
            if next_periodic <= now:
                next_periodic = now + args.interval

        if now >= next_fire_change:
            previous_state = fire_state
            fire_state = not fire_state
            print(
                "g1 火情随机跳变：%s -> %s，立即单独发送。"
                % (str(previous_state).lower(), str(fire_state).lower())
            )
            job = prepare_g1_fire_job(args, fire_state, random.randint(0, 999))
            print_job(job, 1)
            send_job(args, job)
            next_fire_change = time.monotonic() + random.uniform(
                args.fire_change_min, args.fire_change_max
            )

        wait_until = min(next_periodic, next_fire_change)
        time.sleep(max(0.05, min(0.5, wait_until - time.monotonic())))


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "按 t/s/v/g 格式发送周期传感器数据，或仅在 gateway1 火情跳变时立即发送"
        )
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="A 服务器地址")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="A 服务器 tcp.py 端口")
    parser.add_argument("--bind", default="", help="可选：绑定本机指定网卡 IP")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="最长 20 字节 ASCII Token")
    parser.add_argument(
        "--count",
        type=int,
        default=DEFAULT_BATCH_COUNT,
        help="每个周期生成的数据条数，默认 3（g1温湿度、g3火情、g2风速）",
    )
    parser.add_argument("--delay-min", type=float, default=0.0, help="最短发送延时秒数")
    parser.add_argument("--delay-max", type=float, default=0.0, help="最长发送延时秒数")
    parser.add_argument(
        "--continuous",
        action="store_true",
        help="连续运行周期任务；默认每 5 秒采集发送 g1 温湿度和 g2 风速",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=DEFAULT_PERIODIC_INTERVAL,
        help="连续模式的周期秒数，默认 5",
    )
    parser.add_argument(
        "--g1-fire-state",
        type=parse_boolean,
        metavar="true|false",
        help="输入一次 g1 火情状态；首次仅建立基准，之后仅跳变时立即发送",
    )
    parser.add_argument(
        "--fire-state-file",
        default=str(DEFAULT_G1_FIRE_STATE_FILE),
        help="g1 火情上次状态的持久化文件",
    )
    parser.add_argument(
        "--initial-fire",
        type=parse_boolean,
        default=False,
        help="连续模式下 g1 的初始火情基准，默认 false（不发送初始状态）",
    )
    parser.add_argument(
        "--fire-change-min",
        type=float,
        default=5.0,
        help="连续模式下 g1 随机火情下一次跳变的最短秒数，默认 5",
    )
    parser.add_argument(
        "--fire-change-max",
        type=float,
        default=10.0,
        help="连续模式下 g1 随机火情下一次跳变的最长秒数，默认 10",
    )
    parser.add_argument("--timeout", type=float, default=8.0, help="TCP 连接和响应超时秒数")
    parser.add_argument("--no-wait", action="store_true", help="测试时跳过等待，但仍显示随机延时")
    parser.add_argument("--dry-run", action="store_true", help="生成并打印报文，不连接 A 服务器")
    args = parser.parse_args()

    if not 1 <= args.port <= 65535:
        parser.error("--port 必须在 1 到 65535 之间")
    if args.count < 1:
        parser.error("--count 必须大于等于 1")
    if args.delay_min < 0 or args.delay_max < args.delay_min:
        parser.error("延时必须满足 0 <= --delay-min <= --delay-max")
    if args.timeout <= 0:
        parser.error("--timeout 必须大于 0")
    if args.interval <= 0:
        parser.error("--interval 必须大于 0")
    if args.fire_change_min <= 0 or args.fire_change_max < args.fire_change_min:
        parser.error("火情跳变时间必须满足 0 < min <= max")
    if args.g1_fire_state is not None and args.continuous:
        parser.error("--g1-fire-state 不能与 --continuous 同时使用")
    try:
        args.token.encode("ascii")
    except UnicodeEncodeError:
        parser.error("--token 只能包含 ASCII 字符")
    if len(args.token.encode("ascii")) > 20:
        parser.error("--token 不能超过 20 字节")
    return args


def main():
    args = parse_args()
    try:
        if args.g1_fire_state is not None:
            handle_g1_fire_state(args)
            return

        if not args.continuous:
            run_periodic_batch(args)
            return

        print(
            "连续模式已启动：周期数据每 %.1f 秒一批，g1 火情只在随机跳变时立即发送。"
            % args.interval
        )
        run_continuous(args)
    except KeyboardInterrupt:
        raise SystemExit("\n已取消模拟发送")
    except (ConnectionError, OSError, RuntimeError, ValueError) as exc:
        raise SystemExit("模拟发送失败：%s" % exc)


if __name__ == "__main__":
    main()
