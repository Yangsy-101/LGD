/**
 * ============================================================
 * 网关开发板 → 主机 MJPEG 视频流传输规范 & 接收器
 * ============================================================
 *
 * 场景:
 *   主机有线直连网关开发板（已 Ping 通），网关采集摄像头画面、
 *   编码为 JPEG、通过 HTTP MJPEG 流推送到主机。
 *   浏览器端接收流，渲染到 forest-fire.html 的 Canvas 上。
 *
 * 本文档:
 *   A 部分 — 网关端发送规范（给网关开发者）
 *   B 部分 — 浏览器端接收器（给前端开发者）
 *
 * 历史 FPS 问题说明:
 *   此前测试仅有个位数 FPS，原因如下:
 *     1. 读取流 → 解码 → 绘制 三者串行，解码期间 TCP 接收窗口停止滑动
 *     2. 无帧丢弃机制，解码慢于接收时帧排队积压
 *     3. 每帧 new Blob() + 重置 canvas.width 触发额外 GC
 *     4. 网关端 JPEG 分辨率/质量过高，单帧解码耗时过大
 *
 *   本版优化: 读写分离、帧丢弃、条件 Canvas 重置、直接传 ArrayBuffer
 * ============================================================
 */


// ############################################################
// #  A部分：网关开发板发送规范（给网关开发者）               #
// ############################################################

/*
 * ============================================================================
 * 一、协议: MJPEG over HTTP (multipart/x-mixed-replace)
 * ============================================================================
 *
 * 网关运行简易 HTTP Server，浏览器 fetch() 拉取 ReadableStream。
 * 这是嵌入式视频流最通用的方案，ESP32-CAM、mjpg-streamer 均使用此格式。
 *
 *
 * 1.1 HTTP 响应格式（网关必须严格遵循）
 * ---------------------------------------
 *
 * 请求（浏览器发起）:
 *   GET /stream HTTP/1.1
 *   Host: <网关IP>
 *
 * 响应（网关返回）:
 *
 *   HTTP/1.1 200 OK\r\n
 *   Content-Type: multipart/x-mixed-replace; boundary=--myboundary\r\n
 *   Cache-Control: no-cache, no-store, must-revalidate\r\n
 *   Pragma: no-cache\r\n
 *   Connection: close\r\n
 *   \r\n
 *   --myboundary\r\n
 *   Content-Type: image/jpeg\r\n
 *   Content-Length: 28471\r\n
 *   \r\n
 *   <JPEG 二进制数据，共 28471 字节>\r\n
 *   --myboundary\r\n
 *   Content-Type: image/jpeg\r\n
 *   Content-Length: 29133\r\n
 *   \r\n
 *   <JPEG 二进制数据，共 29133 字节>\r\n
 *   ...（持续发送更多帧）...
 *   --myboundary--\r\n          ← 终止标记，仅流结束时发送
 *
 * 关键要求:
 *   ✓ 响应头 Content-Type 中 boundary 必须与 body 中使用的分隔符完全一致
 *   ✓ 每个 part 必须包含 Content-Length 头
 *   ✓ Content-Length 的值必须等于后面 JPEG 数据的实际字节数
 *   ✓ 每帧 JPEG 数据后必须跟 \r\n
 *   ✓ 不要使用 Transfer-Encoding: chunked
 *   ✓ 每发送完一个 part 后立即 flush socket（禁用 Nagle 算法）
 *
 *
 * 1.2 JPEG 编码参数建议
 * ----------------------
 *
 *   ┌──────────────┬──────────┬───────────┬──────────┬──────────────┐
 *   │              │ 保守配置  │ 推荐配置   │ 较清晰   │ 注释          │
 *   ├──────────────┼──────────┼───────────┼──────────┼──────────────┤
 *   │ 分辨率        │ 640×480  │ 800×600   │ 1280×720 │ 不要用1080p   │
 *   │ JPEG Quality  │ 50       │ 65        │ 75       │ 不要超过80    │
 *   │ 单帧大小(约)   │ 15-30KB  │ 30-60KB   │ 60-120KB │              │
 *   │ 解码耗时(约)   │ 3-8ms    │ 5-15ms    │ 10-25ms  │ 浏览器端测量   │
 *   │ 理论FPS上限    │ 120+     │ 60+       │ 40+      │ 1s / 解码耗时  │
 *   └──────────────┴──────────┴───────────┴──────────┴──────────────┘
 *
 *   建议从 800×600, Quality=65, 20fps 起步。
 *   FPS 不够时优先降分辨率而非提 Quality。
 *   局域网百兆有线带宽完全不是瓶颈——瓶颈在浏览器 JPEG 解码。
 *
 *
 * 1.3 网关发送伪代码
 * ------------------
 *
 *   // 初始化
 *   camera_init(800, 600);          // 分辨率
 *   jpeg_quality = 65;
 *   target_fps = 20;
 *   frame_interval_ms = 1000 / target_fps;   // 50ms
 *
 *   // 发送 HTTP 响应头（仅一次）
 *   http_send("HTTP/1.1 200 OK\r\n");
 *   http_send("Content-Type: multipart/x-mixed-replace; boundary=--myboundary\r\n");
 *   http_send("Cache-Control: no-cache, no-store, must-revalidate\r\n");
 *   http_send("Connection: close\r\n");
 *   http_send("\r\n");
 *
 *   // 持续发送帧
 *   while (stream_active) {
 *       frame_start = now();
 *
 *       raw = camera_capture();                 // 采集一帧 YUV/RGB
 *       if (!raw) continue;                     // 采集失败则跳过
 *
 *       jpeg = jpeg_encode(raw, jpeg_quality);  // 编码为 JPEG
 *       if (!jpeg || jpeg_len == 0) continue;
 *
 *       // 发送一个 multipart part
 *       http_send("\r\n--myboundary\r\n");
 *       http_send("Content-Type: image/jpeg\r\n");
 *       http_printf("Content-Length: %d\r\n", jpeg_len);
 *       http_send("\r\n");
 *       http_send(jpeg_data, jpeg_len);
 *       http_flush();                           // ★ 立即 flush!
 *
 *       // 维持均匀帧间隔
 *       elapsed = now() - frame_start;
 *       if (elapsed < frame_interval_ms) {
 *           sleep(frame_interval_ms - elapsed);
 *       }
 *   }
 *
 *   // 结束流
 *   http_send("\r\n--myboundary--\r\n");
 *
 *
 * 1.4 ★ 务必禁用 Nagle 算法 ★
 * -----------------------------
 *
 *   这是 FPS 上不去的最常见原因之一。Nagle 算法会合并小数据包，
 *   导致帧被延迟发送。必须在对 socket 设置 TCP_NODELAY:
 *
 *   Linux/ESP-IDF:
 *     int flag = 1;
 *     setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));
 *
 *   如果使用 lwIP:
 *     tcp_nagle_disable(pcb);
 *
 *   未禁用 Nagle: 30KB 帧可能被延迟 40-200ms → 仅 5fps
 *   已禁用 Nagle:  30KB 帧即刻发出 → 60fps+
 *
 *
 * 1.5 连通性验证
 * --------------
 *
 *   网关开发者可在主机浏览器控制台执行以下命令自测:
 *
 *   // 查看 Content-Type（判断格式是否正确）
 *   fetch('http://<网关IP>/stream')
 *     .then(r => {
 *       console.log('Status:', r.status);                      // 预期 200
 *       console.log('Content-Type:', r.headers.get('Content-Type'));
 *       // 预期: "multipart/x-mixed-replace; boundary=--myboundary"
 *     });
 *
 *   // 抓几秒数据，统计收到多少帧
 *   (async () => {
 *     const r = await fetch('http://<网关IP>/stream');
 *     const reader = r.body.getReader();
 *     let buffer = new Uint8Array(0);
 *     const start = Date.now();
 *     while (Date.now() - start < 3000) {
 *       const { done, value } = await reader.read();
 *       if (done) break;
 *       if (value) {
 *         const tmp = new Uint8Array(buffer.length + value.length);
 *         tmp.set(buffer); tmp.set(value, buffer.length);
 *         buffer = tmp;
 *       }
 *     }
 *     reader.cancel();
 *     // 统计 boundary 出现次数
 *     const b = new TextEncoder().encode('--myboundary');
 *     let count = -1; // 第一个 boundary 不计
 *     for (let i = 0; i <= buffer.length - b.length; i++) {
 *       let match = true;
 *       for (let j = 0; j < b.length; j++) {
 *         if (buffer[i+j] !== b[j]) { match = false; break; }
 *       }
 *       if (match) { count++; i += b.length; }
 *     }
 *     console.log(`3秒内收到约 ${count} 帧, FPS≈${(count/3).toFixed(0)}`);
 *   })();
 */


// ############################################################
// #  B部分：浏览器端 MJPEG 接收器（给前端开发者）            #
// ############################################################

/**
 * 火灾应急检测 — 网关配置（端口 10002）
 */
const FIRE_CONFIG = {
    host: '192.168.0.233',
    port: 10002,
    streamPath: '/stream',
    canvasId: 'yjy-fire-canvas',
    placeholderId: 'yjy-fire-video-placeholder',

    frameTimeoutMs: 5000,
    maxJpegSizeBytes: 200 * 1024,
    maxRetries: 20,
    retryBaseDelayMs: 500,
    retryMaxDelayMs: 10000,
};

/**
 * 应急救援画面 — 网关配置（端口 10003）
 */
const OVERVIEW_CONFIG = {
    host: '192.168.0.233',
    port: 10003,
    streamPath: '/stream',
    canvasId: 'yjy-overview-canvas',
    placeholderId: 'yjy-overview-video-placeholder',

    frameTimeoutMs: 5000,
    maxJpegSizeBytes: 200 * 1024,
    maxRetries: 20,
    retryBaseDelayMs: 500,
    retryMaxDelayMs: 10000,
};


/**
 * MJPEG 接收器（优化版）
 *
 * 架构核心: 读写分离 + 帧丢弃
 *
 *   Read Loop               Decode Loop
 *   ─────────               ───────────
 *   reader.read() ─┐        取 latestFrameData ─┐
 *   拼接 buffer    │        清空 latestFrameData │
 *   按 boundary    │        解码为 bitmap        │  ← createImageBitmap
 *     切出 JPEG ───┼─ 写入 →                     │    浏览器内部离主线程解码
 *   reader.read() ─┘        │                    │
 *                            │   解码完成检查:     │
 *                   latestFrameData              │
 *                   (共享变量，只保留最新一帧)     │
 *                                                 │
 *   ★ 关键: 读循环不等解码，createImageBitmap      │
 *           离主线程执行，真正并行                  │
 *                                                 │
 *                            bitmap.drawImage() ──┘
 *                            → 帧序号旧于最新则丢弃
 *                            → 否则绘制到 Canvas
 */
class MjpegReceiver {
    constructor(config) {
        this.cfg = config;
        this.url = `http://${config.host}:${config.port}${config.streamPath}`;
        this.canvas = document.getElementById(config.canvasId);
        this.placeholder = document.getElementById(config.placeholderId);
        this.container = this.canvas ? this.canvas.parentElement : null;
        this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false }) : null;

        this.running = false;
        this.abortController = null;

        this.stats = {
            received: 0, decoded: 0, dropped: 0, oversized: 0,
            avgDecodeMs: 0, fps: 0, _decodeTotalMs: 0, _startTime: 0,
        };

        this._cw = 0;  this._ch = 0;
        this._retry = 0;
        this._retryTimer = null;

        // ★ ResizeObserver 替代每帧 getBoundingClientRect（避免强制回流）
        if (this.container && typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this._syncCanvasSize());
            this._ro.observe(this.container);
        }
    }

    // ==================== 公开 API ====================

    async start() {
        if (this.running) return;
        this.running = true;
        this._resetStats();
        this._hideCanvas();
        await this._connect();
    }

    stop() {
        this.running = false;
        this._clearRetry();
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._hideCanvas();
        console.log(
            `[MJPEG] 停止 | 收到:${this.stats.received} ` +
            `解码:${this.stats.decoded} 丢弃:${this.stats.dropped} ` +
            `FPS≈${this.stats.fps} 解码≈${this.stats.avgDecodeMs}ms`
        );
    }

    // ==================== 连接 ====================

    async _connect() {
        if (!this.running) return;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        console.log(`[MJPEG] 连接 ${this.url}`);
        try {
            const resp = await fetch(this.url, { cache: 'no-store', signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const ct = resp.headers.get('Content-Type') || '';
            if (!ct.includes('multipart/x-mixed-replace')) {
                throw new Error(`Content-Type 不是 multipart/x-mixed-replace: ${ct}`);
            }
            const boundaryStr = MjpegReceiver._parseBoundary(ct);
            if (!boundaryStr) throw new Error('无法解析 boundary');
            await this._processStream(resp, signal, boundaryStr);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[MJPEG] 连接失败:', err.message);
            this._scheduleRetry();
        }
    }

    _scheduleRetry() {
        if (!this.running) return;
        if (this._retry >= this.cfg.maxRetries) {
            console.error('[MJPEG] 重连次数用尽');
            this.stop(); return;
        }
        const delay = Math.min(
            this.cfg.retryBaseDelayMs * Math.pow(2, this._retry),
            this.cfg.retryMaxDelayMs
        );
        this._retry++;
        console.log(`[MJPEG] ${delay}ms 后第${this._retry}次重连`);
        this._retryTimer = setTimeout(() => this._connect(), delay);
    }

    _clearRetry() {
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    }

    // ==================== 流处理核心 ====================

    async _processStream(response, signal, boundaryStr) {
        const rawBoundary = boundaryStr.replace(/^--/, '');
        const boundary = '--' + rawBoundary;
        const boundaryBytes = new TextEncoder().encode(boundary);
        const boundaryEndBytes = new TextEncoder().encode(boundary + '--');
        const BLEN = boundaryBytes.length;

        console.log(`[MJPEG] boundary="${boundary}", 开始接收`);
        this._retry = 0;

        const reader = response.body.getReader();
        const MAX = this.cfg.maxJpegSizeBytes;

        // 共享变量
        let latestFrame = null;
        let latestSeq = 0;
        let decodeWake = null;

        let timeoutId = null;
        const resetTimeout = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                console.warn('[MJPEG] 帧超时，判定断流');
                reader.cancel();
                this.abortController.abort();
                this._scheduleRetry();
            }, this.cfg.frameTimeoutMs);
        };

        // ========== Read Loop（自增长 buffer，零 GC） ==========
        const readLoop = (async () => {
            // 自增长 buffer，避免每收到分片就 new Uint8Array
            let buf = new Uint8Array(MAX * 2);  // 初始 400KB
            let len = 0;  // 有效数据长度

            const ensure = (need) => {
                if (len + need > buf.length) {
                    const bigger = new Uint8Array(Math.max(len + need, buf.length * 2));
                    bigger.set(buf.subarray(0, len));
                    buf = bigger;
                }
            };

            try {
                while (this.running && !signal.aborted) {
                    const { done, value } = await reader.read();
                    if (done) { console.log('[MJPEG] 流结束'); break; }

                    ensure(value.length);
                    buf.set(value, len);
                    len += value.length;

                    // 循环提取完整帧
                    while (true) {
                        const idx = MjpegReceiver._indexOfBuf(buf, len, boundaryBytes);
                        if (idx === -1) break;

                        if (idx > 0) {
                            const jpeg = MjpegReceiver._extractJpegFast(buf, idx);
                            if (jpeg && jpeg.length > 100 && jpeg.length <= MAX) {
                                latestSeq++;
                                // ★ 零拷贝：subarray 只是视图，buffer.slice 才复制
                                latestFrame = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length);
                                this.stats.received++;
                                resetTimeout();
                                if (decodeWake) { const w = decodeWake; decodeWake = null; w(); }
                            } else if (jpeg && jpeg.length > MAX) {
                                this.stats.oversized++;
                            }
                        }

                        let skip = idx + BLEN;
                        if (idx + boundaryEndBytes.length <= len && MjpegReceiver._startsWith(buf, boundaryEndBytes, idx)) {
                            console.log('[MJPEG] 终止标记');
                            len = 0;
                            return;
                        }
                        if (skip < len && buf[skip] === 0x0D) skip++;
                        if (skip < len && buf[skip] === 0x0A) skip++;

                        // ★ 挪动剩余数据到 buf 头部，避免分配
                        const remain = len - skip;
                        if (remain > 0) buf.copyWithin(0, skip, len);
                        len = remain;
                    }

                    if (len > MAX * 3) {
                        console.warn('[MJPEG] buffer 异常，重置');
                        len = 0;
                    }
                }
            } catch (e) {
                if (e.name !== 'AbortError') throw e;
            } finally {
                reader.releaseLock();
                if (timeoutId) clearTimeout(timeoutId);
                if (decodeWake) { const w = decodeWake; decodeWake = null; w(); }
            }
        })();

        // ========== Decode Loop（事件驱动） ==========
        const decodeLoop = (async () => {
            let lastDecodedSeq = 0;

            while (this.running) {
                if (!latestFrame || latestSeq === lastDecodedSeq) {
                    await new Promise(r => { decodeWake = r; });
                    if (!this.running) break;
                    continue;
                }

                const frameData = latestFrame;
                const seq = latestSeq;
                latestFrame = null;
                lastDecodedSeq = seq;

                const t0 = performance.now();
                try {
                    const blob = new Blob([frameData], { type: 'image/jpeg' });
                    const bitmap = await createImageBitmap(blob);

                    if (latestFrame && latestSeq > seq) {
                        bitmap.close();
                        this.stats.dropped++;
                        continue;
                    }
                    if (!this.running) { bitmap.close(); break; }

                    if (this._cw === 0 || !this._ro) this._syncCanvasSize();

                    // ★ 首帧打印分辨率 + 单帧大小（诊断用）
                    if (this.stats.decoded === 0) {
                        console.log(
                            `[MJPEG] 首帧分辨率: ${bitmap.width}×${bitmap.height}, ` +
                            `JPEG大小: ${(frameData.byteLength / 1024).toFixed(1)}KB, ` +
                            `解码耗时: ${(performance.now() - t0).toFixed(1)}ms`
                        );
                    }

                    const scale = Math.min(this._cw / bitmap.width, this._ch / bitmap.height);
                    const dw = Math.round(bitmap.width * scale);
                    const dh = Math.round(bitmap.height * scale);
                    const dx = Math.round((this._cw - dw) / 2);
                    const dy = Math.round((this._ch - dh) / 2);
                    this.ctx.drawImage(bitmap, dx, dy, dw, dh);
                    bitmap.close();
                    this._showCanvas();

                    this.stats.decoded++;
                    this.stats._decodeTotalMs += performance.now() - t0;
                    this.stats.avgDecodeMs = Math.round(
                        this.stats._decodeTotalMs / this.stats.decoded
                    );
                    this.stats.fps = this.stats.avgDecodeMs > 0
                        ? Math.round(1000 / this.stats.avgDecodeMs)
                        : 0;
                } catch (e) {
                    console.warn('[MJPEG] 解码失败:', e.message);
                }
            }
        })();

        await Promise.all([readLoop, decodeLoop]);

        if (this.running && !signal.aborted) {
            this._scheduleRetry();
        }
    }


    // ==================== Canvas 显隐 & 尺寸 ====================

    _syncCanvasSize() {
        if (!this.container || !this.canvas) return;
        const rect = this.container.getBoundingClientRect();
        const w = Math.floor(rect.width) || 640;
        const h = Math.floor(rect.height) || 480;
        if (w !== this._cw || h !== this._ch) {
            this.canvas.width = w;
            this.canvas.height = h;
            this._cw = w;
            this._ch = h;
            this.ctx = this.canvas.getContext('2d', { alpha: false });
        }
    }

    _showCanvas() {
        if (this.canvas && this.canvas.style.display !== 'block') {
            this.canvas.style.display = 'block';
        }
        if (this.placeholder && this.placeholder.style.display !== 'none') {
            this.placeholder.style.display = 'none';
        }
    }

    _hideCanvas() {
        if (this.canvas) this.canvas.style.display = 'none';
        if (this.placeholder) this.placeholder.style.display = 'flex';
    }

    // ==================== 统计 ====================

    _resetStats() {
        this.stats = {
            received: 0, decoded: 0, dropped: 0, oversized: 0,
            avgDecodeMs: 0, fps: 0, _decodeTotalMs: 0, _startTime: Date.now(),
        };
    }

    // ==================== 静态工具 ====================

    static _parseBoundary(contentType) {
        const m = contentType.match(/boundary=("?)([^";]+)\1/);
        return m ? m[2] : null;
    }

    /** 在有效数据范围 [0, len) 内搜索 needle（不分配新数组） */
    static _indexOfBuf(haystack, len, needle) {
        const n = needle;
        outer:
        for (let i = 0; i <= len - n.length; i++) {
            for (let j = 0; j < n.length; j++) {
                if (haystack[i + j] !== n[j]) continue outer;
            }
            return i;
        }
        return -1;
    }

    /** 与 _indexOfBuf 相同，用于兼容（分配版 fallback） */
    static _indexOf(haystack, needle) {
        const h = haystack, n = needle;
        outer:
        for (let i = 0; i <= h.length - n.length; i++) {
            for (let j = 0; j < n.length; j++) {
                if (h[i + j] !== n[j]) continue outer;
            }
            return i;
        }
        return -1;
    }

    static _concat(a, b) {
        const c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c;
    }

    static _startsWith(haystack, prefix, offset) {
        if (offset + prefix.length > haystack.length) return false;
        for (let i = 0; i < prefix.length; i++) {
            if (haystack[offset + i] !== prefix[i]) return false;
        }
        return true;
    }

    /**
     * 从 multipart part 中提取 JPEG 二进制（优化版：无 TextDecoder、无 regex）
     *
     * @param {Uint8Array} buf - 缓冲区
     * @param {number}     partEnd - part 结束位置（即 boundary 起始位置）
     * @returns {Uint8Array|null} JPEG 数据的 subarray 视图
     */
    static _extractJpegFast(buf, partEnd) {
        if (partEnd < 4) return null;

        // 找 \r\n\r\n（header/body 分隔）
        let bodyStart = -1;
        for (let i = 0; i < partEnd - 3; i++) {
            if (buf[i] === 0x0D && buf[i+1] === 0x0A &&
                buf[i+2] === 0x0D && buf[i+3] === 0x0A) {
                bodyStart = i + 4;
                break;
            }
        }
        if (bodyStart === -1) {
            for (let i = 0; i < partEnd - 1; i++) {
                if (buf[i] === 0x0A && buf[i+1] === 0x0A) {
                    bodyStart = i + 2;
                    break;
                }
            }
        }
        if (bodyStart === -1 || bodyStart >= partEnd) return null;

        // ★ 从字节中直接解析 Content-Length（无 TextDecoder、无 regex）
        const CL = [0x43, 0x6F, 0x6E, 0x74, 0x65, 0x6E, 0x74, 0x2D,
                     0x4C, 0x65, 0x6E, 0x67, 0x74, 0x68, 0x3A];  // "Content-Length:"
        let clIdx = -1;
        const searchEnd = Math.min(bodyStart, partEnd - CL.length);
        for (let i = 0; i <= searchEnd; i++) {
            let match = true;
            for (let j = 0; j < CL.length; j++) {
                if (buf[i + j] !== CL[j]) { match = false; break; }
            }
            if (match) { clIdx = i + CL.length; break; }
        }

        if (clIdx >= 0) {
            // 跳过空格
            while (clIdx < bodyStart && buf[clIdx] === 0x20) clIdx++;
            // 解析数字
            let num = 0;
            while (clIdx < bodyStart && buf[clIdx] >= 0x30 && buf[clIdx] <= 0x39) {
                num = num * 10 + (buf[clIdx] - 0x30);
                clIdx++;
            }
            if (num > 0) {
                const actual = Math.min(num, partEnd - bodyStart);
                return buf.subarray(bodyStart, bodyStart + actual);
            }
        }

        return buf.subarray(bodyStart, partEnd);
    }

    /** 兼容旧版：_extractJpeg（含 TextDecoder fallback） */
    static _extractJpeg(part) {
        if (part.length < 4) return null;
        let bodyStart = -1;
        for (let i = 0; i < part.length - 3; i++) {
            if (part[i] === 0x0D && part[i+1] === 0x0A &&
                part[i+2] === 0x0D && part[i+3] === 0x0A) {
                bodyStart = i + 4;
                break;
            }
        }
        if (bodyStart === -1) {
            for (let i = 0; i < part.length - 1; i++) {
                if (part[i] === 0x0A && part[i+1] === 0x0A) {
                    bodyStart = i + 2;
                    break;
                }
            }
        }
        if (bodyStart === -1 || bodyStart >= part.length) return null;
        const headerText = new TextDecoder().decode(part.subarray(0, bodyStart));
        const cl = headerText.match(/Content-Length:\s*(\d+)/i);
        if (cl) {
            const declared = parseInt(cl[1], 10);
            const actual = Math.min(declared, part.length - bodyStart);
            return part.subarray(bodyStart, bodyStart + actual);
        }
        return part.subarray(bodyStart);
    }

    static _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}


// ============================================================
// 集成说明
// ============================================================
//
// 本文件由 yingjijiuyuan2.html 引入（相对路径 ../../../newjs/newjs3.js）
// yingjijiuyuan2.html 中通过内联脚本控制双路视频。
//
// 使用:
//   FIRE_CONFIG    → 火灾应急检测 (端口 10002)
//   OVERVIEW_CONFIG → 应急救援画面 (端口 10003)
//   浏览器打开 yingjijiuyuan2.html
//   点击"开始火灾检测"/"开启工厂全局画面"开始接收
