const SheBeiGuanKongScene = {
    display: {
        timer: null,
        pointer: 0,
        buffer: [],
        running: false,
        latestSnapshot: null,
        snapshotRecords: [],
        passLogTimer: null,
        passLogRunning: false,
        passLogSeenKeys: new Set(),
        passLogToastKeys: new Set(),
        passLogSeedPromise: null,
        passAlertQueue: [],
        passAlertActive: false,
        pendingFacePassTimer: null,
        pendingFacePassEvent: null,
        pendingFacePassToastKey: '',
        recentDeviceLinkedAt: 0,
        perimeterImageTimer: null,
        perimeterImageUrl: '',
        perimeterImageMTime: 0,
        perimeterImageObjectUrl: null,
        perimeterWarningKeys: new Set()
    },

    perimeter: {
        ws: {
            url: `ws://${window.location.hostname || '127.0.0.1'}:6010`,
            socket: null,
            running: false,
            reconnectTimer: null
        }
    },

    ws: {
        streamUrl: '',
        socket: null,
        running: false,
        reconnectTimer: null,
        frameTimer: null,
        lastObjectUrl: null,
        lastBlob: null,
        reusableImage: null,  // 复用Image对象
        pendingUrls: new Set(),  // 跟踪待清理的URL
        latestFrameBuffer: null,
        renderScheduled: false,
        renderInProgress: false,
        frameBitmap: null
    },

    data: {
        warnings: [],
        persons: [],
        devices: [],
        passLogs: [],
        passLogUrl: '',
        perimeterImageUrl: ''
    },

    els: {
        warningList: null,
        personDb: null,
        deviceDb: null,
        passLog: null,
        alertStack: null,
        shotImage: null,
        shotPlaceholder: null,
        shotShowBtn: null,
        shotStopBtn: null,
        video: {
            file: null,
            selectBtn: null,
            player: null,
            wsFrame: null,
            placeholder: null,
            startBtn: null,
            stopBtn: null,
            objectUrl: null
        }
    },

    init() {
        console.log('[PassLog] init called');
        this.els.warningList = document.getElementById('sbg-warning-list');
        this.els.personDb = document.getElementById('sbg-person-db-scroll');
        this.els.deviceDb = document.getElementById('sbg-device-db-scroll');
        this.els.passLog = document.getElementById('sbg-pass-log');
        this.els.alertStack = this.ensureAlertStack();
        this.els.shotImage = document.getElementById('sbg-shot-image');
        this.els.shotPlaceholder = document.getElementById('sbg-shot-placeholder');
        this.els.shotShowBtn = document.getElementById('sbg-shot-btn-show');
        this.els.shotStopBtn = document.getElementById('sbg-shot-btn-stop');

        this.els.video.file = document.getElementById('sbg-device-video-file');
        this.els.video.selectBtn = document.getElementById('sbg-device-video-select');
        this.els.video.player = document.getElementById('sbg-device-video-player');
        this.els.video.wsFrame = document.getElementById('sbg-device-ws-frame');
        this.els.video.placeholder = document.getElementById('sbg-device-video-placeholder');
        this.els.video.stage = document.querySelector('#sbg-device-video .sbg-video-stage');
        this.els.video.startBtn = document.getElementById('sbg-device-btn-start');
        this.els.video.stopBtn = document.getElementById('sbg-device-btn-stop');

        const deviceVideoContainer = document.getElementById('sbg-device-video');
        const pageStreamUrl = deviceVideoContainer?.dataset?.streamUrl;
        if (pageStreamUrl) this.ws.streamUrl = pageStreamUrl;

        const passPanel = document.querySelector('.sbg-pass-panel');
        const pageLogUrl = passPanel?.dataset?.logUrl;
        console.log('[PassLog] init: passPanel=', passPanel, 'pageLogUrl=', pageLogUrl, 'data-log-url attr=', passPanel?.getAttribute('data-log-url'));
        if (pageLogUrl) this.data.passLogUrl = pageLogUrl;

        this.bindDeviceWsPanel();
        this.initMockData();
        this.bindShotActions();
        this.renderStaticPanels();
        this.renderWarningPlaceholder();
        this.renderPassLogPlaceholder();
    },

    bindShotActions() {
        if (this.els.shotShowBtn) {
            this.els.shotShowBtn.addEventListener('click', () => {
                this.startPerimeterDisplay();
                this.startWarningDisplay();
                this.startPassLogPolling();
            });
        }

        if (this.els.shotStopBtn) {
            this.els.shotStopBtn.addEventListener('click', () => {
                this.stopPerimeterDisplay();
                this.stopWarningDisplay();
                this.stopPassLogPolling();
            });
        }
    },

    bindDeviceWsPanel() {
        const t = this.els.video;
        if (!t?.file || !t?.selectBtn || !t?.player || !t?.placeholder) return;

        const showPlaceholder = () => {
            t.placeholder.style.display = 'flex';
        };

        const hidePlaceholder = () => {
            t.placeholder.style.display = 'none';
        };

        showPlaceholder();

        t.selectBtn.addEventListener('click', () => {
            t.file.click();
        });

        t.file.addEventListener('change', () => {
            const file = t.file.files?.[0];
            if (!file) {
                this.clearLocalVideo();
                if (!this.ws.running) showPlaceholder();
                return;
            }

            this.stopDeviceWsStream();
            this.setLocalVideoFile(file);
            hidePlaceholder();
        });

        t.player.addEventListener('loadedmetadata', () => {
            if (t.player.currentSrc) hidePlaceholder();
        });

        t.player.addEventListener('error', () => {
            if (!this.ws.running) showPlaceholder();
        });

        if (t.startBtn) {
            t.startBtn.addEventListener('click', () => {
                this.startDeviceWsStream();
            });
        }

        if (t.stopBtn) {
            t.stopBtn.addEventListener('click', () => {
                this.stopDeviceWsStream();
                if (!t.player.currentSrc) showPlaceholder();
            });
        }
    },

    startDeviceWsStream() {
        const t = this.els.video;
        if (!t?.wsFrame || !t?.placeholder) return;
        if (this.ws.running) return;

        this.ws.running = true;
        this.clearLocalVideo();
        this.pauseVideo();
        if (t.player) {
            t.player.style.display = 'none';
            t.player.controls = false;
        }

        if (t.stage) t.stage.classList.add('sbg-live');

        t.wsFrame.style.display = 'block';
        t.placeholder.style.display = 'none';
        this.connectDeviceWs();
    },

    stopDeviceWsStream() {
        this.ws.running = false;
        if (this.ws.frameTimer) {
            window.clearTimeout(this.ws.frameTimer);
            this.ws.frameTimer = null;
        }
        if (this.ws.reconnectTimer) {
            window.clearTimeout(this.ws.reconnectTimer);
            this.ws.reconnectTimer = null;
        }

        if (this.ws.socket) {
            try {
                this.ws.socket.close();
            } catch (_) {}
            this.ws.socket = null;
        }

        this.ws.lastBlob = null;
        if (this.ws.lastObjectUrl) {
            URL.revokeObjectURL(this.ws.lastObjectUrl);
            this.ws.lastObjectUrl = null;
        }
        
        // 清理复用的Image对象
        if (this.ws.reusableImage) {
            this.ws.reusableImage.onload = null;
            this.ws.reusableImage.onerror = null;
            this.ws.reusableImage = null;
        }
        
        // 清理所有待处理的URL
        this.ws.pendingUrls.forEach(url => {
            try {
                URL.revokeObjectURL(url);
            } catch (_) {}
        });
        this.ws.pendingUrls.clear();
        this.ws.latestFrameBuffer = null;
        this.ws.renderScheduled = false;
        this.ws.renderInProgress = false;
        if (this.ws.frameBitmap && typeof this.ws.frameBitmap.close === 'function') {
            try {
                this.ws.frameBitmap.close();
            } catch (_) {}
        }
        this.ws.frameBitmap = null;

        const t = this.els.video;
        if (t?.wsFrame) {
            const canvas = t.wsFrame;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.style.display = 'none';
        }

        if (t?.player) {
            t.player.style.display = 'block';
            t.player.controls = true;
        }

        if (t?.stage) {
            t.stage.classList.remove('sbg-live');
        }
    },

    connectDeviceWs() {
        if (!this.ws.running) return;
        if (!this.ws.streamUrl) return;

        const frameUrl = `${this.ws.streamUrl}?t=${Date.now()}`;
        fetch(frameUrl)
            .then((resp) => {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.blob();
            })
            .then((blob) => {
                if (!this.ws.running) return;
                this.ws.lastBlob = blob;
                this.ws.latestFrameBuffer = blob;
                this.scheduleDeviceWsRender();
                this.ws.frameTimer = window.setTimeout(() => {
                    this.connectDeviceWs();
                }, 30);
            })
            .catch(() => {
                if (!this.ws.running) return;
                this.ws.frameTimer = window.setTimeout(() => {
                    this.connectDeviceWs();
                }, 200);
            });
    },

    scheduleDeviceWsRender() {
        if (!this.ws.running || this.ws.renderScheduled) return;
        this.ws.renderScheduled = true;
        requestAnimationFrame(() => {
            this.ws.renderScheduled = false;
            this.renderDeviceWsFrame();
        });
    },

    async renderDeviceWsFrame() {
        if (!this.ws.running || this.ws.renderInProgress) return;
        if (!this.ws.latestFrameBuffer) return;

        const t = this.els.video;
        if (!t?.wsFrame) return;

        this.ws.renderInProgress = true;
        const frameData = this.ws.latestFrameBuffer;
        this.ws.latestFrameBuffer = null;

        try {
            const frameBlob = frameData instanceof Blob
                ? frameData
                : new Blob([frameData], { type: 'image/jpeg' });

            const canvas = t.wsFrame;
            const ctx = canvas.getContext('2d');

            if (typeof createImageBitmap === 'function') {
                const bitmap = await createImageBitmap(frameBlob);
                if (!this.ws.running) {
                    if (typeof bitmap.close === 'function') bitmap.close();
                    return;
                }

                if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(bitmap, 0, 0);
                if (typeof bitmap.close === 'function') bitmap.close();
            } else {
                if (!this.ws.reusableImage) {
                    this.ws.reusableImage = new Image();
                }

                const img = this.ws.reusableImage;
                const url = URL.createObjectURL(frameBlob);
                this.ws.pendingUrls.add(url);

                await new Promise((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = reject;
                    img.src = url;
                });

                this.ws.pendingUrls.delete(url);
                URL.revokeObjectURL(url);

                if (!this.ws.running) return;

                if (canvas.width !== img.width || canvas.height !== img.height) {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
            }

            canvas.style.display = 'block';
            t.placeholder.style.display = 'none';
        } catch (_) {
        } finally {
            this.ws.renderInProgress = false;
            if (this.ws.latestFrameBuffer) {
                this.scheduleDeviceWsRender();
            }
        }
    },

    scheduleDeviceWsReconnect() {
        if (!this.ws.running) return;
        if (this.ws.reconnectTimer) return;
        this.ws.reconnectTimer = window.setTimeout(() => {
            this.ws.reconnectTimer = null;
            this.connectDeviceWs();
        }, 1000);
    },

    setLocalVideoFile(file) {
        const t = this.els.video;
        if (!t?.player) return;

        this.clearLocalVideo();
        const url = URL.createObjectURL(file);
        t.objectUrl = url;
        t.player.src = url;
        t.player.load();

        const playPromise = t.player.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }
    },

    clearLocalVideo() {
        const t = this.els.video;
        if (!t?.player) return;

        if (t.objectUrl) {
            URL.revokeObjectURL(t.objectUrl);
            t.objectUrl = null;
        }

        t.player.removeAttribute('src');
        t.player.load();
    },

    playVideo() {
        const t = this.els.video;
        if (!t?.player || !t.player.src) return;
        const p = t.player.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    },

    pauseVideo() {
        const t = this.els.video;
        if (!t?.player) return;
        t.player.pause();
    },

    tryCaptureFrame() {
        const video = this.els.video.player;
        if (!video || !this.els.shotImage || !this.els.shotPlaceholder) return;
        if (!video.videoWidth || !video.videoHeight) {
            this.tryCaptureWsFrame();
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/png');
        this.els.shotImage.src = dataUrl;
        this.els.shotImage.style.display = 'block';
        this.els.shotPlaceholder.style.display = 'none';
    },

    tryCaptureWsFrame() {
        const t = this.els.video;
        if (!t?.wsFrame || !this.els.shotImage || !this.els.shotPlaceholder) return;

        if (!this.ws.lastBlob) {
            try {
                const dataUrl = t.wsFrame.toDataURL('image/png');
                this.els.shotImage.src = dataUrl;
                this.els.shotImage.style.display = 'block';
                this.els.shotPlaceholder.style.display = 'none';
            } catch (_) {}
            return;
        }

        const img = new Image();
        const tmpUrl = URL.createObjectURL(this.ws.lastBlob);
        img.onload = () => {
            URL.revokeObjectURL(tmpUrl);
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 0;
            canvas.height = img.naturalHeight || 0;
            if (!canvas.width || !canvas.height) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            this.els.shotImage.src = dataUrl;
            this.els.shotImage.style.display = 'block';
            this.els.shotPlaceholder.style.display = 'none';
        };
        img.onerror = () => {
            URL.revokeObjectURL(tmpUrl);
        };
        img.src = tmpUrl;
    },

    initMockData() {
        this.data.warnings = [];

        this.data.persons = [
            '人员ID：38BC5B19AB44FA847AE099DF858AB770 | 人员姓名：胡琛 | 权限等级：C',
            '人员ID：563ECF250FA70232DC0A229714814408 | 人员姓名：徐启扬 | 权限等级：A',
            '人员ID：8B1E0C5A3B1B1CE38D81F31246BD8DAE | 人员姓名：牛永思 | 权限等级：A',
            '人员ID：B1E5A2364D8CD141F6E5A4CD9D3A6F04 | 人员姓名：海百运 | 权限等级：C'
        ];

        this.data.devices = [
            '设备ID：2543110005 | 设备名称：射频扫描仪 | 等级：b',
            '设备ID：2543110067 | 设备名称：实验室天线 | 等级：a'
        ];

        this.data.passLogs = [];
    },

    renderStaticPanels() {
        this.renderDbList(this.els.personDb, this.data.persons);
        this.renderDbList(this.els.deviceDb, this.data.devices);
    },

    renderDbList(root, rows) {
        if (!root) return;
        if (!rows || rows.length === 0) {
            root.innerHTML = '<div class="sbg-db-item">—</div>';
            return;
        }

        root.innerHTML = rows
            .map((t) => {
                const safe = this.escapeHtml(t);
                return `<div class="sbg-db-item" title="${safe}">${safe}</div>`;
            })
            .join('');
    },

    renderPassLogs(items) {
        if (!this.els.passLog) return;
        if (!items || items.length === 0) {
            this.renderPassLogPlaceholder();
            return;
        }

        this.els.passLog.innerHTML = items
            .map((it) => {
                const cls = it.type ? ` ${it.type}` : '';
                const safe = this.escapeHtml(it.text);
                return `<div class="sbg-log-item${cls}" title="${safe}">${safe}</div>`;
            })
            .join('');
    },

    ensureAlertStack() {
        let stack = document.getElementById('sbg-alert-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'sbg-alert-stack';
            stack.className = 'sbg-alert-stack';
            document.body.appendChild(stack);
        }
        return stack;
    },

    renderPassLogPlaceholder(text = '[--:--:--] 等待服务器日志...') {
        if (!this.els.passLog) return;
        const safe = this.escapeHtml(text);
        this.els.passLog.innerHTML = `<div class="sbg-log-item info">${safe}</div>`;
    },

    startPassLogPolling() {
        console.log('[PassLog] startPassLogPolling called (SSE mode), passLogUrl:', this.data.passLogUrl);
        if (this.display.passLogRunning) return;
        this.display.passLogRunning = true;
        this.display.passLogSeenKeys = new Set();
        this.display.passLogToastKeys = new Set();
        this.display.passLogSseBuffer = [];
        this.data.passLogs = [];
        this.renderPassLogPlaceholder('[--:--:--] 等待新的检测数据...');
        this.clearPassAlerts();

        // ★ 使用 SSE (/events) 替代轮询 (/latest.json)
        //    SSE 通过长连接逐条推送，网关连发的两条消息都能被可靠送达
        this.connectPassLogSse();
    },

    stopPassLogPolling() {
        this.display.passLogRunning = false;
        if (this.display.passLogTimer) {
            window.clearInterval(this.display.passLogTimer);
            this.display.passLogTimer = null;
        }
        this.disconnectPassLogSse();
        this.cancelPendingFacePassAlert();
        this.cancelPassLogSseFlush();
    },

    // ========== SSE 连接管理 ==========

    _buildSseUrl() {
        // 从 passLogUrl (http://host:port/latest.json) 推导 /events 地址
        if (!this.data.passLogUrl) return '';
        return this.data.passLogUrl.replace(/\/latest\.json(\?.*)?$/, '/events');
    },

    connectPassLogSse() {
        var sseUrl = this._buildSseUrl();
        if (!sseUrl) {
            console.log('[PassLog SSE] no SSE URL');
            return;
        }
        console.log('[PassLog SSE] connecting to', sseUrl);

        // 关闭旧连接
        this.disconnectPassLogSse();

        var self = this;
        var source = new EventSource(sseUrl);

        // SSE 标准事件类型 'json'（与 zhuanfa.py SSE 的 event: json 对应）
        source.addEventListener('json', function(e) {
            self.handlePassLogSseMessage(e);
        });

        // 通用 message 事件兜底（某些浏览器/代理可能吞自定义事件名）
        source.addEventListener('message', function(e) {
            // 如果已由 'json' 事件处理器处理过，跳过
            if (e._handled) return;
            self.handlePassLogSseMessage(e);
        });

        source.addEventListener('open', function() {
            console.log('[PassLog SSE] connection opened, seeding from /latest.json');
            // SSE 只推送新事件，建立连接后用 /latest.json 回填最近一条历史数据
            self.seedPassLogHistory();
        });

        source.addEventListener('error', function(e) {
            console.log('[PassLog SSE] connection error/close, readyState=', source.readyState);
            // EventSource 会自动重连，无需手动处理
        });

        this.display.passLogSseSource = source;
    },

    disconnectPassLogSse() {
        if (this.display.passLogSseSource) {
            try {
                this.display.passLogSseSource.close();
            } catch (_) {}
            this.display.passLogSseSource = null;
        }
    },

    // ========== SSE 事件处理 ==========

    handlePassLogSseMessage(e) {
        // 标记已由 json 处理器处理（防止 message 兜底重复处理）
        if (e.type === 'json') e._handled = true;

        if (!this.display.passLogRunning) return;

        var rawText = e.data;
        console.log('[PassLog SSE] raw event:', rawText);

        var raw;
        try {
            raw = JSON.parse(rawText);
        } catch (_) {
            console.log('[PassLog SSE] invalid JSON, skipping');
            return;
        }

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            console.log('[PassLog SSE] not a JSON object, skipping');
            return;
        }

        var event = this.normalizePassLog(raw);
        if (!event) {
            console.log('[PassLog SSE] normalize returned null');
            return;
        }

        // ★ 去重：与上一条消息比较，相同则跳过
        var itemKey = this.getPassLogEventKey(event);
        if (itemKey === this.display.passLogLastItemKey) {
            console.log('[PassLog SSE] dedup: same as last item');
            return;
        }
        this.display.passLogLastItemKey = itemKey;

        // ★ 追加到 SSE 缓冲池，启动/重置 300ms 合并定时器
        //    网关连发的 warning + detecting 两条消息会在 300ms 窗口内合并处理
        this.display.passLogSseBuffer.push(event);
        this.schedulePassLogSseFlush();
    },

    // ========== SSE 缓冲合并（300ms 窗口） ==========

    schedulePassLogSseFlush() {
        if (this.display.passLogSseFlushTimer) {
            window.clearTimeout(this.display.passLogSseFlushTimer);
        }
        var self = this;
        this.display.passLogSseFlushTimer = window.setTimeout(function() {
            self.display.passLogSseFlushTimer = null;
            self.flushPassLogSseBuffer();
        }, 300);
    },

    cancelPassLogSseFlush() {
        if (this.display.passLogSseFlushTimer) {
            window.clearTimeout(this.display.passLogSseFlushTimer);
            this.display.passLogSseFlushTimer = null;
        }
        this.display.passLogSseBuffer = [];
    },

    flushPassLogSseBuffer() {
        var events = this.display.passLogSseBuffer;
        this.display.passLogSseBuffer = [];

        if (!events || events.length === 0) return;
        if (!this.display.passLogRunning) return;

        console.log('[PassLog SSE] flushing', events.length, 'events');

        // ★ 弹窗展示顺序：detecting（检测到设备）在前，结果/告警在后
        //    用户体验：先看到"检测到xx设备"，再看到"人员与设备的匹配结果"
        events.sort(function(a, b) {
            var aIsDetect = (a.alarmCode === 'detecting') ? 0 : 1;
            var bIsDetect = (b.alarmCode === 'detecting') ? 0 : 1;
            return aIsDetect - bIsDetect;
        });

        // 累积到 passLogs 头部（按时间倒序保留原始顺序感）
        for (var m = events.length - 1; m >= 0; m--) {
            this.data.passLogs.unshift(events[m]);
        }
        if (this.data.passLogs.length > 50) this.data.passLogs.length = 50;

        // 弹窗：全部依次展示（detecting 先弹出，结果/告警紧随其后）
        for (var n = 0; n < events.length; n++) {
            this.notifyPassLogEvent(events[n]);
        }

        this.renderPassLogs(this.data.passLogs);
    },

    // 保留 fetchRawPassLogs 以兼容旧调用方（seedPassLogHistory 等）
    fetchRawPassLogs() {
        if (!this.data.passLogUrl) return Promise.resolve([]);
        var url = this.data.passLogUrl + '?t=' + Date.now();
        return fetch(url)
            .then(function(resp) {
                if (resp.status === 204) return [];
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json().then(function(data) {
                    return Array.isArray(data) ? data : (data ? [data] : []);
                }).catch(function() { return []; });
            })
            .catch(function() { return []; });
    },

    seedPassLogHistory() {
        this.display.passLogSeedPromise = this.fetchRawPassLogs()
            .then((items) => {
                var seeded = this.parsePassLogEvents(items, {
                    notify: false,
                    onlyNew: false,
                    markSeen: true
                });
                // ★ 将种子数据渲染到通行状态面板
                if (seeded && seeded.length > 0) {
                    for (var s = seeded.length - 1; s >= 0; s--) {
                        this.data.passLogs.unshift(seeded[s]);
                    }
                    if (this.data.passLogs.length > 50) this.data.passLogs.length = 50;
                    this.renderPassLogs(this.data.passLogs);
                }
            })
            .catch(() => {});

        return this.display.passLogSeedPromise;
    },

    parsePassLogEvents(items, options = {}) {
        const {
            notify = true,
            onlyNew = true,
            markSeen = true
        } = options;

        const parsed = items
            .map((item, index) => {
                const event = this.normalizePassLog(item);
                if (event) event.sourceIndex = index;
                return event;
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
                if (a.priority !== b.priority) return a.priority - b.priority;
                return b.sourceIndex - a.sourceIndex;
            });

        const latestByDevice = new Map();
        parsed.forEach((event) => {
            const eventKey = this.getPassLogEventKey(event);
            if (onlyNew && this.display.passLogSeenKeys.has(eventKey)) return;

            const key = event.deviceName || event.deviceKey;
            const existing = latestByDevice.get(key);
            if (!existing || event.priority >= existing.priority) {
                latestByDevice.set(key, event);
            }

            if (notify) {
                this.notifyPassLogEvent(event);
            } else if (markSeen) {
                this.display.passLogSeenKeys.add(eventKey);
            }
        });

        return Array.from(latestByDevice.values())
            .sort((a, b) => b.sortTime - a.sortTime)
            .slice(0, 8);
    },

    normalizePassLog(item) {
        if (!item || typeof item !== 'object') return null;

        const typeMap = {
            success: 'ok',
            warning: 'warn',
            info: 'info'
        };

        const actionType = String(item.action_type || 'info');
        let type = typeMap[actionType] || 'info';
        const time = String(item.time || '--:--:--');
        const personName = String(item.person_name || '未知人员');
        const personLevel = this.htmlToText(item.person_level_html || '');
        const deviceName = String(item.device_name || '未知设备');
        const deviceLevel = this.htmlToText(item.device_level_html || '');
        const alarmCode = String(item.alarm_code || '');
        const deviceKey = deviceName || 'unknown-device';

        if (alarmCode === 'snap_prepass') {
            type = 'ok';
        }

        if (this.isIgnoredPassLog({ personName, personLevel, deviceName, deviceLevel, alarmCode })) {
            return null;
        }

        const auth = this.evaluatePassEvent({
            actionType,
            personName,
            personLevel,
            deviceName,
            deviceLevel,
            alarmCode
        });

        const text = [
            `[${time}] ${auth.title}`,
            `人员：${personName}${personLevel ? `（${personLevel}）` : ''}`,
            `设备：${deviceName}${deviceLevel ? `（${deviceLevel}）` : ''}`,
            `结果：${auth.message}`
        ].join(' | ');

        return {
            type,
            text,
            time,
            sortTime: this.timeToSeconds(time),
            actionType,
            alarmCode,
            personName,
            personLevel,
            deviceName,
            deviceLevel,
            deviceKey,
            priority: auth.priority,
            alertTitle: auth.title,
            alertMessage: auth.message,
            alertType: type
        };
    },

    htmlToText(value) {
        const div = document.createElement('div');
        div.innerHTML = String(value);
        return (div.textContent || div.innerText || '').trim();
    },

    isIgnoredPassLog(event) {
        const fields = [
            event.personName,
            event.personLevel,
            event.deviceName,
            event.deviceLevel,
            event.alarmCode
        ].join('|').toLowerCase();

        return fields.includes('startup_probe')
            || fields.includes('probe')
            || fields.includes('python_process')
            || fields.includes('系统启动探针');
    },

    evaluatePassEvent(event) {
        if (event.alarmCode === 'snap_prepass' || event.alarmCode === '无设备通行') {
            return {
                title: '人脸识别通过',
                message: '已入库人员，请通行',
                priority: 2
            };
        }

        if (event.alarmCode === 'detecting') {
            return {
                title: '检测到设备',
                message: `已检测到${event.deviceLevel ? event.deviceLevel + ' ' : ''}${event.deviceName}，请等待监管系统响应`,
                priority: 1
            };
        }

        const personRecord = this.findPersonRecord(event.personName);
        const deviceRecord = this.findDeviceRecord(event.deviceName);
        const personLevelCode = personRecord?.level || this.extractPersonLevel(event.personLevel);
        const deviceLevelCode = deviceRecord?.level || this.extractDeviceLevel(event.deviceLevel);
        const allowedByFrontend = personLevelCode === 'A'
            || (personLevelCode === 'B' && deviceLevelCode === 'b');

        if (event.actionType === 'success' || allowedByFrontend) {
            return {
                title: '人员设备认证通过',
                message: `${event.personLevel || ''}${event.personName}可携带${event.deviceLevel || ''}${event.deviceName}，认证通过，请通行。`,
                priority: 3
            };
        }

        let message = `${event.personLevel || ''}${event.personName}携带未授权${event.deviceLevel || ''}${event.deviceName}。`;
        if (event.alarmCode === 'C_carrying_a' || event.alarmCode === 'C_carrying_b') {
            message = `${event.personLevel || ''}${event.personName}非法携带${event.deviceLevel || ''}${event.deviceName}，请等待接受管理员检查。`;
        } else if (event.alarmCode === 'B_carrying_a') {
            message = `${event.personLevel || ''}${event.personName}无权管理${event.deviceLevel || ''}${event.deviceName}，请等待接受管理员检查。`;
        }

        return {
            title: '人员设备认证告警',
            message,
            priority: 4
        };
    },

    findPersonRecord(name) {
        const target = String(name || '').trim();
        if (!target || target === '检测中') return null;

        for (const row of this.data.persons || []) {
            const text = String(row);
            const personName = this.matchField(text, '人员姓名');
            if (personName !== target) continue;

            return {
                id: this.matchField(text, '人员ID'),
                name: personName,
                level: this.matchField(text, '权限等级')
            };
        }
        return null;
    },

    findDeviceRecord(name) {
        const target = String(name || '').trim();
        if (!target || target === '无设备') return null;

        for (const row of this.data.devices || []) {
            const text = String(row);
            const deviceName = this.matchField(text, '设备名称');
            if (deviceName !== target) continue;

            return {
                id: this.matchField(text, '设备ID'),
                name: deviceName,
                level: this.matchField(text, '等级')
            };
        }
        return null;
    },

    matchField(text, label) {
        const re = new RegExp(`${label}：([^|]+)`);
        const match = String(text || '').match(re);
        return match ? match[1].trim() : '';
    },

    extractPersonLevel(text) {
        const s = String(text || '');
        if (s.includes('高') || s.includes('A')) return 'A';
        if (s.includes('中') || s.includes('B')) return 'B';
        if (s.includes('低') || s.includes('C')) return 'C';
        return '';
    },

    extractDeviceLevel(text) {
        const s = String(text || '');
        if (s.includes('高') || s.includes('a')) return 'a';
        if (s.includes('中') || s.includes('b')) return 'b';
        return '';
    },

    timeToSeconds(time) {
        const parts = String(time || '').split(':').map((n) => Number(n));
        if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 0;
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    },

    notifyPassLogEvent(event) {
        console.log('[PassLog] notify called:', event.personName, event.deviceName, event.alarmCode);

        const eventKey = this.getPassLogEventKey(event);
        if (this.display.passLogSeenKeys.has(eventKey)) {
            console.log('[PassLog] notify SKIP: seenKey match');
            return;
        }
        this.display.passLogSeenKeys.add(eventKey);

        const toastKey = [
            event.deviceName,
            event.personName,
            event.alarmCode || event.actionType
        ].join('|');
        if (this.display.passLogToastKeys.has(toastKey)) {
            console.log('[PassLog] notify SKIP: toastKey match');
            return;
        }
        this.display.passLogToastKeys.add(toastKey);

        if (this.isDeviceLinkedPassEvent(event)) {
            console.log('[PassLog] deviceLinked=true, recentDeviceLinkedAt=', Date.now());
            this.display.recentDeviceLinkedAt = Date.now();
            this.cancelPendingFacePassAlert();
        }

        if (this.isFacePassOnlyEvent(event)) {
            console.log('[PassLog] facePassOnly=true');
            if (Date.now() - (this.display.recentDeviceLinkedAt || 0) < 3500) {
                console.log('[PassLog] facePassOnly SKIP: within 3500ms of deviceLinked');
                return;
            }
            this.deferFacePassAlert(event, toastKey);
            return;
        }

        console.log('[PassLog] SHOWING alert:', event.alertTitle, event.alertMessage);
        this.showPassAlert(event.alertTitle, event.alertMessage, event.alertType, event.deviceName);
    },

    isFacePassOnlyEvent(event) {
        return event.alarmCode === 'snap_prepass' || event.alarmCode === '无设备通行';
    },

    isDeviceLinkedPassEvent(event) {
        if (event.alarmCode === 'snap_prepass' || event.alarmCode === '无设备通行') return false;
        if (event.alarmCode === 'detecting') return true;
        return Boolean(this.findDeviceRecord(event.deviceName));
    },

    deferFacePassAlert(event, toastKey) {
        this.cancelPendingFacePassAlert(false);
        this.display.pendingFacePassEvent = event;
        this.display.pendingFacePassToastKey = toastKey;
        this.display.pendingFacePassTimer = window.setTimeout(() => {
            const pending = this.display.pendingFacePassEvent;
            this.display.pendingFacePassTimer = null;
            this.display.pendingFacePassEvent = null;
            this.display.pendingFacePassToastKey = '';
            if (!pending || !this.display.passLogRunning) return;
            this.showPassAlert(pending.alertTitle, pending.alertMessage, pending.alertType, pending.deviceName);
        }, 2800);
    },

    cancelPendingFacePassAlert(removeToastKey = true) {
        if (this.display.pendingFacePassTimer) {
            window.clearTimeout(this.display.pendingFacePassTimer);
            this.display.pendingFacePassTimer = null;
        }
        if (removeToastKey && this.display.pendingFacePassToastKey) {
            this.display.passLogToastKeys.delete(this.display.pendingFacePassToastKey);
        }
        this.display.pendingFacePassEvent = null;
        this.display.pendingFacePassToastKey = '';
    },

    getPassLogEventKey(event) {
        return [
            event.time,
            event.deviceName,
            event.personName,
            event.alarmCode,
            event.actionType
        ].join('|');
    },

    clearPassAlerts() {
        this.cancelPendingFacePassAlert();
        const stack = this.els.alertStack || document.getElementById('sbg-alert-stack');
        if (stack) {
            stack.innerHTML = '';
            stack.classList.remove('is-active');
        }
        this.display.passAlertQueue = [];
        this.display.passAlertActive = false;
    },

    showPassAlert(title, message, type = 'info', deviceName = '') {
        this.display.passAlertQueue.push({ title, message, type, deviceName });
        this.showNextPassAlert();
    },

    showNextPassAlert() {
        if (this.display.passAlertActive) return;
        const alert = this.display.passAlertQueue.shift();
        if (!alert) return;

        this.display.passAlertActive = true;
        const stack = this.els.alertStack || this.ensureAlertStack();
        stack.innerHTML = '';
        stack.classList.add('is-active');

        const item = document.createElement('div');
        item.className = `sbg-alert-item ${alert.type}`;
        const duration = this.getPassAlertDuration(alert.type);
        item.innerHTML = `
            <button class="sbg-alert-close" type="button" aria-label="关闭">×</button>
            <div class="sbg-alert-shell">
                <div class="sbg-alert-kicker">检测提示</div>
                <div class="sbg-alert-title">${this.escapeHtml(alert.title)}</div>
                <div class="sbg-alert-text">${this.renderAlertMessage(alert.message, alert.deviceName)}</div>
            </div>
        `;
        stack.appendChild(item);

        let closed = false;
        const closeAlert = () => {
            if (closed) return;
            closed = true;
            item.classList.add('is-leaving');
            window.setTimeout(() => {
                item.remove();
                this.display.passAlertActive = false;
                window.setTimeout(() => {
                    if (this.display.passAlertQueue.length > 0) {
                        this.showNextPassAlert();
                    } else {
                        stack.classList.remove('is-active');
                    }
                }, 450);
            }, 260);
        };

        const closeBtn = item.querySelector('.sbg-alert-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeAlert);
        }

        window.setTimeout(closeAlert, duration);
    },

    getPassAlertDuration(type) {
        if (type === 'warn') return 4500;
        if (type === 'ok') return 3500;
        return 2000;
    },

    renderAlertMessage(message, deviceName) {
        const text = String(message || '');
        const target = String(deviceName || '').trim();
        if (!target || !text.includes(target)) return this.escapeHtml(text);

        return text
            .split(target)
            .map((part) => this.escapeHtml(part))
            .join(`<span class="sbg-alert-device-name">${this.escapeHtml(target)}</span>`);
    },

    renderWarningPlaceholder() {
        this.renderList(this.els.warningList, [{
            type: 'info',
            kind: 'perimeter-placeholder',
            time: '--:--:--',
            title: '等待周界预警截图',
            message: ''
        }]);
    },

    startWarningDisplay() {
        this.display.buffer = this.data.warnings.slice(-20).reverse();
        this.renderList(this.els.warningList, this.display.buffer);
    },

    pushPerimeterWarning(filename, mtime) {
        const key = `${filename || ''}|${mtime || ''}`;
        if (this.display.perimeterWarningKeys.has(key)) return;
        this.display.perimeterWarningKeys.add(key);

        const timeText = mtime ? this.formatHMS(new Date(Number(mtime))) : this.formatHMS(new Date());
        const targetText = this.inferPerimeterTarget(filename);
        const eventNo = this.display.perimeterWarningKeys.size;
        const item = {
            type: 'warn',
            kind: 'perimeter',
            time: timeText,
            target: targetText,
            eventNo,
            filename: filename || 'latest',
            title: `周界预警检测到${targetText}`,
            message: `事件 #${String(eventNo).padStart(2, '0')}，设备管控系统联动核验中`,
            text: `[${timeText}] 周界预警检测到${targetText} | 事件 #${String(eventNo).padStart(2, '0')}，设备管控系统联动核验`
        };

        this.data.warnings.push(item);
        if (this.display.running) {
            this.display.buffer.unshift(item);
            this.display.buffer = this.display.buffer.slice(0, 20);
            this.renderList(this.els.warningList, this.display.buffer);
        }
    },

    inferPerimeterTarget(filename) {
        const upper = String(filename || '').toUpperCase();
        if (upper.includes('CAR') || upper.includes('VEHICLE') || upper.includes('车辆')) return '车辆目标';
        if (upper.includes('DEVICE') || upper.includes('EQUIP') || upper.includes('设备')) return '设备区异常目标';
        return '人员目标';
    },

    formatHMS(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '--:--:--';
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
    },

    stopWarningDisplay() {
        if (this.display.timer) {
            window.clearInterval(this.display.timer);
            this.display.timer = null;
        }
        this.display.buffer = [];
        this.renderWarningPlaceholder();
    },

    renderList(root, items) {
        if (!root) return;
        if (!items || items.length === 0) {
            this.renderWarningPlaceholder();
            return;
        }

        root.innerHTML = items
            .map((it) => {
                const cls = it.type ? ` ${it.type}` : '';
                if (it.kind === 'perimeter' || it.kind === 'perimeter-placeholder') {
                    const safeTitle = this.escapeHtml(it.title || '周界预警信息');
                    const safeTime = this.escapeHtml(it.time || '--:--:--');
                    const safeTarget = this.escapeHtml(it.target || '等待目标');
                    const safeMessage = this.escapeHtml(it.message || '');
                    return `<div class="sbg-item sbg-perimeter-item${cls}" title="${this.escapeHtml(it.text || safeTitle)}">
                        <div class="sbg-perimeter-head">
                            <span class="sbg-perimeter-time">${safeTime}</span>
                            <span class="sbg-perimeter-tag">${safeTarget}</span>
                        </div>
                        <div class="sbg-perimeter-title">${safeTitle}</div>
                        ${safeMessage ? `<div class="sbg-perimeter-message">${safeMessage}</div>` : ''}
                    </div>`;
                }
                const safe = this.escapeHtml(it.text);
                return `<div class="sbg-item${cls}" title="${safe}">${safe}</div>`;
            })
            .join('');
    },

    escapeHtml(s) {
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    },

    connectPerimeterWs() {
        if (!this.perimeter.ws.running) return;
        if (!this.perimeter.ws.url) return;

        let socket = null;
        try {
            socket = new WebSocket(this.perimeter.ws.url);
        } catch (_) {
            this.schedulePerimeterWsReconnect();
            return;
        }

        this.perimeter.ws.socket = socket;
        socket.binaryType = 'blob';

        socket.onmessage = (evt) => {
            if (!this.perimeter.ws.running) return;

            if (typeof evt.data === 'string') {
                try {
                    const data = JSON.parse(evt.data);
                    if (data && data.type === 'snapshot') {
                        this.upsertSnapshotRecord(data);
                        if (this.display.running) {
                            this.updatePerimeterDisplay();
                        }
                    }
                } catch (_) {}
                return;
            }
        };

        socket.onclose = () => {
            this.perimeter.ws.socket = null;
            if (this.perimeter.ws.running) this.schedulePerimeterWsReconnect();
        };

        socket.onerror = () => {
            try {
                socket.close();
            } catch (_) {}
        };
    },

    schedulePerimeterWsReconnect() {
        if (!this.perimeter.ws.running) return;
        if (this.perimeter.ws.reconnectTimer) return;
        this.perimeter.ws.reconnectTimer = window.setTimeout(() => {
            this.perimeter.ws.reconnectTimer = null;
            this.connectPerimeterWs();
        }, 1000);
    },

    upsertSnapshotRecord(record) {
        if (!record) return;

        const next = {
            event: String(record.event || ''),
            event_id: Number(record.event_id || 0),
            timestamp: Number(record.timestamp || 0),
            time_str: String(record.time_str || ''),
            filename: String(record.filename || ''),
            tag: String(record.tag || ''),
            image_base64: String(record.image_base64 || '')
        };

        const idx = this.display.snapshotRecords.findIndex((item) => item.event_id === next.event_id);
        if (idx >= 0) {
            this.display.snapshotRecords[idx] = next;
        } else {
            this.display.snapshotRecords.push(next);
        }

        this.display.snapshotRecords.sort((a, b) => {
            if (a.event_id !== b.event_id) return a.event_id - b.event_id;
            return a.timestamp - b.timestamp;
        });
    },

    startPerimeterDisplay() {
        if (this.display.running) return;
        
        this.display.running = true;
        this.display.perimeterImageMTime = 0;
        this.display.perimeterWarningKeys = new Set();
        this.renderPerimeterPlaceholder();
        this.fetchLatestPerimeterImage();
        this.display.perimeterImageTimer = window.setInterval(() => {
            this.fetchLatestPerimeterImage();
        }, 1200);
    },

    stopPerimeterDisplay() {
        this.display.running = false;
        if (this.display.perimeterImageTimer) {
            window.clearInterval(this.display.perimeterImageTimer);
            this.display.perimeterImageTimer = null;
        }
        if (this.display.perimeterImageObjectUrl) {
            URL.revokeObjectURL(this.display.perimeterImageObjectUrl);
            this.display.perimeterImageObjectUrl = null;
        }
        
        // 停止WebSocket连接
        if (this.perimeter.ws.reconnectTimer) {
            window.clearTimeout(this.perimeter.ws.reconnectTimer);
            this.perimeter.ws.reconnectTimer = null;
        }
        if (this.perimeter.ws.socket) {
            try {
                this.perimeter.ws.socket.close();
            } catch (_) {}
            this.perimeter.ws.socket = null;
        }
        this.perimeter.ws.running = false;
        
        // 清空显示
        this.renderPerimeterPlaceholder();
    },

    fetchLatestPerimeterImage() {
        if (!this.display.running || !this.data.perimeterImageUrl) return;

        const since = this.display.perimeterImageMTime || 0;
        const url = `${this.data.perimeterImageUrl}?wait=1&timeout=1000&since=${encodeURIComponent(since)}&t=${Date.now()}`;
        fetch(url, { cache: 'no-store' })
            .then((response) => {
                if (!this.display.running) return null;
                if (response.status === 204) return null;
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const filename = response.headers.get('X-ZJ-Filename') || '';
                const mtime = Number(response.headers.get('X-ZJ-MTime') || Date.now());
                return response.blob().then((blob) => ({ blob, filename, mtime }));
            })
            .then((payload) => {
                if (!payload || !this.display.running || !payload.blob || payload.blob.size <= 0) return;
                this.showPerimeterImageBlob(payload.blob);
                this.display.perimeterImageMTime = payload.mtime || Date.now();
                this.pushPerimeterWarning(payload.filename, this.display.perimeterImageMTime);
            })
            .catch(() => {
                if (!this.display.perimeterImageMTime) this.renderPerimeterPlaceholder();
            });
    },

    showPerimeterImageBlob(blob) {
        if (!this.els.shotImage || !this.els.shotPlaceholder) return;

        const nextUrl = URL.createObjectURL(blob);
        const previousUrl = this.display.perimeterImageObjectUrl;
        this.display.perimeterImageObjectUrl = nextUrl;
        this.els.shotImage.onload = () => {
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            this.els.shotImage.onload = null;
        };
        this.els.shotImage.src = nextUrl;
        this.els.shotImage.style.display = 'block';
        this.els.shotPlaceholder.style.display = 'none';
    },

    updatePerimeterDisplay() {
        if (!this.display.running || this.display.snapshotRecords.length === 0) {
            this.renderPerimeterPlaceholder();
            return;
        }

        const latest = this.display.snapshotRecords[this.display.snapshotRecords.length - 1];
        if (!latest?.image_base64) {
            this.renderPerimeterPlaceholder();
            return;
        }

        if (!this.els.shotImage || !this.els.shotPlaceholder) return;
        this.els.shotImage.src = `data:image/jpeg;base64,${latest.image_base64}`;
        this.els.shotImage.style.display = 'block';
        this.els.shotPlaceholder.style.display = 'none';
    },

    renderPerimeterPlaceholder() {
        if (!this.els.shotImage || !this.els.shotPlaceholder) return;
        this.els.shotImage.removeAttribute('src');
        this.els.shotImage.style.display = 'none';
        this.els.shotPlaceholder.style.display = 'flex';
    },

    clearPerimeterHistoryData() {
        // 清空本地快照记录
        this.display.snapshotRecords = [];
        
        // 发送清理历史数据的请求到后端
        const host = window.location.hostname || '127.0.0.1';
        const url = `http://${host}:6011/clear_history`;
        
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => {
            if (response.ok) {
                console.log('[INFO] 周界预警历史数据已清理');
            } else {
                console.error('[ERROR] 清理周界预警历史数据失败');
            }
        })
        .catch(err => {
            console.error('[ERROR] 清理请求异常:', err);
        });
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SheBeiGuanKongScene.init());
} else {
    SheBeiGuanKongScene.init();
}

window.SheBeiGuanKongAPI = {
    renderStaticPanels: () => SheBeiGuanKongScene.renderStaticPanels(),
    fetchPassLogs: () => SheBeiGuanKongScene.fetchPassLogs()
};
