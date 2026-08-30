import multiprocessing
from multiprocessing import Manager, Process
import time
import logging
import mysql.connector
from mysql.connector import Error
import paho.mqtt.client as mqtt
import socket
import json
import threading
import os
import cv2
import requests

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
UPLOAD_VIDEO_URL = "http://36.152.33.88:8081/media/upload5.jsp"
UPLOAD_LOG_URL = "http://36.152.33.88:8081/media/receive_log.jsp"  # 指向 media 根目录下日志接收接口
ENABLE_STARTUP_LOG_PROBE = True

TARGET_FPS = 25
JPEG_QUALITY = 75
RESIZE_WIDTH = 960
RESIZE_HEIGHT = 540


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
    将原本要显示在 UI 上的所有文案和 HTML 标签，打包成 JSON 直接扔给服务器。
    前端直接获取这些数据渲染。
    """
    payload = {
        "time": time.strftime("%H:%M:%S", time.localtime()),
        "action_type": action_type,  # 'success', 'warning', 'info'
        "person_name": person_name,
        "person_level_html": person_level_text,
        "device_name": device_name,
        "device_level_html": device_level_text,
        "alarm_code": alarm_code  # 如 'C_carrying_a', 'unauthorized' 等
    }

    def _send():
        try:
            res = requests.post(UPLOAD_LOG_URL, json=payload, timeout=2)
            print(f"\n👉 [云端日志响应] 状态码: {res.status_code}, 返回: {res.text}")
        except Exception as e:
            print(f"\n❌ [云端日志发送失败] 错误信息: {e}")

    threading.Thread(target=_send, daemon=True).start()


def send_startup_log_probe():
    """启动后主动发送一条日志，用于验证服务端写入链路。"""
    payload = {
        "time": time.strftime("%H:%M:%S", time.localtime()),
        "action_type": "info",
        "person_name": "系统启动探针",
        "person_level_html": "<span>probe</span>",
        "device_name": "python_process",
        "device_level_html": "<span>probe</span>",
        "alarm_code": "startup_probe"
    }

    try:
        res = requests.post(UPLOAD_LOG_URL, json=payload, timeout=3)
        logger.info(f"启动探针日志已发送: status={res.status_code}, body={res.text}")
    except Exception as e:
        logger.error(f"启动探针日志发送失败: {e}")


# ===================== 视频推流子进程（完全独立） =====================
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


def video_send_loop(latest, stop_evt):
    session = requests.Session()
    headers = {"X-Upload-Type": "video"}
    last_sent_ts = 0.0
    interval = 1.0 / max(TARGET_FPS, 1)
    next_t = time.time()

    while not stop_evt.is_set():
        now = time.time()
        if now < next_t:
            time.sleep(min(0.005, next_t - now))
            continue
        next_t += interval

        frame, ts = latest.get()
        if frame is None or ts <= last_sent_ts: continue
        last_sent_ts = ts

        frame_to_send = cv2.resize(frame, (RESIZE_WIDTH, RESIZE_HEIGHT))
        enc_ok, jpg = cv2.imencode(".jpg", frame_to_send, [int(cv2.IMWRITE_JPEG_QUALITY), int(JPEG_QUALITY)])
        if not enc_ok: continue

        try:
            session.post(UPLOAD_VIDEO_URL, data=jpg.tobytes(), headers=headers, timeout=1.5)
        except:
            pass


def run_video_streamer():
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|max_delay;0|flags;low_delay"
    latest = LatestFrame()
    stop_evt = threading.Event()
    threading.Thread(target=video_capture_loop, args=(latest, stop_evt), daemon=True).start()
    threading.Thread(target=video_send_loop, args=(latest, stop_evt), daemon=True).start()
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

            # 如果已经有 RFID 设备事件，后续会进入“检测到设备/人员设备认证”流程，
            # 此时不再先发“已入库人员，请通行”，避免同一次业务连续弹出人脸通过窗口。
            if self.shared_dict.get('rfid_events'):
                logger.info("Snap人脸通过事件已被设备联检流程接管，跳过预通行弹窗日志")
                return

            upload_event_to_cloud("info", "已入库人员", "", "人脸识别", "", "snap_prepass")
        except Exception:
            pass

    def _process_rec_data(self, data):
        try:
            operator = data.get("operator", "unknown")
            person_id = data["info"]["customId"]
            person_name = data["info"]["persionName"]
            person_level = get_person_permission_level(person_id)
            person_level_text = get_person_level_text(person_level)

            logger.info(
                f"识别数据 | 操作者: {operator} | 人员: {person_name} | ID: {person_id} | 等级: {person_level_text}")

            if not self.shared_dict['rfid_events']:
                # 原文的无设备开门逻辑
                upload_event_to_cloud("info", person_name, person_level_text, "无设备", "无", "无设备通行")
                logger.error(f"无设备开门")
                return

            self.check_recent_rfid_events(person_id, person_name)
        except KeyError as e:
            logger.error(f"识别数据缺少预期字段: {str(e)}")

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
            device_level = get_device_level(rfid)
            device_name = get_device_name(rfid)
            device_level_text = get_device_level_text(device_level)

            # 严格保留这一句原本被我删掉的调试输出
            logger.info(f"{device_level} and {person_level}")

            if already_match[rfid] != 'true':
                upload_event_to_cloud("info", "检测中", "检测中", device_name, device_level_text, "detecting")
            elif already_match[rfid] == 'true':
                continue

            # A等级人员可以管理所有设备
            if person_level == 'A':
                matched_rfids.append(rfid)
                matched_man.append(person_name)
                del self.shared_dict['rfid_events'][rfid]
                logger.info(f"✅ RFID匹配成功: {rfid} -> 人员ID {person_id}")
                if already_match[rfid] != 'true':
                    upload_event_to_cloud("success", person_name, person_level_text, device_name, device_level_text,
                                          "A_success")
                already_match[rfid] = 'true'

            # B等级人员只能管理b级设备
            elif person_level == 'B':
                if device_level == 'b':
                    matched_rfids.append(rfid)
                    matched_man.append(person_name)
                    del self.shared_dict['rfid_events'][rfid]
                    logger.info(f"✅ RFID匹配成功: {rfid} -> 人员ID {person_id}")
                    if already_match[rfid] != 'true':
                        upload_event_to_cloud("success", person_name, person_level_text, device_name, device_level_text,
                                              "B_b_success")
                    already_match[rfid] = 'true'
                elif device_level == 'a':
                    logger.warning(f"❌ RFID不匹配: B级人员无权管理a级设备")
                    if already_match[rfid] != 'true':
                        upload_event_to_cloud("warning", person_name, person_level_text, device_name, device_level_text,
                                              "B_carrying_a")
                    already_match[rfid] = 'true'

            # C等级人员不能管理任何设备
            elif person_level == 'C':
                logger.warning(f"❌ RFID不匹配: C级人员无权管理任何设备")
                if device_level == 'a':
                    if already_match[rfid] != 'true':
                        upload_event_to_cloud("warning", person_name, person_level_text, device_name, device_level_text,
                                              "C_carrying_a")
                    already_match[rfid] = 'true'
                elif device_level == 'b':
                    if already_match[rfid] != 'true':
                        upload_event_to_cloud("warning", person_name, person_level_text, device_name, device_level_text,
                                              "C_carrying_b")
                    already_match[rfid] = 'true'
                else:
                    if already_match[rfid] != 'true':
                        upload_event_to_cloud("warning", person_name, person_level_text, device_name, device_level_text,
                                              "unauthorized")
                    already_match[rfid] = 'true'

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
    if ENABLE_STARTUP_LOG_PROBE:
        send_startup_log_probe()

    with Manager() as manager:
        shared_dict = manager.dict()
        shared_dict['rfid_events'] = manager.dict()

        # 核心3个独立进程：视频内存推流、RFID监听、MQTT鉴权
        processes = [
            Process(target=run_tcp_server, args=(shared_dict,), name="TCP_Server"),
            Process(target=run_mqtt_client, args=(shared_dict,), name="MQTT_Client"),
            Process(target=run_video_streamer, name="Video_Streamer")
        ]

        for p in processes: p.start()
        logger.info("所有进程已启动（TCP服务器、MQTT客户端、视频内存直推引擎）...")

        try:
            for p in processes: p.join()
        except KeyboardInterrupt:
            logger.info("\n主程序收到中断信号，正在终止子进程...")
            for p in processes:
                if p.is_alive(): p.terminate()
