#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simple wired receiver demo.
- POST /alarm with JSON body.
- Prints raw JSON and returns ok.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


class DemoHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _send_json(self, status_code: int, obj):
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/alarm":
            self._send_json(404, {"ok": False, "error": "use POST /alarm"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                raise ValueError("invalid JSON body length")
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})
            return

        print("[{}] RX RAW: {}".format(now_str(), raw.decode("utf-8", errors="replace")))
        print("[{}] RX OBJ: {}".format(now_str(), payload))
        self._send_json(200, {"ok": True})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 9000), DemoHandler)
    print("wired demo listening: http://<ip>:9000/alarm")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
