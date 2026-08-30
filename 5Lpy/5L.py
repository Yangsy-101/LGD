import multiprocessing
from multiprocessing import Manager, Process
import time
import logging
import mysql.connector
from mysql.connector import Error
import paho.mqtt.client as mqtt
import socket
import struct
import json
import threading
import os
import cv2
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ===================== 全局业务状态保留（完全原样） =====================
first_detect_time_flag = 0
first_detect_time = 0
first_detect_man = 0
now_time = 0
already_match = {'2543110005': 'false', '2543110067': 'false', '2543110015': 'false'}

# 数据库配置
DB_CONFIG = {
    "person_db_plss": {"host": "localhost", "user": "root", "password": "123456", "database": "person_db_plss"},
    "device_db_plss": {"host": "localhost", "user": "root", "password": "123456", "database": "device_db_plss"}
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("Integrated_System")

# ===================== 视频推流与日志上传配置 =====================
RTSP_URL = "rtsp://admin:admin@172.16.110.2:8554/stream0"

# 云服务器视频中转地址（匹配 dongnanpy/server.py 终极融合版 Framed 协议）
UPLOAD_VIDEO_HOST = "47.99.47.169"
UPLOAD_VIDEO_PORT = 11500

# 网关 ID —— 云服务器按此 ID 分目录存储
GATEWAY_ID = "gateway_5"

# 日志本地存储路径（待服务器端日志接口就绪后改为远程 TCP 上传）
import os as _os
LOCAL_LOG_DIR = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "local_logs")
LOCAL_LOG_FILE = _os.path.join(LOCAL_LOG_DIR, f"business_log_{time.strftime('%Y%m%d')}.jsonl")

ENABLE_STARTUP_LOG_PROBE = True

TARGET_FPS = 25
JPEG_QUALITY = 75
RESIZE_WIDTH = 960
RESIZE_HEIGHT = 540

FIRE_BOARD_IP = "172.16.110.3"
FIRE_LISTEN_HOST = "0.0.0.0"
FIRE_LISTEN_PORT = 9000
FIRE_CLEAR_DELAY_SECONDS = 8.0
FIRE_TRUE_STALE_SECONDS = 120.0
# 已完成匹配的设备视为已被带走，演示窗口内不再绑定给后续识别人员。
RFID_REUSE_COOLDOWN_SECONDS = 1800.0

# ★ 人员处理冷却：同一人员被处理后（无论成功还是告警），冷却期内
#    跳过后续 Rec/Snap，防止 RFID 被消费后重复上报"无设备开门"
PERSON_PROCESS_COOLDOWN_SECONDS = 30.0


# ===================== 原汁原味的等级转换函数（保留HTML格式） =====================
def get_person_level_text(level):
    if level == 'A':
        return "<span style='color: #8B0000; font-weight: bold;'>高等级人员</span>"
    elif level == 'B':
        return "<span style='color: #CD5C5C; font-weight: bold;'>中等级别人员</span>"
    elif level == 'C':
        return "<span style='color: #FF6347; font-weight: bold;'>低等级人员</span>"
    else:
        return "<span style='color: gray;'>未知等级人员</span>"


def get_device_level_text(level):
    if level == 'a':
        return "<span style='color: #8B0000; font-weight: bold;'>高等级设备</span>"
    elif level == 'b':
        return "<span style='color: #FF6347; font-weight: bold;'>中等级设备</span>"
    else:
        return "<span style='color: gray;'>未知设备</span>"


# ===================== 数据库查询函数（原样保留） =====================
def get_person_permission_level(person_id):
    try:
        conn = mysql.connector.connect(**DB_CONFIG["person_db_plss"])
        cursor = conn.cursor()
        cursor.execute("SELECT permission_level FROM person_permission WHERE person_id = %s", (person_id,))
        result = cursor.fetchone()
        return result[0] if result else None
    except Error as e:
        logger.error(f"查询人员权限失败: {e}")
        return None
    finally:
        if 'conn' in locals() and conn.is_connected():
            conn.close()


def get_device_level(device_id):
    try:
        mconn = mysql.connector.connect(**DB_CONFIG["device_db_plss"])
        mcursor = mconn.cursor()
        mcursor.execute("SELECT level FROM device_level WHERE device_id = %s", (device_id,))
        result = mcursor.fetchone()
        return result[0] if result else None
    except Error as e:
        logger.error(f"查询设备等级失败: {e}")
        return None
    finally:
        if 'mconn' in locals() and mconn.is_connected():
            mconn.close()


def get_device_name(device_id):
    try:
        mconn = mysql.connector.connect(**DB_CONFIG["device_db_plss"])
        mcursor = mconn.cursor()
        mcursor.execute("SELECT device_name FROM device_level WHERE device_id = %s", (device_id,))
        result = mcursor.fetchone()
        return result[0] if result else None
    except Error as e:
        logger.error(f"查询设备姓名失败: {e}")
        return None
    finally:
        if 'mconn' in locals() and mconn.is_connected():
            mconn.close()


# ===================== 替代原 UI 弹窗的数据上报工具 =====================
def upload_event_to_cloud(action_type, person_name, person_level_text, device_name, device_level_text, alarm_code=""):
    """
    将业务事件日志（通行状态）上传至云服务器 server.py:11500。
    协议：新版 JSON 协议（UTF-8 文本，server.py 自动提取 JSON 对象并路由到 11406 端口）。
    """
    payload = {
        "time": time.strftime("%H:%M:%S", time.localtime()),
        "gateway_id": "gateway_5",  # ★ server.py JSON 路由 → gateway_5 队列
        "action_type": action_type,  # 'success', 'warning', 'info'
        "person_name": person_name,
        "person_level_html": person_level_text,
        "device_name": device_name,
        "device_level_html": device_level_text,
        "alarm_code": alarm_code  # 如 'C_carrying_a', 'unauthorized' 等
    }

    # ★ 本地 JSONL 备份（后台线程写入，不阻塞主流程）
    def _write():
        try:
            os.makedirs(LOCAL_LOG_DIR, exist_ok=True)
            with open(LOCAL_LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(json.dumps(payload, ensure_ascii=False) + '\n')
        except Exception as e:
            print(f"\n❌ [本地日志写入失败] 错误信息: {e}")

    threading.Thread(target=_write, daemon=True).start()

    # ★ 云端 TCP 上传改为同步发送（消除 daemon 线程竞态，保证送达）
    sock = None
    try:
        json_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5.0)
        sock.connect((UPLOAD_VIDEO_HOST, UPLOAD_VIDEO_PORT))
        sock.sendall(json_bytes)
        logger.info(f"✅ 日志已上传云端 | alarm_code={alarm_code} | device={device_name} | person={person_name}")
    except Exception as e:
        logger.error(f"❌ 云端上传失败 | alarm_code={alarm_code} | device={device_name} | person={person_name} | 错误: {e}")
    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass


def upload_events_batch(events):
    """
    将多条业务事件合并到同一个 TCP 连接中发送。
    server.py 的 JsonObjectExtractor 天然支持从同一连接中提取多个 {…}{…} JSON 对象。
    解决两次独立短连接在极短间隔下第二条覆盖第一条的问题。

    events: [{"action_type": ..., "person_name": ..., ...}, ...]
    """
    if not events:
        return

    payloads = []
    for evt in events:
        payload = {
            "time": time.strftime("%H:%M:%S", time.localtime()),
            "gateway_id": "gateway_5",
            "action_type": evt.get("action_type", "info"),
            "person_name": evt.get("person_name", ""),
            "person_level_html": evt.get("person_level_html", ""),
            "device_name": evt.get("device_name", ""),
            "device_level_html": evt.get("device_level_html", ""),
            "alarm_code": evt.get("alarm_code", ""),
        }
        payloads.append(payload)

    # ★ 本地 JSONL 备份（每条一行）
    def _write():
        try:
            os.makedirs(LOCAL_LOG_DIR, exist_ok=True)
            with open(LOCAL_LOG_FILE, 'a', encoding='utf-8') as f:
                for p in payloads:
                    f.write(json.dumps(p, ensure_ascii=False) + '\n')
        except Exception as e:
            print(f"\n❌ [本地日志写入失败] 错误信息: {e}")

    threading.Thread(target=_write, daemon=True).start()

    # ★ 合并为单个 TCP 连接发送：{…}{…}{…} 连续拼接
    sock = None
    try:
        combined = b"".join(
            json.dumps(p, ensure_ascii=False).encode('utf-8') for p in payloads
        )
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5.0)
        sock.connect((UPLOAD_VIDEO_HOST, UPLOAD_VIDEO_PORT))
        sock.sendall(combined)
        names = [p.get("alarm_code", "?") for p in payloads]
        logger.info(f"✅ 批量上传云端 ({len(payloads)}条) | alarm_codes={names}")
    except Exception as e:
        names = [p.get("alarm_code", "?") for p in payloads]
        logger.error(f"❌ 批量上传失败 ({len(payloads)}条) | alarm_codes={names} | 错误: {e}")
    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass


def send_startup_log_probe():
    """启动后主动写入一条探针日志到本地，用于验证日志写入链路。"""
    payload = {
        "time": time.strftime("%H:%M:%S", time.localtime()),
        "gateway_id": GATEWAY_ID,
        "action_type": "info",
        "person_name": "系统启动探针",
        "person_level_html": "<span>probe</span>",
        "device_name": "python_process",
        "device_level_html": "<span>probe</span>",
        "alarm_code": "startup_probe"
    }

    try:
        os.makedirs(LOCAL_LOG_DIR, exist_ok=True)
        with open(LOCAL_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(payload, ensure_ascii=False) + '\n')
        logger.info(f"启动探针日志已写入本地: {LOCAL_LOG_FILE}")
    except Exception as e:
        logger.error(f"启动探针日志写入失败: {e}")


# ===================== 视频推流子进程（完全独立） =====================
def parse_fire_value(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("true", "1", "on", "alarm", "fire"):
            return True
        if text in ("false", "0", "off", "clear", "safe", "nofire"):
            return False
    return None


def init_fire_state(shared_dict):
    shared_dict['fire_signal_active'] = False
    shared_dict['emergency_active'] = False
    shared_dict['pending_emergency'] = False
    shared_dict['business_busy'] = 0
    shared_dict['fire_clear_deadline'] = 0.0
    shared_dict['fire_last_source'] = ''
    shared_dict['fire_last_seq'] = ''
    shared_dict['fire_last_update'] = 0.0


def is_fire_emergency_active(shared_dict):
    return bool(shared_dict.get('emergency_active', False))


def begin_business_flow(shared_dict):
    shared_dict['business_busy'] = int(shared_dict.get('business_busy', 0)) + 1


def finish_business_flow(shared_dict):
    busy = max(0, int(shared_dict.get('business_busy', 0)) - 1)
    shared_dict['business_busy'] = busy
    if busy == 0 and shared_dict.get('pending_emergency') and shared_dict.get('fire_signal_active'):
        shared_dict['pending_emergency'] = False
        shared_dict['emergency_active'] = True
        shared_dict['fire_clear_deadline'] = 0.0
        logger.warning("火情信号已等待当前流程结束，现进入火情应急模式")


def update_fire_state(shared_dict, fire, source='', seq=''):
    now = time.time()
    shared_dict['fire_signal_active'] = bool(fire)
    shared_dict['fire_last_source'] = str(source or '')
    shared_dict['fire_last_seq'] = str(seq or '')
    shared_dict['fire_last_update'] = now

    if fire:
        shared_dict['fire_clear_deadline'] = 0.0
        if int(shared_dict.get('business_busy', 0)) > 0:
            shared_dict['pending_emergency'] = True
            logger.warning("收到 fire=true，当前业务处理中，等待本轮正常流程结束后进入火情模式")
        else:
            shared_dict['pending_emergency'] = False
            shared_dict['emergency_active'] = True
            logger.warning(f"收到 fire=true，进入火情应急模式；若 {FIRE_TRUE_STALE_SECONDS:.1f}s 内无刷新将自动准备恢复")
        return

    shared_dict['pending_emergency'] = False
    if shared_dict.get('emergency_active'):
        shared_dict['fire_clear_deadline'] = now + FIRE_CLEAR_DELAY_SECONDS
        logger.warning(f"收到 fire=false，将在 {FIRE_CLEAR_DELAY_SECONDS:.1f}s 后退出火情应急模式")
    else:
        shared_dict['fire_clear_deadline'] = 0.0


def fire_state_timer_loop(shared_dict):
    while True:
        time.sleep(0.2)
        now = time.time()
        last_fire_update = float(shared_dict.get('fire_last_update', 0.0) or 0.0)
        if shared_dict.get('fire_signal_active') and last_fire_update > 0:
            if now - last_fire_update >= FIRE_TRUE_STALE_SECONDS:
                if int(shared_dict.get('business_busy', 0)) > 0 and shared_dict.get('pending_emergency'):
                    continue
                shared_dict['fire_signal_active'] = False
                shared_dict['pending_emergency'] = False
                if shared_dict.get('emergency_active'):
                    shared_dict['fire_clear_deadline'] = now + FIRE_CLEAR_DELAY_SECONDS
                    logger.warning(
                        f"{FIRE_TRUE_STALE_SECONDS:.1f}s 内未收到新的 fire=true，"
                        f"将在 {FIRE_CLEAR_DELAY_SECONDS:.1f}s 后退出火情应急模式"
                    )
                else:
                    shared_dict['fire_clear_deadline'] = 0.0
                continue

        deadline = float(shared_dict.get('fire_clear_deadline', 0.0) or 0.0)
        if not deadline:
            continue
        if shared_dict.get('fire_signal_active'):
            shared_dict['fire_clear_deadline'] = 0.0
            continue
        if now >= deadline:
            shared_dict['emergency_active'] = False
            shared_dict['pending_emergency'] = False
            shared_dict['fire_clear_deadline'] = 0.0
            logger.warning("火情信号已稳定恢复，退出火情应急模式")


def mark_rfid_consumed(shared_dict, rfid, person_id='', person_name='', mode='normal'):
    consumed = shared_dict.get('rfid_consumed')
    if consumed is None:
        return
    consumed[rfid] = {
        "time": time.time(),
        "person_id": str(person_id or ''),
        "person_name": str(person_name or ''),
        "mode": str(mode or 'normal')
    }


def is_rfid_recently_consumed(shared_dict, rfid):
    consumed = shared_dict.get('rfid_consumed')
    if consumed is None:
        return False
    item = consumed.get(rfid)
    if not item:
        return False
    try:
        item_time = float(item.get("time", 0.0))
    except Exception:
        item_time = 0.0
    if time.time() - item_time < RFID_REUSE_COOLDOWN_SECONDS:
        return True
    try:
        del consumed[rfid]
    except Exception:
        pass
    if rfid in already_match:
        already_match[rfid] = 'false'
    return False


def remove_rfid_event(shared_dict, rfid):
    try:
        del shared_dict['rfid_events'][rfid]
    except Exception:
        pass


# ===================== 人员处理冷却追踪 =====================
def is_person_recently_processed(shared_dict, person_id):
    """检查该人员是否在冷却期内已被处理过"""
    processed = shared_dict.get('person_processed')
    if processed is None:
        return False
    item = processed.get(str(person_id))
    if not item:
        return False
    try:
        item_time = float(item.get("time", 0.0))
    except Exception:
        item_time = 0.0
    return (time.time() - item_time) < PERSON_PROCESS_COOLDOWN_SECONDS


def mark_person_processed(shared_dict, person_id, person_name, result_type):
    """标记该人员已被处理，冷却期内不再重复处理"""
    processed = shared_dict.get('person_processed')
    if processed is None:
        return
    processed[str(person_id)] = {
        "time": time.time(),
        "person_name": str(person_name or ''),
        "result": str(result_type or '')
    }
    # ★ 同步更新全局最后处理时间（供 Snap 冷却检查用，Snap 可能不携带 person_id）
    shared_dict['last_process_time'] = time.time()


class FireAlarmRequestHandler(BaseHTTPRequestHandler):
    shared_dict = None

    def log_message(self, fmt, *args):
        return

    def _send_json(self, status_code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        if self.path.split("?", 1)[0] not in ("/", "/status", "/health"):
            self._send_json(404, {"ok": False, "error": "use POST /alarm or GET /status"})
            return
        self._send_json(200, {
            "ok": True,
            "fire_signal_active": bool(self.shared_dict.get('fire_signal_active', False)),
            "emergency_active": bool(self.shared_dict.get('emergency_active', False)),
            "pending_emergency": bool(self.shared_dict.get('pending_emergency', False)),
            "business_busy": int(self.shared_dict.get('business_busy', 0)),
            "fire_clear_deadline": float(self.shared_dict.get('fire_clear_deadline', 0.0) or 0.0),
        })

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/alarm":
            self._send_json(404, {"ok": False, "error": "use POST /alarm"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                raise ValueError("invalid JSON body length")
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON body must be an object")
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})
            return

        remote_ip = self.client_address[0]
        if remote_ip != FIRE_BOARD_IP:
            logger.warning(f"收到非预期来源火情数据: {remote_ip}，仍按演示数据处理")

        fire = parse_fire_value(payload.get("fire"))
        if fire is None:
            self._send_json(400, {"ok": False, "error": "field 'fire' must be true or false"})
            return

        update_fire_state(
            self.shared_dict,
            fire,
            payload.get("source", payload.get("device_id", remote_ip)),
            payload.get("seq", payload.get("timestamp", ""))
        )
        self._send_json(200, {
            "ok": True,
            "fire": fire,
            "emergency_active": bool(self.shared_dict.get('emergency_active', False)),
            "pending_emergency": bool(self.shared_dict.get('pending_emergency', False))
        })


def run_fire_alarm_receiver(shared_dict):
    FireAlarmRequestHandler.shared_dict = shared_dict
    threading.Thread(target=fire_state_timer_loop, args=(shared_dict,), daemon=True).start()
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((FIRE_LISTEN_HOST, FIRE_LISTEN_PORT), FireAlarmRequestHandler)
    logger.info(f"火情监听服务已启动: http://{FIRE_LISTEN_HOST}:{FIRE_LISTEN_PORT}/alarm，开发板IP={FIRE_BOARD_IP}")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()


class LatestFrame:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame = None
        self.ts = 0.0

    def update(self, frame):
        with self.lock:
            self.frame = frame
            self.ts = time.time()

    def get(self):
        with self.lock:
            return self.frame, self.ts


def video_capture_loop(latest, stop_evt):
    cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    last_ok = time.time()
    while not stop_evt.is_set():
        ok, frame = cap.read()
        if not ok or frame is None:
            if time.time() - last_ok > 3:
                cap.release()
                time.sleep(0.5)
                cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                last_ok = time.time()
            else:
                time.sleep(0.01)
            continue
        last_ok = time.time()
        latest.update(frame)
    cap.release()


def video_send_loop(latest, stop_evt, gateway_id):
    """通过 TCP Socket 二进制协议将视频帧上传至云服务器（匹配 server.py 终极融合版 Framed 协议）"""
    last_sent_ts = 0.0
    interval = 1.0 / max(TARGET_FPS, 1)

    while not stop_evt.is_set():
        sock = None
        try:
            # 1. 建立 TCP 连接
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5.0)
            sock.connect((UPLOAD_VIDEO_HOST, UPLOAD_VIDEO_PORT))

            # 2. 发送握手：始终使用 b'S' + ID 路径（prefix=b''，支持 b'JPEG' 帧类型）
            #    注意：b'V' 路径只适用于 b'VIDE' 帧类型，与我们 b'JPEG' 不兼容
            id_bytes = gateway_id.encode('utf-8')
            handshake = b'S' + struct.pack('!B', len(id_bytes)) + id_bytes
            sock.sendall(handshake)
            logger.info(f"视频上传已连接 {UPLOAD_VIDEO_HOST}:{UPLOAD_VIDEO_PORT}，网关ID: {gateway_id}")

            next_t = time.time()

            while not stop_evt.is_set():
                # FPS 节流
                now_t = time.time()
                if now_t < next_t:
                    time.sleep(min(0.005, next_t - now_t))
                    continue
                next_t += interval

                # 获取最新帧
                frame, ts = latest.get()
                if frame is None or ts <= last_sent_ts:
                    continue
                last_sent_ts = ts

                # 缩放 + JPEG 编码
                frame_to_send = cv2.resize(frame, (RESIZE_WIDTH, RESIZE_HEIGHT))
                enc_ok, jpg = cv2.imencode(".jpg", frame_to_send,
                                           [int(cv2.IMWRITE_JPEG_QUALITY), int(JPEG_QUALITY)])
                if not enc_ok:
                    continue

                jpg_bytes = jpg.tobytes()

                # 3. 发送帧（匹配 server.py recv_packet + zhuanfa.py VID0 转发）：
                #    body = 4字节 meta_len(0) + JPEG数据
                #    header = 4字节 packet_type("VID0") + 8字节 body_size
                body = struct.pack('!I', 0) + jpg_bytes
                header = struct.pack('!4sQ', b'VID0', len(body))
                try:
                    sock.sendall(header + body)
                except (ConnectionError, BrokenPipeError, OSError, socket.timeout):
                    logger.warning("视频上传连接断开，准备重连...")
                    break

        except Exception as e:
            logger.error(f"视频上传连接失败: {e}")
        finally:
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass

        # 重连等待
        if not stop_evt.is_set():
            time.sleep(2.0)


def run_video_streamer():
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|max_delay;0|flags;low_delay"
    latest = LatestFrame()
    stop_evt = threading.Event()
    threading.Thread(target=video_capture_loop, args=(latest, stop_evt), daemon=True).start()
    threading.Thread(target=video_send_loop, args=(latest, stop_evt, GATEWAY_ID), daemon=True).start()
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        stop_evt.set()


# ===================== TCP RFID 接收端 =====================
def run_tcp_server(shared_dict):
    HOST, PORT, BUFFER_SIZE = '172.16.110.1', 2000, 1024
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(5)
        logger.info(f"TCP服务器已启动，监听地址 {HOST}:{PORT}")
        while True:
            try:
                conn, addr = s.accept()
                logger.info(f"\n客户端已连接: {addr[0]}:{addr[1]}")
                shared_dict['rfid_events'].clear()
                buffer = b''
                with conn:
                    while True:
                        data = conn.recv(BUFFER_SIZE)
                        if not data: break
                        buffer += data
                        while b'#' in buffer:
                            start_index = buffer.index(b'#')
                            if len(buffer) - start_index >= 40:
                                packet_bytes = buffer[start_index:start_index + 40]
                                buffer = buffer[start_index + 40:]
                                try:
                                    card_number = packet_bytes.decode('ascii')[21:31]
                                    if card_number != '0000000000':
                                        if is_rfid_recently_consumed(shared_dict, card_number):
                                            continue
                                        shared_dict['rfid_events'][card_number] = time.time()
                                        logger.info(f"📡 检测到RFID: {card_number}")
                                except Exception as e:
                                    logger.error(f"解析错误: {e}")
                            else:
                                break
                        else:
                            if len(buffer) > 100: buffer = b''
            except Exception as e:
                pass


# ===================== MQTT 客户端业务处理（100%保留原始逻辑） =====================
class MQTTCameraClient:
    def __init__(self, broker, port, topics, shared_dict, username=None, password=None):
        self.broker = broker
        self.port = port
        self.topics = topics
        self.username = username
        self.password = password
        self.shared_dict = shared_dict
        self.client = mqtt.Client(client_id="camera_client_1", protocol=mqtt.MQTTv311)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect
        if self.username and self.password:
            self.client.username_pw_set(self.username, self.password)
        self.connected_flag = multiprocessing.Event()
        self.disconnect_flag = multiprocessing.Event()

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            logger.info(f"已连接到MQTT代理 {self.broker}:{self.port}")
            self.connected_flag.set()
            for topic in self.topics:
                client.subscribe(topic, qos=1)
                logger.info(f"已订阅主题: {topic}")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode('utf-8'))
            logger.info(f"收到来自 {msg.topic} 的消息")
            if "Rec" in msg.topic:
                self._process_rec_data(payload)
            elif "Snap" in msg.topic:
                self._process_snap_data(payload)
        except Exception as e:
            logger.error(f"处理消息出错: {str(e)}")

    def _process_snap_data(self, data):
        try:
            # 原始逻辑清空大图片内存
            if "pic" in data["info"]:
                del data["info"]["pic"]
                import gc
                gc.collect()

            # ★ 如果该 Snap 包含人员信息，先检查冷却期
            person_id = data.get("info", {}).get("customId", "")
            if person_id and is_person_recently_processed(self.shared_dict, person_id):
                logger.info(f"Snap跳过: 人员 {person_id} 在冷却期内，已处理过")
                return

            # ★ 兜底：最近有人员被处理过（即使 Snap 不含 person_id）且无新 RFID，跳过
            last_pt = float(self.shared_dict.get('last_process_time', 0.0) or 0.0)
            if last_pt > 0 and (time.time() - last_pt) < PERSON_PROCESS_COOLDOWN_SECONDS:
                if not self.shared_dict.get('rfid_events'):
                    logger.info("Snap跳过: 最近有人员处理记录且无新RFID，冷却期内不重复弹窗")
                    return

            # 如果已经有 RFID 设备事件，后续会进入"检测到设备/人员设备认证"流程，
            # 此时不再先发"已入库人员，请通行"，避免同一次业务连续弹出人脸通过窗口。
            if self.shared_dict.get('rfid_events'):
                logger.info("Snap人脸通过事件已被设备联检流程接管，跳过预通行弹窗日志")
                return

            upload_event_to_cloud("info", "已入库人员", "", "人脸识别", "", "snap_prepass")
        except Exception:
            pass

    def _process_rec_data(self, data):
        begin_business_flow(self.shared_dict)
        try:
            operator = data.get("operator", "unknown")
            person_id = data["info"]["customId"]
            person_name = data["info"]["persionName"]
            person_level = get_person_permission_level(person_id)
            person_level_text = get_person_level_text(person_level)

            logger.info(
                f"识别数据 | 操作者: {operator} | 人员: {person_name} | ID: {person_id} | 等级: {person_level_text}")

            # ★ 人员冷却检查：同一人员在冷却期内的后续 Rec 事件直接跳过，
            #    防止 RFID 被消费后重复上报"无设备开门"等错误日志
            if is_person_recently_processed(self.shared_dict, person_id):
                logger.info(f"Rec跳过: 人员 {person_id}({person_name}) 在冷却期内，已处理过")
                return

            if is_fire_emergency_active(self.shared_dict):
                self.handle_fire_emergency_release(person_id, person_name, person_level, person_level_text)
                mark_person_processed(self.shared_dict, person_id, person_name, "fire_emergency")
                return

            if not self.shared_dict['rfid_events']:
                # 原文的无设备开门逻辑（仅在人员未被处理过时触发）
                upload_event_to_cloud("info", person_name, person_level_text, "无设备", "无", "无设备通行")
                logger.error(f"无设备开门")
                mark_person_processed(self.shared_dict, person_id, person_name, "no_device")
                return

            self.check_recent_rfid_events(person_id, person_name)
            # ★ 标记该人员已处理（无论成功/告警），冷却期内不再重复处理
            mark_person_processed(self.shared_dict, person_id, person_name, "device_check")
        except KeyError as e:
            logger.error(f"识别数据缺少预期字段: {str(e)}")

        finally:
            finish_business_flow(self.shared_dict)

    def handle_fire_emergency_release(self, person_id, person_name, person_level, person_level_text):
        rfid_events = self.shared_dict['rfid_events'].copy()
        fresh_rfids = []
        for rfid, event_time in rfid_events.items():
            if is_rfid_recently_consumed(self.shared_dict, rfid):
                remove_rfid_event(self.shared_dict, rfid)
                continue
            fresh_rfids.append(rfid)

        if not fresh_rfids:
            upload_event_to_cloud(
                "success",
                person_name,
                person_level_text,
                "无设备",
                "无",
                "fire_emergency_release"
            )
            logger.warning(f"火情应急放行: {person_name} 无设备通行")
            return

        for rfid in fresh_rfids:
            device_level = get_device_level(rfid)
            device_name = get_device_name(rfid) or rfid
            device_level_text = get_device_level_text(device_level)

            upload_events_batch([
                {
                    "action_type": "info",
                    "person_name": "火情应急检测中",
                    "person_level_html": "火情应急检测中",
                    "device_name": device_name,
                    "device_level_html": device_level_text,
                    "alarm_code": "detecting",
                },
                {
                    "action_type": "success",
                    "person_name": person_name,
                    "person_level_html": person_level_text,
                    "device_name": device_name,
                    "device_level_html": device_level_text,
                    "alarm_code": "fire_emergency_release",
                },
            ])
            mark_rfid_consumed(self.shared_dict, rfid, person_id, person_name, "fire")
            remove_rfid_event(self.shared_dict, rfid)
            already_match[rfid] = 'true'
            logger.warning(f"火情应急放行: {person_name} 携带 {device_name}({rfid})")

    def check_recent_rfid_events(self, person_id, person_name):
        """严格保留原始验证逻辑，包括日志输出与判重规则"""
        global first_detect_time_flag, first_detect_time, now_time, first_detect_man
        now_time = time.time()
        if first_detect_man == 0:
            first_detect_time = time.time()

        first_detect_man = 1
        person_level = get_person_permission_level(person_id)
        person_level_text = get_person_level_text(person_level)
        logger.info(f"开始检查人员 {person_id} 的关联RFID...")
        rfid_events = self.shared_dict['rfid_events'].copy()

        matched_rfids = []
        matched_man = []

        for rfid, event_time in rfid_events.items():
            if is_rfid_recently_consumed(self.shared_dict, rfid):
                remove_rfid_event(self.shared_dict, rfid)
                continue

            if already_match.get(rfid) == 'true':
                already_match[rfid] = 'false'

            device_level = get_device_level(rfid)
            device_name = get_device_name(rfid)
            device_level_text = get_device_level_text(device_level)

            # 严格保留这一句原本被我删掉的调试输出
            logger.info(f"{device_level} and {person_level}")

            # ★ 本 RFID 的所有上传事件先收集到 batch，最后合并为一次 TCP 连接发送
            batch_events = []

            if already_match.get(rfid) != 'true':
                batch_events.append({
                    "action_type": "info",
                    "person_name": "检测中",
                    "person_level_html": "检测中",
                    "device_name": device_name,
                    "device_level_html": device_level_text,
                    "alarm_code": "detecting",
                })
            elif already_match.get(rfid) == 'true':
                mark_rfid_consumed(self.shared_dict, rfid, person_id, person_name, "normal")
                remove_rfid_event(self.shared_dict, rfid)
                continue

            # A等级人员可以管理所有设备
            if person_level == 'A':
                matched_rfids.append(rfid)
                matched_man.append(person_name)
                del self.shared_dict['rfid_events'][rfid]
                logger.info(f"✅ RFID匹配成功: {rfid} -> 人员ID {person_id}")
                if already_match.get(rfid) != 'true':
                    batch_events.append({
                        "action_type": "success",
                        "person_name": person_name,
                        "person_level_html": person_level_text,
                        "device_name": device_name,
                        "device_level_html": device_level_text,
                        "alarm_code": "A_success",
                    })
                already_match[rfid] = 'true'

            # B等级人员只能管理b级设备
            elif person_level == 'B':
                if device_level == 'b':
                    matched_rfids.append(rfid)
                    matched_man.append(person_name)
                    del self.shared_dict['rfid_events'][rfid]
                    logger.info(f"✅ RFID匹配成功: {rfid} -> 人员ID {person_id}")
                    if already_match.get(rfid) != 'true':
                        batch_events.append({
                            "action_type": "success",
                            "person_name": person_name,
                            "person_level_html": person_level_text,
                            "device_name": device_name,
                            "device_level_html": device_level_text,
                            "alarm_code": "B_b_success",
                        })
                    already_match[rfid] = 'true'
                elif device_level == 'a':
                    logger.warning(f"❌ RFID不匹配: B级人员无权管理a级设备")
                    if already_match.get(rfid) != 'true':
                        batch_events.append({
                            "action_type": "warning",
                            "person_name": person_name,
                            "person_level_html": person_level_text,
                            "device_name": device_name,
                            "device_level_html": device_level_text,
                            "alarm_code": "B_carrying_a",
                        })
                    already_match[rfid] = 'true'

            # C等级人员不能管理任何设备
            elif person_level == 'C':
                logger.warning(f"❌ RFID不匹配: C级人员无权管理任何设备")
                if device_level == 'a':
                    if already_match.get(rfid) != 'true':
                        batch_events.append({
                            "action_type": "warning",
                            "person_name": person_name,
                            "person_level_html": person_level_text,
                            "device_name": device_name,
                            "device_level_html": device_level_text,
                            "alarm_code": "C_carrying_a",
                        })
                    already_match[rfid] = 'true'
                elif device_level == 'b':
                    if already_match.get(rfid) != 'true':
                        batch_events.append({
                            "action_type": "warning",
                            "person_name": person_name,
                            "person_level_html": person_level_text,
                            "device_name": device_name,
                            "device_level_html": device_level_text,
                            "alarm_code": "C_carrying_b",
                        })
                    already_match[rfid] = 'true'
                else:
                    if already_match.get(rfid) != 'true':
                        batch_events.append({
                            "action_type": "warning",
                            "person_name": person_name,
                            "person_level_html": person_level_text,
                            "device_name": device_name,
                            "device_level_html": device_level_text,
                            "alarm_code": "unauthorized",
                        })
                    already_match[rfid] = 'true'

            # ★ 合并为一次 TCP 连接发送，保证 detecting + result 同时到达
            if batch_events:
                upload_events_batch(batch_events)

            if already_match.get(rfid) == 'true':
                mark_rfid_consumed(self.shared_dict, rfid, person_id, person_name, "normal")
                remove_rfid_event(self.shared_dict, rfid)

        if not self.shared_dict['rfid_events']:
            first_detect_man = 0
            logger.error(f"开门")
            return

    def _on_disconnect(self, client, userdata, rc):
        if rc != 0:
            logger.warning(f"意外断开连接 (代码: {rc})。正在重新连接...")
            self.reconnect()

    def reconnect(self):
        while not self.disconnect_flag.is_set():
            try:
                self.client.reconnect()
                return
            except Exception:
                time.sleep(5)

    def connect(self):
        try:
            logger.info(f"正在连接到 {self.broker}:{self.port}...")
            self.client.connect(self.broker, self.port, keepalive=60)
            self.client.loop_start()
            if not self.connected_flag.wait(timeout=10):
                logger.error("连接超时")
        except Exception as e:
            logger.error(f"连接错误: {str(e)}")

    def run(self):
        self.connect()
        try:
            while not self.disconnect_flag.is_set():
                time.sleep(1)
        except KeyboardInterrupt:
            self.disconnect_flag.set()
            self.client.disconnect()
            self.client.loop_stop()


def run_mqtt_client(shared_dict):
    MQTT_BROKER, MQTT_PORT = "172.16.110.1", 61613
    TOPICS = ["mqtt/face/339425/Rec", "mqtt/face/339425/Snap"]
    client = MQTTCameraClient(MQTT_BROKER, MQTT_PORT, TOPICS, shared_dict, "admin", "password")
    client.run()


# ===================== 主程序 =====================
if __name__ == "__main__":
    logger.info(f"配置: 服务器={UPLOAD_VIDEO_HOST}:{UPLOAD_VIDEO_PORT}, 网关ID={GATEWAY_ID}")

    if ENABLE_STARTUP_LOG_PROBE:
        send_startup_log_probe()

    with Manager() as manager:
        shared_dict = manager.dict()
        shared_dict['rfid_events'] = manager.dict()
        shared_dict['rfid_consumed'] = manager.dict()
        shared_dict['person_processed'] = manager.dict()
        init_fire_state(shared_dict)

        # 核心3个独立进程：视频内存推流、RFID监听、MQTT鉴权
        processes = [
            Process(target=run_tcp_server, args=(shared_dict,), name="TCP_Server"),
            Process(target=run_mqtt_client, args=(shared_dict,), name="MQTT_Client"),
            Process(target=run_video_streamer, name="Video_Streamer"),
            Process(target=run_fire_alarm_receiver, args=(shared_dict,), name="Fire_Alarm_Receiver")
        ]

        for p in processes: p.start()
        logger.info("所有进程已启动（TCP服务器、MQTT客户端、视频内存直推引擎）...")

        try:
            for p in processes: p.join()
        except KeyboardInterrupt:
            logger.info("\n主程序收到中断信号，正在终止子进程...")
            for p in processes:
                if p.is_alive(): p.terminate()
