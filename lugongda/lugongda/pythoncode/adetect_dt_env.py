import argparse
import json
import queue
import socket
import time
from pathlib import Path
from typing import Dict, Optional
import os
import shutil

import cv2
import requests
import torch
import torch.backends.cudnn as cudnn
from numpy import random

from models.experimental import attempt_load
from utils.datasets import LoadStreams, LoadImages
from utils.general import check_img_size, check_imshow, non_max_suppression, scale_coords, xyxy2xywh, set_logging
from utils.plots import plot_one_box
from utils.torch_utils import select_device, TracedModel

import threading

SCRIPT_ROOT = Path(__file__).resolve().parent

# 固定运行配置：如需调整，修改下方常量即可
VIEW_IMG = False
AUDIO_ALERT_ENABLED = False
TEXT_ALERT_ENABLED = False
SNAPSHOT_ENABLED = True
SAVE_LOCAL_SNAPSHOTS = False

IMG_SIZE_DEFAULT = 640
SMALL_IMG_SIZE = 320

FIRE_CONF_THRESHOLD = 0.65
TEXT_ALERT_MIN_INTERVAL = 2.0

SAVE_TXT_RESULTS = False
SAVE_TXT_WITH_CONF = False

SNAPSHOT_DIR = str(SCRIPT_ROOT / 'fire_saved')
SNAPSHOT_PERIODIC_DIRNAME = 'periodic'
SNAPSHOT_PERIOD_SECONDS = 6.0
SNAPSHOT_FIRE_INTERVAL_SECONDS = 1.0

HTTP_UPLOAD_TARGET = {
    'video_url': 'http://36.152.33.88:8081/media/upload_env.jsp',
    'snapshot_url': 'http://36.152.33.88:8081/media/upload_env.jsp',
    'video_quality': 54,
    'snapshot_quality': 88,
    'video_fps': 15.0,
    'video_max_width': 512,
    'snapshot_max_width': 960,
    'timeout': 2.0,
    'retry_interval': 0.1,
}

# 新增：状态socket。这里传 JSON 行文本，例如:
# {"fire": "true", "timestamp": "2026-04-22 14:30:00"}\n
# host 建议改成对端开发板有线静态IP，例如 192.168.1.88
STATUS_SOCKET_TARGET = {
    # 默认关闭旧的有线状态 socket；如需恢复给中间开发板发 true/false，再填 host/bind
    'host': '',
    'port': 6006,
    'bind': '',
    'timeout': 2.0,
    'retry_interval': 1.0,
}

# 新增：防抖参数
STATUS_DEBOUNCE = {
    # 连续多少个“检测到火”的判定后，才真正进入告警态并发送1
    'activate_hits': 2,
    # 告警后至少保持多久，避免画面抖动导致1/0频繁跳变
    'hold_seconds': 3.0,
    # 连续多少个“未检测到火”的判定，且超过保持时间后，才允许退出告警态
    'release_hits': 3,
    # 两次发送之间的最小间隔，避免网络抖动时重复狂发
    'min_send_interval': 0.3,
}

# 新增：环境元信息缓存文件，由 env_collector_py38.py 持续刷新
ENV_META_SOURCE = {
    'path': str(SCRIPT_ROOT / 'env_latest.json'),
    'refresh_interval': 0.5,
    'max_age_seconds': 5.0,
    'upload_interval': 2.0,
}

AUGMENT_INFERENCE = False
CLASS_FILTER = None
AGNOSTIC_NMS = False


def remove_dir_and_make(path: str):
    """Remove dir if exists, then recreate."""
    if os.path.exists(path):
        shutil.rmtree(path)
    os.makedirs(path, exist_ok=True)
    print(f"{path} created/reset")


def _safe_header_str(value) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.replace('\r', ' ').replace('\n', ' ')


def resize_for_upload(frame, max_width: int):
    if frame is None or not max_width or max_width <= 0:
        return frame
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame
    scale = float(max_width) / float(width)
    target_size = (int(max_width), max(1, int(height * scale)))
    return cv2.resize(frame, target_size, interpolation=cv2.INTER_AREA)


class HttpUploadClient:
    """HTTP async uploader for boxed video frames and snapshot images."""

    def __init__(
        self,
        video_url: str,
        snapshot_url: str,
        reconnect_interval: float = 2.0,
        timeout: float = 2.0,
        video_quality: int = 80,
        snapshot_quality: int = 88,
        queue_size: int = 256,
    ) -> None:
        self.video_url = video_url
        self.snapshot_url = snapshot_url or video_url
        self.reconnect_interval = max(0.05, reconnect_interval)
        self.timeout = timeout
        self.video_quality = max(1, min(100, video_quality))
        self.snapshot_quality = max(1, min(100, snapshot_quality))
        self._stop = False
        self._queue: "queue.Queue[Optional[tuple]]" = queue.Queue(maxsize=max(8, queue_size))
        self._video_lock = threading.Lock()
        self._video_event = threading.Event()
        self._latest_video_packet: Optional[tuple] = None
        self._failure_count = {'video': 0, 'snapshot': 0}
        self._pause_until = {'video': 0.0, 'snapshot': 0.0}
        self._last_error_log = {'video': 0.0, 'snapshot': 0.0}
        self._max_backoff = 8.0
        self._error_log_interval = 5.0
        self._sessions = {
            'video': requests.Session(),
            'snapshot': requests.Session(),
        }
        self._worker = threading.Thread(target=self._sender_loop, name='http-snapshot-uploader', daemon=True)
        self._video_worker = threading.Thread(target=self._video_sender_loop, name='http-video-uploader', daemon=True)
        self._worker.start()
        self._video_worker.start()

    def close(self) -> None:
        self._stop = True
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        self._video_event.set()
        for worker in (self._worker, self._video_worker):
            if worker.is_alive():
                worker.join(timeout=2.0)
        for session in self._sessions.values():
            session.close()

    def encode_frame(self, frame, quality: Optional[int] = None) -> bytes:
        if quality is None:
            quality = self.video_quality
        quality = max(1, min(100, quality))
        ok, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if not ok:
            print('[HTTP] frame encode failed')
            return b''
        return buffer.tobytes()

    def send_video_bytes(self, payload: bytes, frame_id: int, extra_meta: Optional[Dict] = None) -> None:
        if not payload:
            return
        meta = {'type': 'video', 'frame_id': frame_id, 'timestamp': time.time()}
        if extra_meta:
            meta.update(extra_meta)
        self._queue_packet('video', meta, payload)

    def send_snapshot_bytes(self, payload: bytes, event_type: str, event_id: int, extra_meta: Optional[Dict] = None) -> None:
        if not payload:
            return
        meta = {'type': 'snapshot', 'event': event_type, 'event_id': event_id, 'timestamp': time.time()}
        if extra_meta:
            meta.update(extra_meta)
        self._queue_packet('snapshot', meta, payload)

    def _queue_packet(self, data_type: str, meta: Dict, payload: bytes) -> None:
        packet = (data_type, meta, payload)
        if data_type == 'video':
            if self._is_paused('video'):
                return
            with self._video_lock:
                self._latest_video_packet = packet
            self._video_event.set()
            return

        try:
            self._queue.put_nowait(packet)
        except queue.Full:
            print(f"[HTTP] drop {data_type} packet (queue full)")

    def _pop_latest_video_packet(self) -> Optional[tuple]:
        with self._video_lock:
            packet = self._latest_video_packet
            self._latest_video_packet = None
            self._video_event.clear()
        return packet

    def _sender_loop(self) -> None:
        while True:
            try:
                packet = self._queue.get(timeout=0.5)
            except queue.Empty:
                if self._stop:
                    break
                continue
            if packet is None:
                break
            data_type, meta, payload = packet
            self._send_packet(data_type, meta, payload)

    def _video_sender_loop(self) -> None:
        while not self._stop:
            self._video_event.wait(timeout=0.5)
            packet = self._pop_latest_video_packet()
            if packet is None:
                continue
            data_type, meta, payload = packet
            self._send_packet(data_type, meta, payload)

    def _is_paused(self, data_type: str) -> bool:
        return time.time() < self._pause_until.get(data_type, 0.0)

    def is_upload_paused(self, data_type: str) -> bool:
        return self._is_paused(data_type)

    def _reset_session(self, data_type: str) -> None:
        session_key = 'video' if data_type == 'video' else 'snapshot'
        try:
            self._sessions[session_key].close()
        except Exception:
            pass
        self._sessions[session_key] = requests.Session()

    def _mark_upload_success(self, data_type: str) -> None:
        if self._failure_count.get(data_type, 0) > 0:
            print(f"[HTTP] upload recovered ({data_type})")
        self._failure_count[data_type] = 0
        self._pause_until[data_type] = 0.0

    def _mark_upload_failure(self, data_type: str, exc: Exception) -> None:
        now = time.time()
        failure_count = self._failure_count.get(data_type, 0) + 1
        self._failure_count[data_type] = failure_count
        backoff_multiplier = 2 ** min(failure_count - 1, 4)
        backoff = min(self._max_backoff, max(0.5, self.reconnect_interval) * backoff_multiplier)
        self._pause_until[data_type] = now + backoff
        last_log = self._last_error_log.get(data_type, 0.0)
        if failure_count <= 3 or (now - last_log) >= self._error_log_interval:
            self._last_error_log[data_type] = now
            print(f"[HTTP] upload failed ({data_type}), retry in {backoff:.1f}s: {exc}")
        self._reset_session(data_type)

    def _send_packet(self, data_type: str, meta: Dict, payload: bytes) -> None:
        if self._is_paused(data_type):
            return

        url = self.video_url if data_type == 'video' else self.snapshot_url
        if not url:
            return
        headers = {
            'X-Upload-Type': data_type,
            'X-Timestamp': str(meta.get('timestamp', time.time())),
        }
        if data_type == 'video':
            headers['X-Frame-Id'] = str(meta.get('frame_id', 0))
        else:
            headers['X-Event-Type'] = str(meta.get('event', 'snapshot'))
            headers['X-Event-Id'] = str(meta.get('event_id', 0))
            headers['X-Filename'] = str(meta.get('filename', 'snapshot.jpg'))

        env_header_map = {
            'env_collector_time': 'X-Env-Collector-Time',
            'temperature_c': 'X-Temp-C',
            'humidity_rh': 'X-Humidity-RH',
            'dewpoint_c': 'X-Dewpoint-C',
            'smoke_ppm': 'X-Smoke-PPM',
            'smoke_mq2_state': 'X-Smoke-State',
        }
        for meta_key, header_key in env_header_map.items():
            header_value = _safe_header_str(meta.get(meta_key))
            if header_value is not None:
                headers[header_key] = header_value

        try:
            session_key = 'video' if data_type == 'video' else 'snapshot'
            response = self._sessions[session_key].post(url, data=payload, headers=headers, timeout=self.timeout)
            if response.status_code >= 400:
                raise requests.exceptions.HTTPError(f"HTTP {response.status_code}: {response.text[:120]}")
            self._mark_upload_success(data_type)
        except requests.exceptions.RequestException as exc:
            self._mark_upload_failure(data_type, exc)


class StatusSocketClient:
    """轻量级状态上报客户端，发送 JSON 行文本。"""

    def __init__(
        self,
        host: str,
        port: int,
        bind_ip: str = '',
        reconnect_interval: float = 1.0,
        timeout: float = 2.0,
        queue_size: int = 128,
    ) -> None:
        self.host = host
        self.port = port
        self.bind_ip = bind_ip
        self.reconnect_interval = max(0.1, reconnect_interval)
        self.timeout = max(0.2, timeout)
        self._sock: Optional[socket.socket] = None
        self._lock = threading.Lock()
        self._stop = False
        self._queue: "queue.Queue[Optional[str]]" = queue.Queue(maxsize=max(8, queue_size))
        self._worker = threading.Thread(target=self._sender_loop, name='status-socket-sender', daemon=True)
        self._worker.start()

    @staticmethod
    def _build_payload(status: int, now: Optional[float] = None) -> str:
        if now is None:
            now = time.time()
        payload = {
            'fire': 'true' if int(status) else 'false',
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now)),
        }
        return json.dumps(payload, ensure_ascii=False)

    def close(self) -> None:
        with self._lock:
            self._stop = True
            if self._sock:
                try:
                    self._sock.close()
                except OSError:
                    pass
                self._sock = None
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        if self._worker.is_alive():
            self._worker.join(timeout=2.0)

    def send_status(self, status: int, now: Optional[float] = None) -> None:
        text = self._build_payload(status, now=now)
        try:
            self._queue.put_nowait(text)
        except queue.Full:
            print(f'[STATUS] drop status {text} (queue full)')

    def _sender_loop(self) -> None:
        while True:
            try:
                packet = self._queue.get(timeout=0.5)
            except queue.Empty:
                if self._stop:
                    break
                continue
            if packet is None:
                break
            self._send_packet(packet)

    def _ensure_connected(self) -> Optional[socket.socket]:
        if not self.host or not self.port or self._stop:
            return None
        if self._sock:
            return self._sock

        next_retry = 0.0
        while not self._sock and not self._stop:
            now = time.time()
            if now < next_retry:
                time.sleep(0.05)
                continue
            sock = None
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                sock.settimeout(self.timeout)
                if self.bind_ip:
                    sock.bind((self.bind_ip, 0))
                sock.connect((self.host, self.port))
                sock.settimeout(None)
                self._sock = sock
                print(f'[STATUS] connected to {self.host}:{self.port}')
                return self._sock
            except OSError as exc:
                print(f'[STATUS] connect failed: {exc}')
                if sock is not None:
                    try:
                        sock.close()
                    except Exception:
                        pass
                next_retry = now + self.reconnect_interval
        return self._sock

    def _send_packet(self, text: str) -> None:
        sock = self._ensure_connected()
        if not sock:
            return
        payload = (text + '\n').encode('utf-8', errors='ignore')
        try:
            sock.sendall(payload)
            print(f'[STATUS] sent: {text}')
        except OSError as exc:
            print(f'[STATUS] send failed: {exc}')
            with self._lock:
                if self._sock:
                    try:
                        self._sock.close()
                    except OSError:
                        pass
                    self._sock = None


class FireStatusDebouncer:
    """把原始 fire_detected 平滑成稳定状态，避免 1/0 抖动。"""

    def __init__(
        self,
        activate_hits: int = 2,
        release_hits: int = 3,
        hold_seconds: float = 3.0,
        min_send_interval: float = 0.3,
    ) -> None:
        self.activate_hits = max(1, int(activate_hits))
        self.release_hits = max(1, int(release_hits))
        self.hold_seconds = max(0.0, float(hold_seconds))
        self.min_send_interval = max(0.0, float(min_send_interval))

        self._active = False
        self._fire_hits = 0
        self._no_fire_hits = 0
        self._last_fire_ts = 0.0
        self._last_send_ts = 0.0
        self._last_sent_status: Optional[int] = None

    @property
    def active(self) -> bool:
        return self._active

    def update(self, raw_fire: bool, now: float) -> bool:
        if raw_fire:
            self._fire_hits += 1
            self._no_fire_hits = 0
            self._last_fire_ts = now
            if not self._active and self._fire_hits >= self.activate_hits:
                self._active = True
        else:
            self._fire_hits = 0
            self._no_fire_hits += 1
            hold_ok = (now - self._last_fire_ts) >= self.hold_seconds
            if self._active and hold_ok and self._no_fire_hits >= self.release_hits:
                self._active = False
        return self._active

    def should_send(self, status: int, now: float, force: bool = False) -> bool:
        status = int(bool(status))
        if force:
            if now - self._last_send_ts < self.min_send_interval:
                return False
            return True
        if self._last_sent_status is None:
            if now - self._last_send_ts < self.min_send_interval:
                return False
            return True
        if status != self._last_sent_status and (now - self._last_send_ts) >= self.min_send_interval:
            return True
        return False

    def mark_sent(self, status: int, now: float) -> None:
        self._last_sent_status = int(bool(status))
        self._last_send_ts = now


class SnapshotSaver:
    """Async snapshot saver to avoid blocking detection loop."""

    def __init__(self, max_queue: int = 64) -> None:
        self._queue: "queue.Queue[Optional[tuple]]" = queue.Queue(maxsize=max(8, max_queue))
        self._stop = False
        self._thread = threading.Thread(target=self._worker, name='snapshot-saver', daemon=True)
        self._thread.start()

    def submit(self, path: str, image) -> None:
        job = (path, image.copy())
        try:
            self._queue.put_nowait(job)
        except queue.Full:
            print('[SAVE] drop snapshot (queue full)')

    def close(self) -> None:
        if self._stop:
            return
        self._stop = True
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        self._thread.join(timeout=2.0)

    def _worker(self) -> None:
        while True:
            job = self._queue.get()
            if job is None:
                break
            path, image = job
            try:
                cv2.imwrite(path, image)
            except Exception as exc:
                print(f"[SAVE][FAIL] {path}: {exc}")


class EnvMetaReader:
    """读取 env_latest.json，并把需要的字段摊平为 HTTP 元信息。"""

    def __init__(self, path: str, refresh_interval: float = 0.5, max_age_seconds: float = 5.0) -> None:
        self.path = path
        self.refresh_interval = max(0.1, float(refresh_interval))
        self.max_age_seconds = max(0.0, float(max_age_seconds))
        self._last_refresh_ts = 0.0
        self._last_mtime = None
        self._cached_meta: Dict = {}

    def get_meta(self) -> Dict:
        now = time.time()
        if (now - self._last_refresh_ts) < self.refresh_interval and self._cached_meta:
            return dict(self._cached_meta)

        self._last_refresh_ts = now
        try:
            if not self.path or not os.path.exists(self.path):
                return {}
            mtime = os.path.getmtime(self.path)
            if self.max_age_seconds > 0 and (now - mtime) > self.max_age_seconds:
                self._cached_meta = {}
                self._last_mtime = mtime
                return {}
            if self._last_mtime == mtime and self._cached_meta:
                return dict(self._cached_meta)

            with open(self.path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            temp_block = data.get('temp_humidity', {}) if isinstance(data.get('temp_humidity', {}), dict) else {}
            smoke_block = data.get('smoke', {}) if isinstance(data.get('smoke', {}), dict) else {}

            meta = {
                'env_collector_time': data.get('collector_time'),
                'temperature_c': temp_block.get('temperature_c') if temp_block.get('ok') else None,
                'humidity_rh': temp_block.get('humidity_rh') if temp_block.get('ok') else None,
                'dewpoint_c': temp_block.get('dewpoint_c') if temp_block.get('ok') else None,
                'smoke_ppm': smoke_block.get('smoke_ppm') if smoke_block.get('ok') else None,
                'smoke_mq2_state': smoke_block.get('mq2_state') if smoke_block.get('ok') else None,
            }
            self._last_mtime = mtime
            self._cached_meta = meta
            return dict(meta)
        except Exception as exc:
            print(f'[ENV] read env meta failed: {exc}')
            return {}

    def get_last_mtime(self) -> Optional[float]:
        return self._last_mtime


class EnvJsonUploader:
    """Upload latest env JSON to server when the source file changes."""

    def __init__(
        self,
        url: str,
        env_reader: EnvMetaReader,
        interval: float,
        timeout: float,
        retry_interval: float,
    ) -> None:
        self.url = url
        self.env_reader = env_reader
        self.interval = max(0.1, float(interval))
        self.timeout = max(0.5, float(timeout))
        self.retry_interval = max(0.1, float(retry_interval))
        self._last_sent_mtime: Optional[float] = None
        self._stop = False
        self._failure_count = 0
        self._pause_until = 0.0
        self._last_error_log = 0.0
        self._max_backoff = 10.0
        self._error_log_interval = 10.0
        self._session = requests.Session()
        self._thread = threading.Thread(target=self._worker, name='env-uploader', daemon=True)
        self._thread.start()

    def close(self) -> None:
        if self._stop:
            return
        self._stop = True
        self._thread.join(timeout=2.0)
        self._session.close()

    def _reset_session(self) -> None:
        try:
            self._session.close()
        except Exception:
            pass
        self._session = requests.Session()

    def _mark_success(self) -> None:
        if self._failure_count > 0:
            print('[ENV] upload recovered')
        self._failure_count = 0
        self._pause_until = 0.0

    def _mark_failure(self, exc: Exception) -> None:
        now = time.time()
        self._failure_count += 1
        backoff_multiplier = 2 ** min(self._failure_count - 1, 4)
        backoff = min(self._max_backoff, max(0.5, self.retry_interval) * backoff_multiplier)
        self._pause_until = now + backoff
        if self._failure_count <= 3 or (now - self._last_error_log) >= self._error_log_interval:
            self._last_error_log = now
            print(f'[ENV] upload failed, retry in {backoff:.1f}s: {exc}')
        self._reset_session()

    def _worker(self) -> None:
        while not self._stop:
            try:
                if time.time() < self._pause_until:
                    time.sleep(self.interval)
                    continue
                meta = self.env_reader.get_meta()
                mtime = self.env_reader.get_last_mtime()
                if meta and mtime is not None and mtime != self._last_sent_mtime:
                    payload = json.dumps(meta, ensure_ascii=False).encode('utf-8')
                    headers = {
                        'X-Upload-Type': 'env',
                        'Content-Type': 'application/json',
                    }
                    try:
                        response = self._session.post(self.url, data=payload, headers=headers, timeout=self.timeout)
                        if response.status_code >= 400:
                            raise requests.exceptions.HTTPError(f"HTTP {response.status_code}: {response.text[:120]}")
                        self._last_sent_mtime = mtime
                        self._mark_success()
                    except requests.exceptions.RequestException as exc:
                        self._mark_failure(exc)
            except Exception as exc:
                print(f'[ENV] upload error: {exc}')
            time.sleep(self.interval)


def detect(save_img=False):
    source, weights = opt.source, opt.weights
    view_img, save_txt = VIEW_IMG, SAVE_TXT_RESULTS
    imgsz, trace = opt.img_size, not opt.no_trace
    text_alert, fire_conf = TEXT_ALERT_ENABLED, FIRE_CONF_THRESHOLD
    save_img = False
    webcam = source.isnumeric() or source.endswith('.txt') or source.lower().startswith(
        ('rtsp://', 'rtmp://', 'http://', 'https://'))
    snapshot_enabled = SNAPSHOT_ENABLED

    save_dir = None

    if snapshot_enabled:
        SNAP_DIR = SNAPSHOT_DIR
        SNAP_PERIODIC_DIR = str(Path(SNAP_DIR).parent / SNAPSHOT_PERIODIC_DIRNAME)
        save_snapshots_local = SAVE_LOCAL_SNAPSHOTS
        if save_snapshots_local:
            remove_dir_and_make(SNAP_DIR)
            remove_dir_and_make(SNAP_PERIODIC_DIR)
        STARTUP_SHOT_DONE = False
        PERIODIC_INTERVAL_SEC = SNAPSHOT_PERIOD_SECONDS
        last_periodic_ts = 0.0
        FIRE_ALERT_MIN_INTERVAL = SNAPSHOT_FIRE_INTERVAL_SECONDS
        last_fire_alert_ts = 0.0
    else:
        save_snapshots_local = False

    set_logging()
    device = select_device(opt.device)
    half = device.type != 'cpu'

    model = attempt_load(weights, map_location=device)
    stride = int(model.stride.max())
    imgsz = check_img_size(imgsz, s=stride)

    if trace:
        model = TracedModel(model, device, opt.img_size)

    if half:
        model.half()

    vid_path, vid_writer = None, None
    if webcam:
        view_img = view_img and check_imshow()
        cudnn.benchmark = True
        dataset = LoadStreams(source, img_size=imgsz, stride=stride)
    else:
        dataset = LoadImages(source, img_size=imgsz, stride=stride)

    draw_boxes = bool(opt.video_upload_url or opt.snapshot_upload_url) or view_img or save_img

    http_client = None
    if opt.video_upload_url or opt.snapshot_upload_url:
        http_client = HttpUploadClient(
            video_url=opt.video_upload_url,
            snapshot_url=opt.snapshot_upload_url,
            reconnect_interval=opt.http_retry_interval,
            timeout=opt.http_timeout,
            video_quality=opt.video_quality,
            snapshot_quality=opt.snapshot_quality,
        )
    else:
        print('[HTTP] upload disabled (no URL configured)')

    status_socket = None
    if opt.status_socket_host:
        status_socket = StatusSocketClient(
            host=opt.status_socket_host,
            port=opt.status_socket_port,
            bind_ip=opt.status_socket_bind,
            reconnect_interval=opt.status_socket_retry_interval,
            timeout=opt.status_socket_timeout,
        )
    else:
        print('[STATUS] status socket disabled (no host configured)')

    debouncer = FireStatusDebouncer(
        activate_hits=opt.status_activate_hits,
        release_hits=opt.status_release_hits,
        hold_seconds=opt.status_hold_seconds,
        min_send_interval=opt.status_min_send_interval,
    )

    snapshot_saver = SnapshotSaver() if (snapshot_enabled and save_snapshots_local) else None
    snapshot_seq = 0

    env_reader = None
    if opt.env_meta_path:
        env_reader = EnvMetaReader(
            opt.env_meta_path,
            refresh_interval=opt.env_meta_refresh_interval,
            max_age_seconds=opt.env_meta_max_age,
        )
        print(f'[ENV] env meta enabled: {opt.env_meta_path}')
    else:
        print('[ENV] env meta disabled')

    env_uploader = None
    if env_reader and opt.env_upload_url:
        env_uploader = EnvJsonUploader(
            url=opt.env_upload_url,
            env_reader=env_reader,
            interval=opt.env_upload_interval,
            timeout=opt.http_timeout,
            retry_interval=opt.http_retry_interval,
        )
        print(f'[ENV] env upload enabled: {opt.env_upload_url}')
    else:
        print('[ENV] env upload disabled')

    names = model.module.names if hasattr(model, 'module') else model.names
    colors = [[random.randint(0, 255) for _ in range(3)] for _ in names]

    detected_labels = [] if text_alert else None

    if device.type != 'cpu':
        model(torch.zeros(1, 3, imgsz, imgsz).to(device).type_as(next(model.parameters())))
    old_img_w = old_img_h = imgsz
    old_img_b = 1

    t0 = time.time()
    frame_counter = 0
    fps_avg = None
    last_loop_ts = time.time()
    last_text_alert_ts = 0.0
    last_video_upload_ts = 0.0
    video_upload_interval = 0.0 if opt.video_upload_fps <= 0 else (1.0 / opt.video_upload_fps)

    def upload_video_frame_if_due(frame_image, frame_id: int, now_ts: float) -> None:
        nonlocal last_video_upload_ts
        if not http_client or frame_image is None:
            return
        video_due = (
            not http_client.is_upload_paused('video')
            and (video_upload_interval <= 0 or (now_ts - last_video_upload_ts) >= video_upload_interval)
        )
        if not video_due:
            return
        video_frame = resize_for_upload(frame_image, opt.video_upload_width)
        encoded_video_frame = http_client.encode_frame(video_frame, quality=http_client.video_quality)
        if encoded_video_frame:
            http_client.send_video_bytes(encoded_video_frame, frame_id)
            last_video_upload_ts = now_ts

    try:
        for path, img, im0s, vid_cap in dataset:
            frame_counter += 1
            loop_now = time.time()
            loop_dt = loop_now - last_loop_ts
            last_loop_ts = loop_now
            if loop_dt > 0:
                inst_fps = 1.0 / loop_dt
                fps_avg = inst_fps if fps_avg is None else (0.9 * fps_avg + 0.1 * inst_fps)
            else:
                inst_fps = None

            img = torch.from_numpy(img).to(device)
            img = img.half() if half else img.float()
            img /= 255.0
            if img.ndimension() == 3:
                img = img.unsqueeze(0)

            if device.type != 'cpu' and (old_img_b != img.shape[0] or old_img_h != img.shape[2] or old_img_w != img.shape[3]):
                old_img_b = img.shape[0]
                old_img_h = img.shape[2]
                old_img_w = img.shape[3]
                for _ in range(3):
                    model(img, augment=AUGMENT_INFERENCE)[0]

            with torch.no_grad():
                pred = model(img, augment=AUGMENT_INFERENCE)[0]

            pred = non_max_suppression(pred, opt.conf_thres, opt.iou_thres, classes=CLASS_FILTER, agnostic=AGNOSTIC_NMS)

            for i, det in enumerate(pred):
                if webcam:
                    p, s, im0, frame = path[i], f'{i}: ', im0s[i].copy(), dataset.count
                else:
                    p, s, im0, frame = path, '', im0s, getattr(dataset, 'frame', 0)

                p = Path(p)
                save_path = str(save_dir / p.name) if save_img else None
                txt_path, gn = (None, None)
                if save_txt:
                    txt_path = str(save_dir / 'labels' / p.stem) + ('' if dataset.mode == 'image' else f'_{frame}')
                    gn = torch.tensor(im0.shape)[[1, 0, 1, 0]]

                fire_events = [] if text_alert else None
                fire_detected = False
                fire_best_conf = 0.0
                fire_count = 0

                if len(det):
                    if save_txt or draw_boxes:
                        det[:, :4] = scale_coords(img.shape[2:], det[:, :4], im0.shape).round()

                    for c in det[:, -1].unique():
                        n = (det[:, -1] == c).sum()
                        s += f"{n} {names[int(c)]}{'s' * (n > 1)}, "

                    for *xyxy, conf, cls in reversed(det):
                        class_id = int(cls)
                        class_name = names[class_id]
                        if text_alert:
                            detected_labels.append({
                                'class_id': class_id,
                                'class_name': class_name,
                                'confidence': conf.item(),
                            })

                        is_fire = class_name.lower() == 'fire' and conf >= fire_conf
                        if is_fire:
                            fire_detected = True
                            fire_best_conf = max(fire_best_conf, float(conf))
                            fire_count += 1
                            if text_alert:
                                fire_events.append(f"{p.name}: fire {conf:.2f}")

                        if save_txt:
                            xywh = (xyxy2xywh(torch.tensor(xyxy).view(1, 4)) / gn).view(-1).tolist()
                            line = (cls, *xywh, conf) if SAVE_TXT_WITH_CONF else (cls, *xywh)
                            with open(txt_path + '.txt', 'a') as f:
                                f.write(('%g ' * len(line)).rstrip() % line + '\n')

                        if draw_boxes:
                            label_text = f'{class_name} {conf:.2f}'
                            plot_one_box(xyxy, im0, label=label_text, color=colors[class_id], line_thickness=1)

                now = time.time()
                stable_fire = debouncer.update(fire_detected, now)

                # 火情进入稳定告警态后，立即发 1
                if status_socket and stable_fire and debouncer.should_send(1, now, force=False):
                    status_socket.send_status(1, now=now)
                    debouncer.mark_sent(1, now)

                if text_alert and fire_count > 0:
                    if now - last_text_alert_ts >= TEXT_ALERT_MIN_INTERVAL:
                        last_text_alert_ts = now
                        prefix = f"{p.name}: fire count {fire_count}"
                        details = '; '.join(fire_events) if fire_events else ''
                        msg = prefix if not details else f"{prefix}; {details}"
                        print(msg)

                snapshot_events = []
                periodic_due = False
                if snapshot_enabled:
                    if fire_detected and (fire_best_conf >= fire_conf) and (now - last_fire_alert_ts >= FIRE_ALERT_MIN_INTERVAL):
                        last_fire_alert_ts = now
                        count_tag = f'count{fire_count}'
                        ts = time.strftime('%Y%m%d-%H%M%S', time.localtime())
                        fname = f'FIRE_{ts}_{count_tag}.jpg'
                        save_path_snap = os.path.join(SNAP_DIR, fname)
                        if save_snapshots_local and snapshot_saver:
                            snapshot_saver.submit(save_path_snap, im0)
                        snapshot_events.append({'type': 'fire', 'filename': fname, 'path': save_path_snap, 'fire_count': fire_count, 'tag': count_tag})

                    if not STARTUP_SHOT_DONE:
                        STARTUP_SHOT_DONE = True
                        ts = time.strftime('%Y%m%d-%H%M%S', time.localtime())
                        tag = 'FIRE_SEPARATE' if fire_detected else 'NOFIRE'
                        fname = f'BOOT_{ts}_{tag}.jpg'
                        save_path_snap = os.path.join(SNAP_DIR, fname)
                        if save_snapshots_local and snapshot_saver:
                            snapshot_saver.submit(save_path_snap, im0)
                        snapshot_events.append({'type': 'startup', 'filename': fname, 'path': save_path_snap, 'tag': tag, 'fire_count': fire_count})

                    if now - last_periodic_ts >= PERIODIC_INTERVAL_SEC:
                        periodic_due = True
                        last_periodic_ts = now
                        ts = time.strftime('%Y%m%d-%H%M%S', time.localtime())
                        tag = 'FIRE_SEPARATE' if fire_detected else 'NOFIRE'
                        fname = f'PERIODIC_{ts}_{tag}.jpg'
                        save_path_snap = os.path.join(SNAP_PERIODIC_DIR, fname)
                        if save_snapshots_local and snapshot_saver:
                            snapshot_saver.submit(save_path_snap, im0)
                        snapshot_events.append({'type': 'periodic', 'filename': fname, 'path': save_path_snap, 'tag': tag, 'fire_count': fire_count})
                else:
                    snapshot_events = []

                # 周期节点时：当前稳定状态是火，则发1；否则发0
                # 这样能满足“检测到火发1，周期截图未检测到发0”
                if status_socket and periodic_due:
                    periodic_status = 1 if stable_fire else 0
                    if debouncer.should_send(periodic_status, now, force=True):
                        status_socket.send_status(periodic_status, now=now)
                        debouncer.mark_sent(periodic_status, now)

                if http_client:
                    # Ordinary video frames are real-time preview only; env metadata is kept for snapshots/env JSON.
                    upload_video_frame_if_due(im0, frame_counter, now)

                if http_client and snapshot_events:
                    snapshot_frame = resize_for_upload(im0, opt.snapshot_upload_width)
                    encoded_snapshot_frame = http_client.encode_frame(snapshot_frame, quality=http_client.snapshot_quality)
                    if encoded_snapshot_frame:
                        for event in snapshot_events:
                            snapshot_seq += 1
                            event_type = event.get('type', 'snapshot')
                            meta = {
                                'filename': event.get('filename'),
                                'tag': event.get('tag'),
                                'fire_count': event.get('fire_count', 0),
                                'source': str(p),
                            }

                            # 只有 fire / periodic 截图携带环境元信息；startup 截图不携带
                            if event_type in ('fire', 'periodic') and env_reader:
                                env_meta = env_reader.get_meta()
                                if env_meta:
                                    meta.update(env_meta)

                            http_client.send_snapshot_bytes(encoded_snapshot_frame, event_type, snapshot_seq, extra_meta=meta)

                if view_img:
                    cv2.imshow(str(p), im0)
                    cv2.waitKey(1)

                if save_img:
                    if dataset.mode == 'image':
                        cv2.imwrite(save_path, im0)
                        print(f' The image with the result is saved in: {save_path}')
                    else:
                        if vid_path != save_path:
                            vid_path = save_path
                            if isinstance(vid_writer, cv2.VideoWriter):
                                vid_writer.release()
                            if vid_cap:
                                fps = vid_cap.get(cv2.CAP_PROP_FPS)
                                w = int(vid_cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                                h = int(vid_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                            else:
                                fps, w, h = 30, im0.shape[1], im0.shape[0]
                                save_path += '.mp4'
                            vid_writer = cv2.VideoWriter(save_path, cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))
                        vid_writer.write(im0)

    finally:
        if http_client:
            http_client.close()
        if status_socket:
            status_socket.close()
        if snapshot_saver:
            snapshot_saver.close()
        if env_uploader:
            env_uploader.close()

    if text_alert and detected_labels is not None:
        print(f'Detected Labels: {detected_labels}')
    if save_txt or save_img:
        s = f"\n{len(list(save_dir.glob('labels/*.txt')))} labels saved to {save_dir / 'labels'}" if save_txt else ''
        print(f'Results saved to {save_dir}{s}')

    print(f'Done. ({time.time() - t0:.3f}s)')
    if view_img:
        cv2.destroyAllWindows()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Fire detection with HTTP upload + status socket + env meta')
    parser.add_argument('--weights', nargs='+', type=str, default=r'weights/best.pt', help='model.pt path(s)')
    parser.add_argument('--source', type=str, default='0', help='input source (file/folder/rtsp/rtmp/0 for webcam)')
    parser.add_argument('--conf-thres', type=float, default=0.25, help='object confidence threshold')
    parser.add_argument('--iou-thres', type=float, default=0.45, help='IOU threshold for NMS')
    parser.add_argument('--device', default='0', help='cuda device, i.e. 0 or 0,1,2,3 or cpu')
    parser.add_argument('--no-trace', action='store_true', help='disable torch tracing for deployment')
    parser.add_argument('--small-img', action='store_true', help=f'use {SMALL_IMG_SIZE}px input size (default {IMG_SIZE_DEFAULT}px)')

    # HTTP 上传参数
    parser.add_argument('--video-upload-url', type=str, default=None, help='HTTP URL for boxed video frames')
    parser.add_argument('--snapshot-upload-url', type=str, default=None, help='HTTP URL for boxed snapshot images')
    parser.add_argument('--http-timeout', type=float, default=HTTP_UPLOAD_TARGET['timeout'], help='HTTP upload timeout in seconds')
    parser.add_argument('--http-retry-interval', type=float, default=HTTP_UPLOAD_TARGET['retry_interval'], help='retry interval after upload failure')
    parser.add_argument('--video-quality', type=int, default=HTTP_UPLOAD_TARGET['video_quality'], help='JPEG quality for video frames')
    parser.add_argument('--snapshot-quality', type=int, default=HTTP_UPLOAD_TARGET['snapshot_quality'], help='JPEG quality for snapshot images')
    parser.add_argument('--video-upload-fps', type=float, default=HTTP_UPLOAD_TARGET['video_fps'], help='max HTTP video frame upload fps, <=0 means every processed frame')
    parser.add_argument('--video-upload-width', type=int, default=HTTP_UPLOAD_TARGET['video_max_width'], help='max width for HTTP video preview frames, <=0 keeps original size')
    parser.add_argument('--snapshot-upload-width', type=int, default=HTTP_UPLOAD_TARGET['snapshot_max_width'], help='max width for HTTP snapshot frames, <=0 keeps original size')

    # 环境元信息参数
    parser.add_argument('--env-meta-path', type=str, default=None, help='path to env_latest.json produced by env_collector_py38.py')
    parser.add_argument('--env-meta-refresh-interval', type=float, default=ENV_META_SOURCE['refresh_interval'], help='minimum refresh interval for env meta file')
    parser.add_argument('--env-meta-max-age', type=float, default=ENV_META_SOURCE['max_age_seconds'], help='max age in seconds for env meta before skipping')
    parser.add_argument('--env-upload-url', type=str, default=None, help='HTTP URL for latest env json upload')
    parser.add_argument('--env-upload-interval', type=float, default=ENV_META_SOURCE['upload_interval'], help='poll interval for env latest upload')

    # 状态 socket 参数
    parser.add_argument('--status-socket-host', type=str, default=None, help='target board static IP for status socket')
    parser.add_argument('--status-socket-port', type=int, default=None, help='target board socket port')
    parser.add_argument('--status-socket-bind', type=str, default=STATUS_SOCKET_TARGET['bind'], help='local wired NIC IP to bind')
    parser.add_argument('--status-socket-timeout', type=float, default=STATUS_SOCKET_TARGET['timeout'], help='status socket connect timeout')
    parser.add_argument('--status-socket-retry-interval', type=float, default=STATUS_SOCKET_TARGET['retry_interval'], help='retry interval after status socket failure')

    # 防抖参数
    parser.add_argument('--status-activate-hits', type=int, default=STATUS_DEBOUNCE['activate_hits'], help='consecutive fire hits required to enter alarm state')
    parser.add_argument('--status-release-hits', type=int, default=STATUS_DEBOUNCE['release_hits'], help='consecutive no-fire hits required to leave alarm state')
    parser.add_argument('--status-hold-seconds', type=float, default=STATUS_DEBOUNCE['hold_seconds'], help='alarm hold seconds after last fire hit')
    parser.add_argument('--status-min-send-interval', type=float, default=STATUS_DEBOUNCE['min_send_interval'], help='minimum interval between two status sends')

    opt = parser.parse_args()

    opt.img_size = SMALL_IMG_SIZE if opt.small_img else IMG_SIZE_DEFAULT

    video_url = HTTP_UPLOAD_TARGET['video_url'] if opt.video_upload_url is None else opt.video_upload_url.strip()
    snapshot_url = HTTP_UPLOAD_TARGET['snapshot_url'] if opt.snapshot_upload_url is None else opt.snapshot_upload_url.strip()
    opt.video_upload_url = video_url
    opt.snapshot_upload_url = snapshot_url or video_url
    opt.video_quality = max(10, min(100, opt.video_quality))
    opt.snapshot_quality = max(10, min(100, opt.snapshot_quality))
    opt.video_upload_fps = max(0.0, float(opt.video_upload_fps))
    opt.video_upload_width = max(0, int(opt.video_upload_width))
    opt.snapshot_upload_width = max(0, int(opt.snapshot_upload_width))
    opt.http_timeout = max(0.5, float(opt.http_timeout))
    opt.http_retry_interval = max(0.05, float(opt.http_retry_interval))

    env_meta_path = ENV_META_SOURCE['path'] if opt.env_meta_path is None else opt.env_meta_path.strip()
    opt.env_meta_path = env_meta_path or ''
    opt.env_meta_refresh_interval = max(0.1, float(opt.env_meta_refresh_interval))
    opt.env_meta_max_age = max(0.0, float(opt.env_meta_max_age))

    env_upload_url = HTTP_UPLOAD_TARGET['snapshot_url'] if opt.env_upload_url is None else opt.env_upload_url.strip()
    opt.env_upload_url = env_upload_url or ''
    opt.env_upload_interval = max(0.1, float(opt.env_upload_interval))

    status_host = STATUS_SOCKET_TARGET['host'] if opt.status_socket_host is None else opt.status_socket_host.strip()
    opt.status_socket_host = status_host or ''
    status_port = STATUS_SOCKET_TARGET['port'] if opt.status_socket_port is None else opt.status_socket_port
    opt.status_socket_port = status_port if status_port and status_port > 0 else STATUS_SOCKET_TARGET['port']
    opt.status_socket_bind = (opt.status_socket_bind or '').strip()
    opt.status_socket_timeout = max(0.2, float(opt.status_socket_timeout))
    opt.status_socket_retry_interval = max(0.1, float(opt.status_socket_retry_interval))

    opt.status_activate_hits = max(1, int(opt.status_activate_hits))
    opt.status_release_hits = max(1, int(opt.status_release_hits))
    opt.status_hold_seconds = max(0.0, float(opt.status_hold_seconds))
    opt.status_min_send_interval = max(0.0, float(opt.status_min_send_interval))

    print(opt)

    with torch.no_grad():
        detect()
