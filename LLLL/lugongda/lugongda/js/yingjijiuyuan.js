
const YingJiJiuYuanScene = {
    logs: [],
    snapshotRecords: [],
    detectionRecords: [],
    snapshotDisplayRunning: false,
    displayUpdateTimer: null,
    snapshotSlideTimer: null,
    snapshotQueue: [],
    seenSnapshotJson: new Set(),
    currentSnapshotIndex: -1,
    latestSnapshotFilename: '',
    latestSnapshotJsonName: '',
    snapshotListUrl: 'http://36.152.33.88:8081/media/list_json.jsp?folder=json4&sort=desc&limit=1',
    snapshotImageListUrl: 'http://36.152.33.88:8081/media/list_images.jsp?folder=snapshot4',
    snapshotJsonBaseUrl: 'http://36.152.33.88:8081/media/json4/',
    snapshotImageBaseUrl: 'http://36.152.33.88:8081/media/snapshot4/',
    envDataUrl: 'http://36.152.33.88:8081/media/json4/latest_env.json',
    envHistoryListUrl: 'http://36.152.33.88:8081/media/list_json.jsp?folder=json4&sort=asc&includeEnv=1&limit=500',
    envDataMode: 'mock', // 临时测试：mock 使用模拟传感器数据；改回 latest 即恢复 latest_env.json
    passLogUrl: 'http://192.168.0.233:10012/latest.json',
    displayMode: 'snapshot', // 'snapshot' 或 'data'
    envPanelMode: 'sensor',
    
    // 传感器图表实例和数据
    sensorChart: null,
    smokeChart: null,
    sensorHistory: {
        temperature: [],
        humidity: [],
        smoke: [],
        timestamps: []
    },
    sensorUpdateTimer: null,
    latestEnvDataKey: '',
    envHistoryFiles: [],
    envHistoryIndex: 0,
    envHistoryLoading: null,
    passLogTimer: null,
    passLogRunning: false,
    passLogSeenKeys: new Set(),
    passLogRecords: [],
    fireEmergencyTimer: null,
    fireAlertTimer: null,
    lastFireEmergencyKey: '',
    deviceFireAccessTimer: null,
    lastDeviceFireAccessKey: '',
    passEmergencyReleaseModalTimer: null,
    lastPassEmergencyReleaseModalKey: '',
    
    // 传感器阈值
    thresholds: {
        temperature: { warning: 32, alert: 38 },
        humidity: { warning: 80, alert: 90 }
    },

    wsFire: {
        streamUrl: 'http://36.152.33.88:8081/media/video4/get_image4.jsp',
        running: false,
        frameTimer: null,
        loadTimer: null,
        fetchAbort: null,
        objectUrl: null,
        frameSeq: 0,
        lastServerSeq: 0,
        frameDelay: 0,
        frameTimeout: 3500,
        longPoll: true
    },

    wsOverview: {
        streamUrl: 'http://36.152.33.88:8081/media/get_video_only.jsp',
        fallbackStreamUrls: [
            'http://36.152.33.88:8081/media/video_only/latest.jpg'
        ],
        currentStreamIndex: 0,
        running: false,
        frameTimer: null,
        loadTimer: null,
        fetchAbort: null,
        objectUrl: null,
        frameSeq: 0,
        lastServerSeq: 0,
        frameDelay: 0,
        frameTimeout: 3500,
        longPoll: true
    },

    overviewMode: 'factory',
    overviewStreamModes: {
        factory: {
            label: '开启工厂全局画面',
            streamUrl: 'http://36.152.33.88:8081/media/get_video_only.jsp',
            fallbackStreamUrls: [
                'http://36.152.33.88:8081/media/video_only/latest.jpg'
            ],
            frameDelay: 0,
            frameTimeout: 3500,
            longPoll: true
        },
        device: {
            label: '设备管控联动',
            streamUrl: 'http://36.152.33.88:8081/media/get_video5.jsp',
            fallbackStreamUrls: [],
            frameDelay: 60,
            frameTimeout: 3500,
            longPoll: false
        }
    },

    els: {
        logList: null,
        fire: {
            file: null,
            selectBtn: null,
            video: null,
            wsFrame: null,
            placeholder: null,
            startBtn: null,
            stopBtn: null,
            objectUrl: null
        },
        overview: {
            file: null,
            selectBtn: null,
            modeSelect: null,
            video: null,
            wsFrame: null,
            placeholder: null,
            startBtn: null,
            stopBtn: null,
            objectUrl: null
        },
        capture: {
            title: null,
            image: null,
            dataList: null,
            placeholder: null,
            toggleModeBtn: null,
            startAllBtn: null,
            stopAllBtn: null
        },
        env: {
            title: null,
            badge: null,
            switchBtn: null,
            tempHumiView: null,
            smokeView: null,
            devicePassView: null,
            devicePassLog: null,
            temp: null,
            humi: null,
            dew: null,
            smoke: null,
            startBtn: null,
            stopBtn: null
        },
        linkage: {
            root: null
        }
    },
    deviceFlagEndpoint: 'http://36.152.33.88:8081/media/set_device_flag.jsp',

    init() {
        this.els.logList = document.getElementById('yjy-fire-info-list');

        this.els.fire.file = document.getElementById('yjy-fire-video-file');
        this.els.fire.selectBtn = document.getElementById('yjy-fire-video-select');
        this.els.fire.video = document.getElementById('yjy-fire-video-player');
        this.els.fire.wsFrame = document.getElementById('yjy-fire-ws-frame');
        this.els.fire.placeholder = document.getElementById('yjy-fire-video-placeholder');
        this.els.fire.startBtn = document.getElementById('yjy-fire-btn-start');
        this.els.fire.stopBtn = document.getElementById('yjy-fire-btn-stop');

        this.els.overview.file = document.getElementById('yjy-overview-video-file');
        this.els.overview.selectBtn = document.getElementById('yjy-overview-video-select');
        this.els.overview.modeSelect = document.getElementById('yjy-overview-mode-select');
        this.els.overview.video = document.getElementById('yjy-overview-video-player');
        this.els.overview.wsFrame = document.getElementById('yjy-overview-ws-frame');
        this.els.overview.placeholder = document.getElementById('yjy-overview-video-placeholder');
        this.els.overview.startBtn = document.getElementById('yjy-overview-btn-start');
        this.els.overview.stopBtn = document.getElementById('yjy-overview-btn-stop');

        this.els.capture.title = document.querySelector('.yjy-capture-panel .yjy-panel-title span');
        this.els.capture.image = document.getElementById('yjy-capture-image');
        this.els.capture.dataList = document.getElementById('yjy-capture-data-list');
        this.els.capture.placeholder = document.getElementById('yjy-capture-placeholder');
        this.els.capture.toggleModeBtn = document.getElementById('yjy-btn-toggle-mode');
        this.els.capture.startAllBtn = document.getElementById('yjy-btn-start-all');
        this.els.capture.stopAllBtn = document.getElementById('yjy-btn-stop-all');

        this.els.env.title = document.getElementById('yjy-env-panel-title');
        this.els.env.badge = document.getElementById('yjy-data-badge');
        this.els.env.switchBtn = document.getElementById('yjy-env-panel-switch');
        this.els.env.tempHumiView = document.getElementById('yjy-temp-humi-view');
        this.els.env.smokeView = document.getElementById('yjy-smoke-view');
        this.els.env.devicePassView = document.getElementById('yjy-device-pass-view');
        this.els.env.devicePassLog = document.getElementById('yjy-device-pass-log');
        this.els.env.temp = document.getElementById('yjy-env-temp');
        this.els.env.humi = document.getElementById('yjy-env-humi');
        this.els.env.dew = document.getElementById('yjy-env-dew');
        this.els.env.smoke = document.getElementById('yjy-env-smoke');
        this.els.env.startBtn = document.getElementById('yjy-env-btn-start');
        this.els.env.stopBtn = document.getElementById('yjy-env-btn-stop');

        this.els.linkage.root = document.querySelector('.yjy-linkage-list');

        this.bindFireWsPanel();
        this.bindOverviewWsPanel();
        this.bindResultActions();
        this.bindLinkageClick();
        this.bindSensorActions();

        this.renderResultPlaceholder();
        this.renderSnapshotPlaceholder();
        this.renderCaptureDataPlaceholder();
        this.setDeviceStatus('beacon', false);
        this.setDeviceStatus('valve', false);
        
        // 初始化温湿度图表
        this.initSensorChart();
        this.syncEnvPanelMode();

        // 页面刷新后确保设备标志复位
        this.resetDeviceFlags();
    },

    bindVideoPanel(target, meta) {
        if (!target?.file || !target?.video || !target?.placeholder || !target?.selectBtn) return;

        const showPlaceholder = () => {
            target.placeholder.style.display = 'flex';
        };

        const hidePlaceholder = () => {
            target.placeholder.style.display = 'none';
        };

        showPlaceholder();

        target.selectBtn.addEventListener('click', () => {
            target.file.click();
        });

        target.file.addEventListener('change', () => {
            const file = target.file.files?.[0];
            if (!file) {
                this.clearLocalVideo(target);
                showPlaceholder();
                return;
            }

            this.setLocalVideoFile(target, file);
            hidePlaceholder();
        });

        target.video.addEventListener('loadedmetadata', () => {
            if (target.video.currentSrc) hidePlaceholder();
        });

        target.video.addEventListener('error', () => {
            showPlaceholder();
        });

        if (target.startBtn) {
            target.startBtn.addEventListener('click', () => {
                this.playVideo(target);
                this.tryCaptureFrame();
            });
        }

        if (target.stopBtn) {
            target.stopBtn.addEventListener('click', () => {
                this.pauseVideo(target);
            });
        }
    },

    bindFireWsPanel() {
        const target = this.els.fire;
        if (!target?.file || !target?.video || !target?.placeholder || !target?.selectBtn) return;

        const showPlaceholder = () => {
            target.placeholder.style.display = 'flex';
        };

        const hidePlaceholder = () => {
            target.placeholder.style.display = 'none';
        };

        showPlaceholder();

        target.selectBtn.addEventListener('click', () => {
            target.file.click();
        });

        target.file.addEventListener('change', () => {
            const file = target.file.files?.[0];
            if (!file) {
                this.clearLocalVideo(target);
                if (!this.wsFire.running) showPlaceholder();
                return;
            }

            this.stopFireWsStream();
            this.setLocalVideoFile(target, file);
            hidePlaceholder();
        });

        target.video.addEventListener('loadedmetadata', () => {
            if (target.video.currentSrc) hidePlaceholder();
        });

        target.video.addEventListener('error', () => {
            if (!this.wsFire.running) showPlaceholder();
        });

        if (target.startBtn) {
            target.startBtn.addEventListener('click', () => {
                this.startFireWsStream();
            });
        }

        if (target.stopBtn) {
            target.stopBtn.addEventListener('click', () => {
                this.stopFireWsStream();
                if (!target.video.currentSrc) showPlaceholder();
            });
        }
    },

    startFireWsStream() {
        if (!this.els.fire.wsFrame || !this.els.fire.placeholder) return;
        if (this.wsFire.running) return;

        this.wsFire.running = true;
        this.wsFire.currentStreamIndex = 0;
        this.wsFire.frameSeq = 0;
        this.wsFire.lastServerSeq = 0;
        this.clearLocalVideo(this.els.fire);
        this.pauseVideo(this.els.fire);
        this.els.fire.video.style.display = 'none';

        this.els.fire.wsFrame.style.display = 'block';
        this.els.fire.placeholder.style.display = 'none';
        this.streamFrameLoop(this.wsFire, this.els.fire);
    },

    stopFireWsStream() {
        this.wsFire.running = false;
        if (this.wsFire.frameTimer) {
            window.clearTimeout(this.wsFire.frameTimer);
            this.wsFire.frameTimer = null;
        }
        if (this.wsFire.loadTimer) {
            window.clearTimeout(this.wsFire.loadTimer);
            this.wsFire.loadTimer = null;
        }
        if (this.wsFire.fetchAbort) {
            this.wsFire.fetchAbort.abort();
            this.wsFire.fetchAbort = null;
        }
        if (this.wsFire.objectUrl) {
            URL.revokeObjectURL(this.wsFire.objectUrl);
            this.wsFire.objectUrl = null;
        }

        if (this.els.fire.wsFrame) {
            this.els.fire.wsFrame.onload = null;
            this.els.fire.wsFrame.onerror = null;
            this.els.fire.wsFrame.removeAttribute('src');
            this.els.fire.wsFrame.style.display = 'none';
        }
    },

    streamFrameLoop(streamState, targetEls) {
        if (!streamState?.running || !targetEls?.wsFrame) return;

        const frameEl = targetEls.wsFrame;
        const streamUrls = [streamState.streamUrl].concat(streamState.fallbackStreamUrls || []);
        const streamIndex = streamState.currentStreamIndex || 0;
        const streamUrl = streamUrls[streamIndex] || streamState.streamUrl;
        const requestSeq = (streamState.frameSeq || 0) + 1;
        streamState.frameSeq = requestSeq;
        const scheduleNext = (delay) => {
            streamState.frameTimer = window.setTimeout(() => this.streamFrameLoop(streamState, targetEls), delay);
        };
        const clearLoadTimer = () => {
            if (streamState.loadTimer) {
                window.clearTimeout(streamState.loadTimer);
                streamState.loadTimer = null;
            }
        };
        const scheduleErrorRetry = () => {
            if (streamIndex < streamUrls.length - 1) {
                streamState.currentStreamIndex = streamIndex + 1;
            }
            scheduleNext(220);
        };

        if (streamState.fetchAbort) {
            streamState.fetchAbort.abort();
            streamState.fetchAbort = null;
        }

        const controller = new AbortController();
        streamState.fetchAbort = controller;
        clearLoadTimer();
        streamState.loadTimer = window.setTimeout(() => {
            if (!streamState.running || streamState.frameSeq !== requestSeq) return;
            controller.abort();
        }, streamState.frameTimeout || 3500);

        let frameUrl = `${streamUrl}?t=${Date.now()}&seq=${requestSeq}`;
        if (streamState.longPoll) {
            frameUrl += `&wait=1&timeout=1200&since=${encodeURIComponent(streamState.lastServerSeq || 0)}`;
        }

        fetch(frameUrl, { cache: 'no-store', signal: controller.signal })
            .then((response) => {
                if (!streamState.running || streamState.frameSeq !== requestSeq) return null;
                clearLoadTimer();
                streamState.fetchAbort = null;

                if (response.status === 204) {
                    scheduleNext(60);
                    return null;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const serverSeq = Number(response.headers.get('X-Frame-Seq') || 0);
                streamState.lastResponseHadSeq = serverSeq > 0;
                if (serverSeq > 0 && serverSeq === streamState.lastServerSeq) {
                    scheduleNext(streamState.longPoll ? 30 : (streamState.frameDelay || 60));
                    return null;
                }

                streamState.currentStreamIndex = streamIndex;
                if (serverSeq > 0) streamState.lastServerSeq = serverSeq;
                return response.blob();
            })
            .then((blob) => {
                if (!blob || !streamState.running || streamState.frameSeq !== requestSeq) return;
                if (blob.size <= 0) {
                    scheduleNext(120);
                    return;
                }

                const nextUrl = URL.createObjectURL(blob);
                const prevUrl = streamState.objectUrl;
                frameEl.onload = () => {
                    if (streamState.frameSeq !== requestSeq) return;
                    if (prevUrl) URL.revokeObjectURL(prevUrl);
                    frameEl.onload = null;
                    frameEl.onerror = null;
                    frameEl.style.display = 'block';
                    if (targetEls.placeholder) targetEls.placeholder.style.display = 'none';
                    scheduleNext(streamState.longPoll && streamState.lastResponseHadSeq ? 0 : (streamState.frameDelay || 60));
                };
                frameEl.onerror = () => {
                    URL.revokeObjectURL(nextUrl);
                    if (streamState.objectUrl === nextUrl) streamState.objectUrl = prevUrl || null;
                    frameEl.onload = null;
                    frameEl.onerror = null;
                    scheduleErrorRetry();
                };
                streamState.objectUrl = nextUrl;
                frameEl.src = nextUrl;
            })
            .catch((err) => {
                if (!streamState.running || streamState.frameSeq !== requestSeq) return;
                clearLoadTimer();
                streamState.fetchAbort = null;
                if (err && err.name === 'AbortError') {
                    scheduleNext(180);
                    return;
                }
                scheduleErrorRetry();
            });
    },

    applyOverviewMode(mode) {
        const nextMode = this.overviewStreamModes[mode] ? mode : 'factory';
        const config = this.overviewStreamModes[nextMode];

        this.overviewMode = nextMode;
        this.wsOverview.streamUrl = config.streamUrl;
        this.wsOverview.fallbackStreamUrls = config.fallbackStreamUrls || [];
        this.wsOverview.currentStreamIndex = 0;
        this.wsOverview.frameDelay = config.frameDelay;
        this.wsOverview.frameTimeout = config.frameTimeout || 3500;
        this.wsOverview.longPoll = config.longPoll;

        if (this.els.overview.modeSelect && this.els.overview.modeSelect.value !== nextMode) {
            this.els.overview.modeSelect.value = nextMode;
        }

        if (this.els.overview.startBtn) {
            this.els.overview.startBtn.textContent = config.label;
        }
    },

    bindOverviewWsPanel() {
        const target = this.els.overview;
        if (!target?.file || !target?.video || !target?.placeholder || !target?.selectBtn) return;

        const showPlaceholder = () => {
            target.placeholder.style.display = 'flex';
        };

        const hidePlaceholder = () => {
            target.placeholder.style.display = 'none';
        };

        showPlaceholder();
        this.applyOverviewMode(target.modeSelect?.value || 'factory');

        if (target.modeSelect) {
            target.modeSelect.addEventListener('change', () => {
                const wasRunning = this.wsOverview.running;
                if (wasRunning) this.stopOverviewWsStream();

                this.applyOverviewMode(target.modeSelect.value);

                if (wasRunning) this.startOverviewWsStream();
            });
        }

        target.selectBtn.addEventListener('click', () => {
            target.file.click();
        });

        target.file.addEventListener('change', () => {
            const file = target.file.files?.[0];
            if (!file) {
                this.clearLocalVideo(target);
                if (!this.wsOverview.running) showPlaceholder();
                return;
            }

            this.stopOverviewWsStream();
            this.setLocalVideoFile(target, file);
            hidePlaceholder();
        });

        target.video.addEventListener('loadedmetadata', () => {
            if (target.video.currentSrc) hidePlaceholder();
        });

        target.video.addEventListener('error', () => {
            if (!this.wsOverview.running) showPlaceholder();
        });

        if (target.startBtn) {
            target.startBtn.addEventListener('click', () => {
                this.applyOverviewMode(target.modeSelect?.value || this.overviewMode);
                this.startOverviewWsStream();
            });
        }

        if (target.stopBtn) {
            target.stopBtn.addEventListener('click', () => {
                this.stopOverviewWsStream();
                if (!target.video.currentSrc) showPlaceholder();
            });
        }
    },

    startOverviewWsStream() {
        if (!this.els.overview.wsFrame || !this.els.overview.placeholder) return;
        if (this.wsOverview.running) return;

        this.wsOverview.running = true;
        this.wsOverview.currentStreamIndex = 0;
        this.wsOverview.frameSeq = 0;
        this.wsOverview.lastServerSeq = 0;
        this.clearLocalVideo(this.els.overview);
        this.pauseVideo(this.els.overview);
        this.els.overview.video.style.display = 'none';

        this.els.overview.wsFrame.style.display = 'block';
        this.els.overview.placeholder.style.display = 'none';
        this.streamFrameLoop(this.wsOverview, this.els.overview);
        if (this.overviewMode === 'device') {
            this.activateDeviceLinkageBusiness();
        } else {
            this.hideDeviceFireAccessAlert();
        }
    },

    stopOverviewWsStream() {
        this.wsOverview.running = false;
        if (this.wsOverview.frameTimer) {
            window.clearTimeout(this.wsOverview.frameTimer);
            this.wsOverview.frameTimer = null;
        }
        if (this.wsOverview.loadTimer) {
            window.clearTimeout(this.wsOverview.loadTimer);
            this.wsOverview.loadTimer = null;
        }
        if (this.wsOverview.fetchAbort) {
            this.wsOverview.fetchAbort.abort();
            this.wsOverview.fetchAbort = null;
        }
        if (this.wsOverview.objectUrl) {
            URL.revokeObjectURL(this.wsOverview.objectUrl);
            this.wsOverview.objectUrl = null;
        }

        if (this.els.overview.wsFrame) {
            this.els.overview.wsFrame.onload = null;
            this.els.overview.wsFrame.onerror = null;
            this.els.overview.wsFrame.removeAttribute('src');
            this.els.overview.wsFrame.style.display = 'none';
        }

        if (this.overviewMode === 'device') {
            this.deactivateDeviceLinkageBusiness();
        } else {
            this.hideDeviceFireAccessAlert();
        }
    },

    bindResultActions() {
        this.syncCaptureToggleBtnText();

        if (this.els.capture.toggleModeBtn) {
            this.els.capture.toggleModeBtn.addEventListener('click', () => {
                // 切换显示模式：在快照和数据之间切换
                this.toggleDisplayMode();
            });
        }

        if (this.els.capture.startAllBtn) {
            this.els.capture.startAllBtn.addEventListener('click', () => {
                this.snapshotDisplayRunning = true;
                this.loadRealSnapshots();
            });
        }

        if (this.els.capture.stopAllBtn) {
            this.els.capture.stopAllBtn.addEventListener('click', () => {
                this.snapshotDisplayRunning = false;
                this.stopDisplayUpdate();
                this.renderSnapshotPlaceholder();
                this.renderCaptureDataPlaceholder();
                this.renderResultPlaceholder();
            });
        }
    },

    toggleDisplayMode() {
        if (this.displayMode === 'snapshot') {
            this.displayMode = 'data';
            this.renderSnapshotPlaceholder();
            this.renderCaptureDataPlaceholder();
        } else {
            this.displayMode = 'snapshot';
            this.renderCaptureDataPlaceholder();
            this.renderSnapshotPlaceholder();
        }

        this.syncCaptureToggleBtnText();
    },

    syncCaptureToggleBtnText() {
        if (!this.els.capture.toggleModeBtn) return;
        this.els.capture.toggleModeBtn.textContent = this.displayMode === 'snapshot' ? '显示火灾数据' : '显示火灾截图';
    },

    startDisplayUpdate() {
        this.stopDisplayUpdate();
        this.pollLatestSnapshot();

        this.displayUpdateTimer = window.setInterval(() => {
            if (this.snapshotDisplayRunning) {
                this.pollLatestSnapshot();
            }
        }, 1500);
    },

    stopDisplayUpdate() {
        if (this.displayUpdateTimer) {
            window.clearInterval(this.displayUpdateTimer);
            this.displayUpdateTimer = null;
        }
    },

    loadRealSnapshots() {
        // 每次点击“开始显示”都重置增量游标
        this.latestSnapshotFilename = '';
        if (this.displayMode === 'data') {
            this.detectionRecords = [];
            this.renderCaptureDataPlaceholder();
        } else {
            this.renderSnapshotPlaceholder();
        }
        this.startDisplayUpdate();
    },

    pollLatestSnapshot() {
        const apiUrl = 'http://36.152.33.88:8081/media/list_images.jsp?folder=snapshot4';

        fetch(apiUrl)
            .then(response => response.json())
            .then(list => {
                if (!Array.isArray(list) || list.length === 0) {
                    return;
                }

                const latest = list[0];
                if (typeof latest !== 'string') return;

                if (latest === this.latestSnapshotFilename) {
                    return;
                }

                this.latestSnapshotFilename = latest;

                if (this.displayMode === 'snapshot') {
                    const snapshotUrl = `http://36.152.33.88:8081/media/snapshot4/${latest}`;
                    if (!this.els.capture.image || !this.els.capture.placeholder || !this.els.capture.dataList) return;
                    this.els.capture.image.src = `${snapshotUrl}?t=${Date.now()}`;
                    this.els.capture.image.style.display = 'block';
                    this.els.capture.placeholder.style.display = 'none';
                    this.els.capture.dataList.style.display = 'none';
                    return;
                }

                const parsed = this.parseSnapshotInfo(latest);
                this.detectionRecords.unshift(parsed);
                this.detectionRecords = this.detectionRecords.slice(0, 60);
                this.renderCaptureDataRows();
                this.renderResultBuffer();
            })
            .catch(err => {
                console.error('[ERROR] 拉取snapshot4列表失败:', err);
            });
    },

    // 生成模拟快照数据（备用方案，当没有真实数据时使用）
    generateMockSnapshot() {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        
        // 绘制背景
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 绘制网格效果
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i < canvas.width; i += 40) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
        }
        for (let i = 0; i < canvas.height; i += 40) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(canvas.width, i);
            ctx.stroke();
        }
        
        // 绘制模拟火焰检测
        const hasFireDetection = Math.random() > 0.5;
        if (hasFireDetection) {
            // 绘制火焰区域
            ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
            const flameX = Math.random() * (canvas.width - 100) + 50;
            const flameY = Math.random() * (canvas.height - 100) + 50;
            ctx.beginPath();
            ctx.arc(flameX, flameY, 80, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 24px Arial';
            ctx.fillText('火焰检测到！', 50, 60);
        }
        
        // 绘制信息文本
        ctx.fillStyle = '#67c5ff';
        ctx.font = '14px Arial';
        ctx.fillText(`时间: ${this.formatTime(new Date())}`, 20, canvas.height - 20);
        ctx.fillText(`火焰数: ${hasFireDetection ? 1 : 0}`, canvas.width - 150, canvas.height - 20);
        
        // 转换为base64
        const imageData = canvas.toDataURL('image/jpeg').split(',')[1];
        
        const now = new Date();
        const mockRecord = {
            event: hasFireDetection ? 'fire' : 'normal',
            event_id: this.snapshotRecords.length + 1,
            timestamp: Date.now(),
            time_str: this.formatTime(now),
            filename: `snapshot_${Date.now()}.jpg`,
            tag: hasFireDetection ? '火焰' : '无',
            fire_count: hasFireDetection ? 1 : 0,
            image_base64: imageData
        };
        
        this.snapshotRecords.push(mockRecord);
    },

    bindLinkageClick() {
        if (!this.els.linkage.root) return;

        this.els.linkage.root.addEventListener('click', (e) => {
            const opt = e.target?.closest?.('.yjy-linkage-option');
            if (!opt) return;

            const card = opt.closest('.yjy-linkage-card');
            const device = card?.getAttribute('data-device');
            const state = opt.getAttribute('data-state');
            if (!device || !state) return;

            this.setDeviceStatus(device, state === 'on');
        });
    },

    bindSensorActions() {
        this.els.env.switchBtn?.addEventListener('click', () => {
            this.toggleEnvPanelMode();
        });

        this.els.env.startBtn?.addEventListener('click', () => {
            if (this.envPanelMode === 'device') {
                this.startPassLogPolling();
            } else {
                if (this.envDataMode === 'history' || this.envDataMode === 'mock') {
                    this.resetEnvPlayback();
                }
                this.updateSensorData();
                this.startSensorUpdate();
            }
        });
        this.els.env.stopBtn?.addEventListener('click', () => {
            if (this.envPanelMode === 'device') {
                this.stopPassLogPolling();
            } else {
                this.stopSensorUpdate();
            }
        });
    },

    toggleEnvPanelMode() {
        if (this.envPanelMode === 'sensor') {
            if (!this.isDeviceLinkageActive()) {
                return;
            }
            this.stopSensorUpdate();
            this.envPanelMode = 'device';
        } else {
            this.stopPassLogPolling();
            this.envPanelMode = 'sensor';
        }

        this.syncEnvPanelMode();
    },

    syncEnvPanelMode() {
        const isDeviceMode = this.envPanelMode === 'device';

        if (this.els.env.title) {
            this.els.env.title.textContent = isDeviceMode ? '应急通行设备管控信息' : '工厂传感器检测数据';
        }

        if (this.els.env.badge) {
            this.els.env.badge.style.display = isDeviceMode ? 'none' : '';
        }

        if (this.els.env.tempHumiView) {
            this.els.env.tempHumiView.style.display = isDeviceMode ? 'none' : 'flex';
        }

        if (this.els.env.smokeView) {
            this.els.env.smokeView.style.display = isDeviceMode ? 'none' : 'flex';
        }

        if (this.els.env.devicePassView) {
            this.els.env.devicePassView.style.display = isDeviceMode ? 'flex' : 'none';
        }

        if (this.els.env.startBtn) {
            this.els.env.startBtn.textContent = '开始接收数据';
        }

        if (this.els.env.stopBtn) {
            this.els.env.stopBtn.textContent = '结束数据保留';
        }

        if (this.els.env.switchBtn) {
            this.els.env.switchBtn.classList.toggle('active', isDeviceMode);
            this.els.env.switchBtn.title = isDeviceMode ? '切换到工厂传感器检测数据' : '切换到应急通行设备管控信息';
        }

        if (isDeviceMode) {
            if (!this.passLogRecords.length) {
                this.renderPassLogPlaceholder();
            }
        } else {
            window.setTimeout(() => {
                if (this.sensorChart) this.sensorChart.resize();
                if (this.smokeChart) this.smokeChart.resize();
            }, 0);
        }
    },

    isDeviceLinkageActive() {
        return this.overviewMode === 'device' && this.wsOverview.running;
    },

    activateDeviceLinkageBusiness() {
        if (!this.isDeviceLinkageActive()) return;

        if (this.envPanelMode !== 'device') {
            this.stopSensorUpdate();
            this.envPanelMode = 'device';
            this.syncEnvPanelMode();
        }

        if (!this.passLogRunning) {
            this.renderPassLogPlaceholder('[--:--:--] 已接入设备管控联动，点击“开始接收数据”接收服务器日志...');
        }

        const currentFireRecord = this.snapshotQueue[this.currentSnapshotIndex] || this.snapshotQueue[0] || this.detectionRecords[0];
        if (currentFireRecord?.isFire) {
            this.showDeviceFireAccessAlert(currentFireRecord);
        }
    },

    deactivateDeviceLinkageBusiness() {
        this.hideDeviceFireAccessAlert();
        this.lastDeviceFireAccessKey = '';
        this.stopPassLogPolling();

        if (this.envPanelMode === 'device') {
            this.envPanelMode = 'sensor';
            this.syncEnvPanelMode();
        }
    },

    startPassLogPolling() {
        if (!this.isDeviceLinkageActive()) {
            this.renderPassLogPlaceholder('[--:--:--] 请先在应急救援画面开启设备管控联动...');
            return;
        }

        if (this.passLogRunning) return;

        this.passLogRunning = true;
        this.passLogSeenKeys = new Set();
        this.passLogSseBuffer = [];
        this.passLogRecords = [];
        this.renderPassLogPlaceholder('[--:--:--] 等待新的设备管控日志...');
        this.clearPassAlerts();

        // ★ 使用 SSE (/events) 替代轮询
        this.connectPassLogSse();
    },

    stopPassLogPolling() {
        this.passLogRunning = false;
        if (this.passLogTimer) {
            window.clearInterval(this.passLogTimer);
            this.passLogTimer = null;
        }
        this.disconnectPassLogSse();
        this.cancelPassLogSseFlush();
    },

    // ========== SSE 连接管理 ==========

    _buildSseUrl() {
        if (!this.passLogUrl) return '';
        return this.passLogUrl.replace(/\/latest\.json(\?.*)?$/, '/events');
    },

    connectPassLogSse() {
        var sseUrl = this._buildSseUrl();
        if (!sseUrl) return;
        console.log('[YJY PassLog SSE] connecting to', sseUrl);

        this.disconnectPassLogSse();

        var self = this;
        var source = new EventSource(sseUrl);

        source.addEventListener('json', function(e) {
            e._handled = true;
            self.handlePassLogSseMessage(e);
        });

        source.addEventListener('message', function(e) {
            if (e._handled) return;
            self.handlePassLogSseMessage(e);
        });

        source.addEventListener('open', function() {
            console.log('[YJY PassLog SSE] connection opened');
        });

        source.addEventListener('error', function(e) {
            console.log('[YJY PassLog SSE] connection error/close, readyState=', source.readyState);
        });

        this.passLogSseSource = source;
    },

    disconnectPassLogSse() {
        if (this.passLogSseSource) {
            try { this.passLogSseSource.close(); } catch (_) {}
            this.passLogSseSource = null;
        }
    },

    // ========== SSE 事件处理 ==========

    handlePassLogSseMessage(e) {
        if (!this.passLogRunning) return;

        var raw;
        try {
            raw = JSON.parse(e.data);
        } catch (_) {
            return;
        }

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;

        var event = this.normalizePassLog(raw);
        if (!event) return;

        var itemKey = this.getPassLogKey(event);
        if (itemKey === this.passLogLastItemKey) return;
        this.passLogLastItemKey = itemKey;

        this.passLogSseBuffer.push(event);
        this.schedulePassLogSseFlush();
    },

    // ========== SSE 缓冲合并（300ms 窗口） ==========

    schedulePassLogSseFlush() {
        if (this.passLogSseFlushTimer) {
            window.clearTimeout(this.passLogSseFlushTimer);
        }
        var self = this;
        this.passLogSseFlushTimer = window.setTimeout(function() {
            self.passLogSseFlushTimer = null;
            self.flushPassLogSseBuffer();
        }, 300);
    },

    cancelPassLogSseFlush() {
        if (this.passLogSseFlushTimer) {
            window.clearTimeout(this.passLogSseFlushTimer);
            this.passLogSseFlushTimer = null;
        }
        this.passLogSseBuffer = [];
    },

    flushPassLogSseBuffer() {
        var events = this.passLogSseBuffer;
        this.passLogSseBuffer = [];

        if (!events || events.length === 0) return;
        if (!this.passLogRunning) return;

        console.log('[YJY PassLog SSE] flushing', events.length, 'events');

        // 累积到 passLogRecords 头部（全部事件写入日志列表）
        for (var m = events.length - 1; m >= 0; m--) {
            this.passLogRecords.unshift(events[m]);
        }
        if (this.passLogRecords.length > 40) this.passLogRecords.length = 40;

        // ★ 应急救援场景只弹出"火情应急放行"弹窗，不弹普通检测/告警
        for (var n = 0; n < events.length; n++) {
            var ev = events[n];
            if (ev.alarmCode === 'fire_emergency_release') {
                this.showPassEmergencyReleaseModal(ev);
                this.showPassAlert(ev);
            }
        }

        this.renderPassLogs(this.passLogRecords);
    },

    // ========== 弹窗提醒 ==========

    ensureAlertStack() {
        var stack = document.getElementById('yjy-alert-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'yjy-alert-stack';
            stack.className = 'yjy-alert-stack';
            document.body.appendChild(stack);
        }
        return stack;
    },

    showPassAlert(event) {
        if (!this.passAlertQueue) this.passAlertQueue = [];
        this.passAlertQueue.push(event);
        this.showNextPassAlert();
    },

    showNextPassAlert() {
        if (this.passAlertActive) return;
        var evt = this.passAlertQueue.shift();
        if (!evt) return;

        this.passAlertActive = true;
        var stack = this.ensureAlertStack();
        stack.innerHTML = '';
        stack.classList.add('is-active');

        var item = document.createElement('div');
        item.className = 'yjy-alert-item ' + (evt.type || 'info');
        var duration = evt.type === 'warn' ? 4500 : evt.type === 'ok' ? 3500 : 2000;

        item.innerHTML =
            '<button class="yjy-alert-close" type="button" aria-label="关闭">×</button>' +
            '<div class="yjy-alert-shell">' +
            '<div class="yjy-alert-kicker">检测提示</div>' +
            '<div class="yjy-alert-title">' + this.escapeHtml(evt.title || '设备管控日志') + '</div>' +
            '<div class="yjy-alert-text">' + this.escapeHtml(evt.message || '') + '</div>' +
            '</div>';
        stack.appendChild(item);

        var self = this;
        var closed = false;
        var closeAlert = function() {
            if (closed) return;
            closed = true;
            item.classList.add('is-leaving');
            window.setTimeout(function() {
                item.remove();
                self.passAlertActive = false;
                window.setTimeout(function() {
                    if (self.passAlertQueue && self.passAlertQueue.length > 0) {
                        self.showNextPassAlert();
                    } else {
                        stack.classList.remove('is-active');
                    }
                }, 450);
            }, 260);
        };

        var closeBtn = item.querySelector('.yjy-alert-close');
        if (closeBtn) closeBtn.addEventListener('click', closeAlert);
        window.setTimeout(closeAlert, duration);
    },

    clearPassAlerts() {
        var stack = document.getElementById('yjy-alert-stack');
        if (stack) {
            stack.innerHTML = '';
            stack.classList.remove('is-active');
        }
        this.passAlertQueue = [];
        this.passAlertActive = false;
    },

    fetchRawPassLogs() {
        var url = this.passLogUrl + '?t=' + Date.now();
        return fetch(url, { cache: 'no-store' })
            .then(function(resp) {
                if (resp.status === 204) return [];
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json().then(function(data) {
                    return Array.isArray(data) ? data : (data ? [data] : []);
                }).catch(function() { return []; });
            })
            .catch(function() { return []; });
    },

    parsePassLogEvents(items, options = {}) {
        const { onlyNew = true, markSeen = true } = options;
        const parsed = items
            .map((item, index) => {
                const event = this.normalizePassLog(item);
                if (event) event.sourceIndex = index;
                return event;
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
                return a.sourceIndex - b.sourceIndex;
            });

        const logs = [];
        parsed.forEach((event) => {
            const key = this.getPassLogKey(event);
            if (onlyNew && this.passLogSeenKeys.has(key)) return;
            if (markSeen) this.passLogSeenKeys.add(key);
            logs.unshift(event);
        });

        return logs.slice(0, 8);
    },

    normalizePassLog(item) {
        if (!item || typeof item !== 'object') return null;

        const typeMap = {
            success: 'ok',
            warning: 'warn',
            info: 'info'
        };

        const actionType = String(item.action_type || 'info');
        const alarmCode = String(item.alarm_code || '');
        const time = String(item.time || this.formatHMS(new Date()));
        const personName = String(item.person_name || '未知人员');
        const personLevel = this.htmlToText(item.person_level_html || '');
        const deviceName = String(item.device_name || '未知设备');
        const deviceLevel = this.htmlToText(item.device_level_html || '');

        if (this.isIgnoredPassLog({ personName, personLevel, deviceName, deviceLevel, alarmCode })) {
            return null;
        }

        const result = this.evaluatePassLog({ actionType, alarmCode, personName, personLevel, deviceName, deviceLevel });
        const type = alarmCode === 'snap_prepass' ? 'ok' : (typeMap[actionType] || result.type || 'info');
        const detail = [
            `人员：${personName}${personLevel ? `（${personLevel}）` : ''}`,
            `设备：${deviceName}${deviceLevel ? `（${deviceLevel}）` : ''}`
        ].join(' | ');

        return {
            type,
            time,
            sortTime: this.timeToSeconds(time),
            actionType,
            alarmCode,
            personName,
            personLevel,
            deviceName,
            deviceLevel,
            title: result.title,
            message: result.message,
            detail
        };
    },

    evaluatePassLog(event) {
        if (event.alarmCode === 'fire_emergency_release') {
            return {
                type: 'ok',
                title: '火情应急放行',
                message: `${event.personName}在火情应急模式下可携带${event.deviceName}离开，门禁已开启。`
            };
        }

        if (event.alarmCode === 'snap_prepass' || event.alarmCode === '无设备通行') {
            return {
                type: 'ok',
                title: '人脸识别通过',
                message: '已入库人员，请通行'
            };
        }

        if (event.alarmCode === 'detecting') {
            return {
                type: 'info',
                title: '检测到设备',
                message: `已检测到${event.deviceLevel ? event.deviceLevel + ' ' : ''}${event.deviceName}，请等待监管系统响应`
            };
        }

        if (event.actionType === 'success') {
            return {
                type: 'ok',
                title: '人员设备认证通过',
                message: `${event.personName}可携带${event.deviceName}，认证通过，请通行。`
            };
        }

        if (event.actionType === 'warning') {
            return {
                type: 'warn',
                title: '人员设备认证告警',
                message: `${event.personName}携带${event.deviceName}未通过设备管控核验，请等待管理员处理。`
            };
        }

        return {
            type: 'info',
            title: '设备管控日志',
            message: '已接收应急通行设备管控系统日志'
        };
    },

    showPassEmergencyReleaseModal(event) {
        if (!event || event.alarmCode !== 'fire_emergency_release') return;
        const key = this.getPassLogKey(event);
        if (key && key === this.lastPassEmergencyReleaseModalKey) return;
        this.lastPassEmergencyReleaseModalKey = key || String(Date.now());

        const modal = this.ensurePassEmergencyReleaseModal();
        const time = this.escapeHtml(event.time || this.formatHMS(new Date()));
        const title = this.escapeHtml(event.title || '火情应急放行');
        const message = this.escapeHtml(event.message || '');
        const detail = this.escapeHtml(event.detail || '');

        modal.innerHTML = `
            <div class="yjy-pass-release-dialog ok" role="alertdialog" aria-live="assertive">
                <button class="yjy-pass-release-close" type="button" aria-label="关闭">×</button>
                <div class="yjy-pass-release-shell">
                    <div class="yjy-pass-release-kicker">应急通行设备管控信息</div>
                    <div class="yjy-pass-release-title">${title}</div>
                    <div class="yjy-pass-release-time">${time}</div>
                    <div class="yjy-pass-release-text">${message}</div>
                    <div class="yjy-pass-release-detail">${detail}</div>
                </div>
            </div>
        `;

        modal.classList.add('is-active');
        modal.querySelector('.yjy-pass-release-close')?.addEventListener('click', () => {
            this.hidePassEmergencyReleaseModal();
        });

        if (this.passEmergencyReleaseModalTimer) {
            window.clearTimeout(this.passEmergencyReleaseModalTimer);
        }
        this.passEmergencyReleaseModalTimer = window.setTimeout(() => {
            this.hidePassEmergencyReleaseModal();
        }, 6500);
    },

    ensurePassEmergencyReleaseModal() {
        let modal = document.getElementById('yjy-pass-release-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'yjy-pass-release-modal';
            modal.className = 'yjy-pass-release-modal';
            document.body.appendChild(modal);
        }
        return modal;
    },

    hidePassEmergencyReleaseModal() {
        if (this.passEmergencyReleaseModalTimer) {
            window.clearTimeout(this.passEmergencyReleaseModalTimer);
            this.passEmergencyReleaseModalTimer = null;
        }

        const modal = document.getElementById('yjy-pass-release-modal');
        if (!modal) return;
        const dialog = modal.querySelector('.yjy-pass-release-dialog');
        if (dialog) {
            dialog.classList.add('is-leaving');
            window.setTimeout(() => {
                modal.classList.remove('is-active');
                modal.innerHTML = '';
            }, 220);
        } else {
            modal.classList.remove('is-active');
            modal.innerHTML = '';
        }
    },

    renderPassLogs(items) {
        if (!this.els.env.devicePassLog) return;

        if (!items || !items.length) {
            this.renderPassLogPlaceholder();
            return;
        }

        this.els.env.devicePassLog.innerHTML = items
            .map((item) => {
                const cls = this.escapeHtml(item.type || 'info');
                const title = this.escapeHtml(item.title || '设备管控日志');
                const time = this.escapeHtml(item.time || '--:--:--');
                const message = this.escapeHtml(item.message || '');
                const detail = this.escapeHtml(item.detail || '');

                return `<div class="yjy-pass-log-item ${cls}" title="${message}">
                    <div class="yjy-pass-log-head">
                        <span>${title}</span>
                        <time>${time}</time>
                    </div>
                    <div class="yjy-pass-log-message">${message}</div>
                    <div class="yjy-pass-log-detail">${detail}</div>
                </div>`;
            })
            .join('');
        this.els.env.devicePassLog.scrollTop = 0;
    },

    renderPassLogPlaceholder(text = '[--:--:--] 等待设备管控日志...') {
        if (!this.els.env.devicePassLog) return;
        const safe = this.escapeHtml(text);
        this.els.env.devicePassLog.innerHTML = `<div class="yjy-pass-log-item info">${safe}</div>`;
    },

    getPassLogKey(event) {
        return [
            event.time,
            event.actionType,
            event.alarmCode,
            event.personName,
            event.deviceName
        ].join('|');
    },

    htmlToText(value) {
        const div = document.createElement('div');
        div.innerHTML = String(value || '');
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

    timeToSeconds(time) {
        const match = String(time || '').match(/(\d{1,2}):(\d{1,2}):(\d{1,2})/);
        if (!match) return Date.now() / 1000;
        return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    },

    sendDeviceFlag(device, isOn) {
        if (!device) return;
        const state = isOn ? 'on' : 'off';
        const url = `${this.deviceFlagEndpoint}?device=${encodeURIComponent(device)}&state=${encodeURIComponent(state)}`;
        fetch(url, { method: 'GET', cache: 'no-store' }).catch(() => {});
    },

    resetDeviceFlags() {
        this.sendDeviceFlag('beacon', false);
        this.sendDeviceFlag('valve', false);
    },

    // ===== 温湿度图表相关方法 =====
    
    formatHMS(d) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    },

    initSensorChart() {
        const chartDom = document.getElementById('yjy-sensor-chart');
        if (!chartDom) return;
        
        this.sensorChart = echarts.init(chartDom);
        
        // 初始化历史数据（最近6个数据点）
        for (let i = 0; i < 6; i++) {
            this.sensorHistory.temperature.push((22 + Math.random() * 6).toFixed(1));
            this.sensorHistory.humidity.push((50 + Math.random() * 30).toFixed(1));
            
            const time = new Date(Date.now() - (5 - i) * 3000);
            const timeStr = this.formatHMS(time);
            this.sensorHistory.timestamps.push(timeStr);
        }
        
        this.renderSensorChart();
        
        window.addEventListener('resize', () => {
            if (this.sensorChart) this.sensorChart.resize();
        });
    },

    // 渲染传感器图表（带阈值线）
    renderSensorChart() {
        if (!this.sensorChart) return;

        const timeLabels = this.sensorHistory.timestamps;
        
        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                borderColor: '#00d4ff',
                textStyle: { color: '#fff', fontSize: 11 },
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(255, 255, 255, 0.18)' } },
                formatter: (params) => {
                    const di = params?.[0]?.dataIndex ?? 0;
                    const t = this.sensorHistory.timestamps[di] || '--:--:--';
                    const lines = [`${t}`];
                    params.forEach(p => lines.push(`${p.marker}${p.seriesName}：${p.data}`));
                    return lines.join('<br/>');
                }
            },
            legend: {
                data: ['温度(°C)', '湿度(%)'],
                top: 4,
                textStyle: { color: 'rgba(255, 255, 255, 0.65)', fontSize: 11 }
            },
            grid: {
                left: '6%', right: '10%', top: '16%', bottom: '12%', containLabel: true
            },
            xAxis: {
                type: 'category',
                data: timeLabels,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.3)' } },
                axisTick: { show: false },
                axisLabel: { color: '#67c5ff', fontSize: 15, margin: 10, interval: 0, rotate: 0, hideOverlap: false }
            },
            yAxis: {
                type: 'value',
                name: '温/湿',
                nameTextStyle: { color: 'rgba(255, 255, 255, 0.55)', fontSize: 10 },
                nameGap: 8,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.18)' } },
                axisLabel: { color: 'rgba(255, 255, 255, 0.55)', fontSize: 10, margin: 12 },
                splitLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.08)' } }
            },
            series: [
                {
                    name: '温度(°C)',
                    type: 'line',
                    data: this.sensorHistory.temperature,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: { color: '#5eead4', width: 2 },
                    itemStyle: { color: '#5eead4' },
                    areaStyle: { color: 'rgba(94, 234, 212, 0.10)' },
                    markLine: {
                        silent: true,
                        symbol: ['none', 'none'],
                        label: { show: false },
                        data: [
                            { yAxis: this.thresholds.temperature.warning, lineStyle: { color: '#fbbf24', type: 'dashed' } },
                            { yAxis: this.thresholds.temperature.alert, lineStyle: { color: '#ef4444', type: 'dashed' } }
                        ]
                    },
                    markArea: {
                        silent: true,
                        itemStyle: { color: 'rgba(251, 191, 36, 0.08)' },
                        data: [[{ yAxis: this.thresholds.temperature.warning }, { yAxis: this.thresholds.temperature.alert }]]
                    }
                },
                {
                    name: '湿度(%)',
                    type: 'line',
                    data: this.sensorHistory.humidity,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: { color: '#60a5fa', width: 2 },
                    itemStyle: { color: '#60a5fa' },
                    areaStyle: { color: 'rgba(96, 165, 250, 0.08)' },
                    markLine: {
                        silent: true,
                        symbol: ['none', 'none'],
                        label: { show: false },
                        data: [
                            { yAxis: this.thresholds.humidity.warning, lineStyle: { color: '#fbbf24', type: 'dashed' } },
                            { yAxis: this.thresholds.humidity.alert, lineStyle: { color: '#ef4444', type: 'dashed' } }
                        ]
                    }
                }
            ]
        };
        
        this.sensorChart.setOption(option);
    },

    // 更新传感器数据
    updateSensorData() {
        const newTemp = (22 + Math.random() * 8).toFixed(1);
        const newHumidity = (45 + Math.random() * 40).toFixed(1);
        
        this.sensorHistory.temperature.push(newTemp);
        this.sensorHistory.humidity.push(newHumidity);
        
        const now = new Date();
        const timeStr = this.formatHMS(now);
        this.sensorHistory.timestamps.push(timeStr);
        
        // 只保留最近6个数据点
        if (this.sensorHistory.temperature.length > 6) {
            this.sensorHistory.temperature.shift();
            this.sensorHistory.humidity.shift();
            this.sensorHistory.timestamps.shift();
        }
        
        this.renderSensorChart();
    },

    // 启动定时更新
    startSensorUpdate() {
        if (this.sensorUpdateTimer) {
            window.clearInterval(this.sensorUpdateTimer);
        }
        this.sensorUpdateTimer = window.setInterval(() => {
            this.updateSensorData();
        }, 3000); // 每3秒更新一次
    },

    // 停止定时更新
    stopSensorUpdate() {
        if (this.sensorUpdateTimer) {
            window.clearInterval(this.sensorUpdateTimer);
            this.sensorUpdateTimer = null;
        }
    },

    updateSensorData() {
        fetch(`${this.envDataUrl}?t=${Date.now()}`, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => {
                const meta = this.normalizeEnvData(data);
                if (!meta) return;

                this.sensorHistory.temperature.push(meta.temperature == null ? null : meta.temperature.toFixed(1));
                this.sensorHistory.humidity.push(meta.humidity == null ? null : meta.humidity.toFixed(1));
                this.sensorHistory.timestamps.push(this.formatHMS(new Date()));

                while (this.sensorHistory.timestamps.length > 8) this.sensorHistory.timestamps.shift();
                while (this.sensorHistory.temperature.length > 8) this.sensorHistory.temperature.shift();
                while (this.sensorHistory.humidity.length > 8) this.sensorHistory.humidity.shift();

                this.renderEnvSummary(meta);
                this.renderSensorChart();
            })
            .catch(err => {
                console.error('[ENV] failed to load latest_env.json:', err);
            });
    },

    normalizeEnvData(data) {
        if (!data || typeof data !== 'object') return null;
        const tempBlock = data.temp_humidity && typeof data.temp_humidity === 'object' ? data.temp_humidity : {};
        const smokeBlock = data.smoke && typeof data.smoke === 'object' ? data.smoke : {};
        const num = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        return {
            time: data.env_collector_time || data.collector_time || '',
            temperature: num(data.temperature_c ?? tempBlock.temperature_c),
            humidity: num(data.humidity_rh ?? tempBlock.humidity_rh),
            dewpoint: num(data.dewpoint_c ?? tempBlock.dewpoint_c),
            smokePpm: num(data.smoke_ppm ?? smokeBlock.smoke_ppm),
            smokeState: String(data.smoke_mq2_state ?? data.smoke_state ?? smokeBlock.mq2_state ?? '--')
        };
    },

    renderEnvSummary(meta) {
        if (!meta) return;
        const setText = (el, value, unit = '') => {
            if (!el) return;
            el.textContent = value == null ? '--' : `${value}${unit}`;
        };
        setText(this.els.env.temp, meta.temperature == null ? null : meta.temperature.toFixed(1), '℃');
        setText(this.els.env.humi, meta.humidity == null ? null : meta.humidity.toFixed(1), '%');
        setText(this.els.env.dew, meta.dewpoint == null ? null : meta.dewpoint.toFixed(1), '℃');
        setText(this.els.env.smoke, meta.smokePpm == null ? meta.smokeState : `${meta.smokePpm.toFixed(2)}ppm`);
    },

    initSensorChart() {
        const chartDom = document.getElementById('yjy-sensor-chart');
        if (!chartDom) return;

        this.sensorChart = echarts.init(chartDom);
        this.sensorHistory.temperature = [];
        this.sensorHistory.humidity = [];
        this.sensorHistory.timestamps = [];
        this.renderSensorChart();

        window.addEventListener('resize', () => {
            if (this.sensorChart) this.sensorChart.resize();
        });
    },

    initSensorChart() {
        const chartDom = document.getElementById('yjy-sensor-chart');
        const smokeDom = document.getElementById('yjy-smoke-chart');
        if (chartDom) this.sensorChart = echarts.init(chartDom);
        if (smokeDom) this.smokeChart = echarts.init(smokeDom);

        this.sensorHistory.temperature = [];
        this.sensorHistory.humidity = [];
        this.sensorHistory.smoke = [];
        this.sensorHistory.timestamps = [];
        this.latestEnvDataKey = '';

        this.renderSensorChart();
        this.renderSmokeChart();

        window.addEventListener('resize', () => {
            if (this.sensorChart) this.sensorChart.resize();
            if (this.smokeChart) this.smokeChart.resize();
        });
    },

    getAdaptiveAxisRange(values, options = {}) {
        const nums = values
            .filter(v => v !== null && v !== undefined && v !== '')
            .map(v => Number(v))
            .filter(v => Number.isFinite(v));
        if (!nums.length) {
            return { min: options.min ?? 0, max: options.max ?? 10 };
        }

        const minValue = Math.min(...nums);
        const maxValue = Math.max(...nums);
        const baseSpan = Math.max(
            options.minSpan ?? 5,
            Math.abs(maxValue - minValue),
            Math.max(Math.abs(maxValue), 1) * (options.ratio ?? 0.18)
        );
        const rawMin = minValue - baseSpan * 0.45;
        const rawMax = maxValue + baseSpan * 0.55;
        const step = options.step ?? 1;
        const min = Math.max(options.floor ?? -Infinity, Math.floor(rawMin / step) * step);
        const max = Math.min(options.ceil ?? Infinity, Math.ceil(rawMax / step) * step);
        return max <= min ? { min: min - step, max: max + step } : { min, max };
    },

    renderSensorChart() {
        if (!this.sensorChart) return;

        const timeLabels = this.sensorHistory.timestamps.slice(-5);
        const tempValues = this.sensorHistory.temperature.slice(-5);
        const humiValues = this.sensorHistory.humidity.slice(-5);
        const axisRange = this.getAdaptiveAxisRange([...tempValues, ...humiValues], {
            floor: 0,
            ceil: 100,
            minSpan: 6,
            ratio: 0.14,
            step: 1
        });

        this.sensorChart.setOption({
            backgroundColor: 'transparent',
            animation: true,
            animationDuration: 450,
            animationDurationUpdate: 650,
            animationEasing: 'cubicOut',
            animationEasingUpdate: 'cubicOut',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.82)',
                borderColor: '#00d4ff',
                textStyle: { color: '#fff', fontSize: 11 },
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(255, 255, 255, 0.18)' } }
            },
            legend: {
                data: ['温度(°C)', '湿度(%)'],
                top: 0,
                right: 4,
                itemWidth: 14,
                itemHeight: 8,
                textStyle: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 16 }
            },
            grid: { left: 34, right: 12, top: 24, bottom: 20 },
            xAxis: {
                type: 'category',
                data: timeLabels,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.28)' } },
                axisTick: { show: false },
                axisLabel: { color: '#67c5ff', fontSize: 15, margin: 8, interval: 0, rotate: 0, hideOverlap: true }
            },
            yAxis: {
                type: 'value',
                min: axisRange.min,
                max: axisRange.max,
                splitNumber: 4,
                axisLabel: { color: 'rgba(255, 255, 255, 0.62)', fontSize: 9, margin: 8 },
                splitLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.08)' } }
            },
            series: [
                {
                    name: '温度(°C)',
                    type: 'line',
                    data: tempValues,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 5,
                    lineStyle: { color: '#5eead4', width: 2 },
                    itemStyle: { color: '#5eead4' },
                    areaStyle: { color: 'rgba(94, 234, 212, 0.10)' }
                },
                {
                    name: '湿度(%)',
                    type: 'line',
                    data: humiValues,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 5,
                    lineStyle: { color: '#60a5fa', width: 2 },
                    itemStyle: { color: '#60a5fa' },
                    areaStyle: { color: 'rgba(96, 165, 250, 0.08)' }
                }
            ]
        });
    },

    renderSmokeChart() {
        if (!this.smokeChart) return;

        const timeLabels = this.sensorHistory.timestamps.slice(-5);
        const smokeValues = this.sensorHistory.smoke.slice(-5);
        const axisRange = this.getAdaptiveAxisRange(smokeValues, {
            floor: 0,
            minSpan: 1,
            ratio: 0.18,
            step: 0.2
        });

        this.smokeChart.setOption({
            backgroundColor: 'transparent',
            animation: true,
            animationDuration: 450,
            animationDurationUpdate: 650,
            animationEasing: 'cubicOut',
            animationEasingUpdate: 'cubicOut',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.82)',
                borderColor: '#00d4ff',
                textStyle: { color: '#fff', fontSize: 11 }
            },
            legend: {
                data: ['烟感(ppm)'],
                top: 0,
                right: 4,
                itemWidth: 14,
                itemHeight: 8,
                textStyle: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 16 }
            },
            grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
            xAxis: {
                type: 'category',
                data: timeLabels,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.28)' } },
                axisTick: { show: false },
                axisLabel: { color: '#67c5ff', fontSize: 15, margin: 10, interval: 0, rotate: 0, hideOverlap: true }
            },
            yAxis: {
                type: 'value',
                min: axisRange.min,
                max: axisRange.max,
                splitNumber: 4,
                axisLabel: {
                    color: 'rgba(255, 255, 255, 0.62)',
                    fontSize: 9,
                    margin: 8,
                    formatter: value => `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)}`
                },
                splitLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.08)' } }
            },
            series: [
                {
                    name: '烟感(ppm)',
                    type: 'line',
                    data: smokeValues,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 5,
                    lineStyle: { color: '#f59e0b', width: 2 },
                    itemStyle: { color: '#f59e0b' },
                    areaStyle: { color: 'rgba(245, 158, 11, 0.12)' }
                }
            ]
        });
    },

    resetEnvPlayback() {
        this.envHistoryFiles = [];
        this.envHistoryIndex = 0;
        this.envHistoryLoading = null;
        this.latestEnvDataKey = '';
        this.sensorHistory.temperature = [];
        this.sensorHistory.humidity = [];
        this.sensorHistory.smoke = [];
        this.sensorHistory.timestamps = [];
        this.renderSensorChart();
        this.renderSmokeChart();
    },

    createMockEnvData() {
        const sampleIndex = this.sensorHistory.timestamps.length;
        const wave = Math.sin((Date.now() / 1000) + sampleIndex * 0.7);
        const drift = Math.cos((Date.now() / 1400) + sampleIndex * 0.45);
        const temperature = 28.5 + wave * 2.4 + Math.random() * 0.8;
        const humidity = 58 + drift * 9 + Math.random() * 2.5;
        const smokePpm = 4.2 + Math.max(0, wave) * 1.6 + Math.random() * 0.35;

        return {
            time: '',
            temperature,
            humidity,
            dewpoint: null,
            smokePpm,
            smokeState: smokePpm >= 5.4 ? 'warning' : 'normal'
        };
    },

    updateMockSensorData() {
        const meta = this.createMockEnvData();
        this.pushEnvDataPoint(meta, true);
    },

    getEnvHistoryFiles() {
        if (this.envHistoryLoading) return this.envHistoryLoading;

        this.envHistoryLoading = fetch(`${this.envHistoryListUrl}&t=${Date.now()}`, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(files => {
                this.envHistoryFiles = Array.isArray(files)
                    ? files.filter(name => typeof name === 'string' && name.toLowerCase().endsWith('.json'))
                    : [];
                this.envHistoryIndex = 0;
                return this.envHistoryFiles;
            })
            .catch(err => {
                this.envHistoryLoading = null;
                console.error('[ENV] failed to load env history list:', err);
                return [];
            });

        return this.envHistoryLoading;
    },

    updateSensorHistoryData() {
        this.getEnvHistoryFiles()
            .then(files => {
                if (!files.length) return;
                return this.readNextEnvHistoryFile(files);
            })
            .catch(err => {
                console.error('[ENV] failed to update history env data:', err);
            });
    },

    readNextEnvHistoryFile(files, attempts = 0) {
        if (!files.length || attempts >= files.length) return Promise.resolve();

        const fileName = files[this.envHistoryIndex % files.length];
        this.envHistoryIndex = (this.envHistoryIndex + 1) % files.length;
        const url = `${this.snapshotJsonBaseUrl}${encodeURIComponent(fileName)}?t=${Date.now()}`;

        return fetch(url, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => {
                const meta = this.normalizeEnvData(data);
                if (!this.hasCompleteEnvData(meta)) {
                    return this.readNextEnvHistoryFile(files, attempts + 1);
                }

                this.pushEnvDataPoint(meta, true);
            })
            .catch(() => this.readNextEnvHistoryFile(files, attempts + 1));
    },

    hasCompleteEnvData(meta) {
        if (!meta) return false;
        return meta.temperature != null
            && meta.humidity != null
            && meta.smokePpm != null;
    },

    pushEnvDataPoint(meta, useCurrentTime = false) {
        this.sensorHistory.temperature.push(meta.temperature == null ? null : Number(meta.temperature.toFixed(1)));
        this.sensorHistory.humidity.push(meta.humidity == null ? null : Number(meta.humidity.toFixed(1)));
        this.sensorHistory.smoke.push(meta.smokePpm == null ? null : Number(meta.smokePpm.toFixed(2)));
        this.sensorHistory.timestamps.push(useCurrentTime ? this.formatHMS(new Date()) : this.formatEnvChartTime(meta.time));

        while (this.sensorHistory.timestamps.length > 5) this.sensorHistory.timestamps.shift();
        while (this.sensorHistory.temperature.length > 5) this.sensorHistory.temperature.shift();
        while (this.sensorHistory.humidity.length > 5) this.sensorHistory.humidity.shift();
        while (this.sensorHistory.smoke.length > 5) this.sensorHistory.smoke.shift();

        this.renderEnvSummary(meta);
        this.renderSensorChart();
        this.renderSmokeChart();
    },

    updateSensorData() {
        if (this.envDataMode === 'mock') {
            this.updateMockSensorData();
            return;
        }

        if (this.envDataMode === 'history') {
            this.updateSensorHistoryData();
            return;
        }

        fetch(`${this.envDataUrl}?t=${Date.now()}`, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const etag = response.headers.get('ETag') || '';
                const lastModified = response.headers.get('Last-Modified') || '';
                return response.json().then(data => ({ data, etag, lastModified }));
            })
            .then(({ data, etag, lastModified }) => {
                const meta = this.normalizeEnvData(data);
                if (!meta) return;
                const dataKey = this.getEnvDataKey(meta, data, etag, lastModified);
                if (dataKey && dataKey === this.latestEnvDataKey) {
                    this.renderEnvSummary(meta);
                    return;
                }
                this.latestEnvDataKey = dataKey;

                this.pushEnvDataPoint(meta, false);
            })
            .catch(err => {
                console.error('[ENV] failed to load latest_env.json:', err);
            });
    },

    getEnvDataKey(meta, rawData, etag = '', lastModified = '') {
        const serverKey = meta.time || etag || lastModified;
        if (serverKey) return String(serverKey);
        return JSON.stringify({
            temperature: meta.temperature == null ? null : Number(meta.temperature.toFixed(3)),
            humidity: meta.humidity == null ? null : Number(meta.humidity.toFixed(3)),
            smokePpm: meta.smokePpm == null ? null : Number(meta.smokePpm.toFixed(3)),
            smokeState: meta.smokeState || '',
            rawTime: rawData?.time || rawData?.timestamp || rawData?.time_str || ''
        });
    },

    formatEnvChartTime(timeValue) {
        if (!timeValue) return this.formatHMS(new Date());
        const text = String(timeValue).trim();
        const hms = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
        if (hms) {
            return `${hms[1].padStart(2, '0')}:${hms[2]}:${hms[3]}`;
        }
        const date = new Date(text);
        if (!Number.isNaN(date.getTime())) {
            return this.formatHMS(date);
        }
        return text;
    },

    renderEnvSummary(meta) {
        if (!meta) return;
        const setText = (el, value, unit = '') => {
            if (!el) return;
            el.textContent = value == null ? '--' : `${value}${unit}`;
        };
        setText(this.els.env.temp, meta.temperature == null ? null : meta.temperature.toFixed(1), '℃');
        setText(this.els.env.humi, meta.humidity == null ? null : meta.humidity.toFixed(1), '%');
        setText(this.els.env.smoke, meta.smokePpm == null ? meta.smokeState : `${meta.smokePpm.toFixed(2)}ppm`);
    },

    deviceName(device) {
        const map = { beacon: '报警灯', valve: '水阀' };
        return map[device] || device;
    },

    playVideo(target) {
        if (!target?.video || !target.video.src) return;
        const p = target.video.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    },

    pauseVideo(target) {
        if (!target?.video) return;
        target.video.pause();
    },

    handleFireSnapshotMessage(rawText) {
        let data = null;
        try {
            data = JSON.parse(rawText);
        } catch (_) {
            return;
        }

        if (!data || data.type !== 'snapshot') return;
        this.upsertSnapshotRecord(data);
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
            fire_count: Number(record.fire_count || 0),
            image_base64: String(record.image_base64 || '')
        };

        const idx = this.snapshotRecords.findIndex((item) => item.event_id === next.event_id);
        if (idx >= 0) {
            this.snapshotRecords[idx] = next;
        } else {
            this.snapshotRecords.push(next);
        }

        this.snapshotRecords.sort((a, b) => {
            if (a.event_id !== b.event_id) return a.event_id - b.event_id;
            return a.timestamp - b.timestamp;
        });
    },

    renderSnapshotPlaceholder() {
        if (!this.els.capture.image || !this.els.capture.placeholder) return;
        this.els.capture.image.removeAttribute('src');
        this.els.capture.image.style.display = 'none';
        if (this.displayMode === 'snapshot') {
            this.els.capture.placeholder.style.display = 'flex';
        }
    },

    renderCaptureDataPlaceholder() {
        if (!this.els.capture.dataList || !this.els.capture.placeholder) return;
        const iconEl = this.els.capture.placeholder.querySelector('.yjy-placeholder-icon');
        const textEl = this.els.capture.placeholder.querySelector('.yjy-placeholder-text');
        const hintEl = this.els.capture.placeholder.querySelector('.yjy-placeholder-hint');
        this.els.capture.dataList.innerHTML = '';
        this.els.capture.dataList.style.display = 'none';
        if (this.displayMode === 'data') {
            this.els.capture.placeholder.style.display = 'flex';
            if (iconEl) iconEl.textContent = '📋';
            if (textEl) textEl.textContent = '实时检测结果';
            if (hintEl) hintEl.textContent = '点击“开始显示”后加载snapshot4数据';
        } else {
            if (iconEl) iconEl.textContent = '📷';
            if (textEl) textEl.textContent = '实时火灾截图';
            if (hintEl) hintEl.textContent = '';
        }
    },

    renderResultPlaceholder() {
        if (!this.els.logList) return;
        this.els.logList.innerHTML = `<div class="yjy-log-item">—</div>`;
    },

    renderSnapshotDisplay() {
        if (!this.els.capture.image || !this.els.capture.placeholder) return;
        if (!this.snapshotDisplayRunning || this.snapshotRecords.length === 0) {
            this.renderSnapshotPlaceholder();
            return;
        }

        // 只显示最新快照
        const snapshot = this.snapshotRecords[0];
        if (!snapshot?.image_base64) {
            this.renderSnapshotPlaceholder();
            return;
        }

        this.els.capture.image.src = `data:image/jpeg;base64,${snapshot.image_base64}`;
        this.els.capture.image.style.display = 'block';
        this.els.capture.placeholder.style.display = 'none';
    },

    renderResultBuffer() {
        if (!this.els.logList) return;
        if (!this.snapshotDisplayRunning || this.detectionRecords.length === 0) {
            this.renderResultPlaceholder();
            return;
        }

        const latestItems = this.detectionRecords.slice(0, 6);

        const rows = latestItems.map((item, idx) => {
            const fireDetected = item.isFire;
            const text = item.text;
            const safe = this.escapeHtml(text);
            const fireCls = fireDetected ? 'is-fire' : 'is-safe';
            return `<div class="yjy-log-item ${fireCls}" data-result-index="${idx}" title="${safe}">${safe}</div>`;
        });

        this.els.logList.innerHTML = rows.join('') || `<div class="yjy-log-item">—</div>`;
        this.els.logList.scrollTop = 0;
    },

    parseSnapshotInfo(filename) {
        const isFire = String(filename || '').toUpperCase().startsWith('FIRE');
        const match = String(filename || '').match(/_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
        const timeStr = match
            ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
            : this.formatHMS(new Date());

        return {
            filename,
            isFire,
            timeStr,
            text: isFire
                ? `[${timeStr}] 检测到火情，请立即处置！`
                : `[${timeStr}] 未检测到火情，监测正常。`
        };
    },

    renderCaptureDataRows() {
        if (!this.els.capture.dataList || !this.els.capture.placeholder || !this.els.capture.image) return;

        if (this.displayMode !== 'data') {
            this.els.capture.dataList.style.display = 'none';
            return;
        }

        if (!this.snapshotDisplayRunning || this.detectionRecords.length === 0) {
            this.renderCaptureDataPlaceholder();
            return;
        }

        const rows = this.detectionRecords.slice(0, 40).map((item) => {
            const cls = item.isFire ? 'is-fire' : 'is-safe';
            const safe = this.escapeHtml(item.text);
            return `<div class="yjy-capture-data-item ${cls}" title="${safe}">${safe}</div>`;
        });

        this.els.capture.image.style.display = 'none';
        this.els.capture.placeholder.style.display = 'none';
        this.els.capture.dataList.innerHTML = rows.join('');
        this.els.capture.dataList.style.display = 'flex';
        this.els.capture.dataList.scrollTop = 0;
    },

    syncCaptureToggleBtnText() {
        if (!this.els.capture.toggleModeBtn) return;
        this.els.capture.toggleModeBtn.textContent = this.displayMode === 'snapshot' ? '显示火灾数据' : '显示火灾截图';
    },

    toggleDisplayMode() {
        this.displayMode = this.displayMode === 'snapshot' ? 'data' : 'snapshot';
        this.syncCaptureToggleBtnText();
        if (this.displayMode === 'data') {
            this.renderCaptureDataRows();
        } else {
            this.showCurrentSnapshot();
        }
    },

    startDisplayUpdate() {
        this.stopDisplayUpdate();
        this.pollLatestSnapshot();
        this.displayUpdateTimer = window.setInterval(() => {
            if (this.snapshotDisplayRunning) this.pollLatestSnapshot();
        }, 2000);
        this.snapshotSlideTimer = window.setInterval(() => {
            if (this.snapshotDisplayRunning && this.displayMode === 'snapshot') this.showNextSnapshot();
        }, 1600);
    },

    stopDisplayUpdate() {
        if (this.displayUpdateTimer) {
            window.clearInterval(this.displayUpdateTimer);
            this.displayUpdateTimer = null;
        }
        if (this.snapshotSlideTimer) {
            window.clearInterval(this.snapshotSlideTimer);
            this.snapshotSlideTimer = null;
        }
    },

    loadRealSnapshots() {
        this.snapshotDisplayRunning = true;
        this.latestSnapshotFilename = '';
        this.snapshotQueue = [];
        this.seenSnapshotJson = new Set();
        this.currentSnapshotIndex = -1;
        this.detectionRecords = [];
        this.renderSnapshotPlaceholder();
        this.renderCaptureDataPlaceholder();
        this.startDisplayUpdate();
    },

    pollLatestSnapshot() {
        fetch(`${this.snapshotListUrl}&t=${Date.now()}`, { cache: 'no-store' })
            .then(response => response.json())
            .then(async (list) => {
                if (!Array.isArray(list) || list.length === 0) return;

                const nextJsonNames = list
                    .filter(name => typeof name === 'string' && !this.seenSnapshotJson.has(name))
                    .slice(-40);

                for (const jsonName of nextJsonNames) {
                    this.seenSnapshotJson.add(jsonName);
                    const record = await this.loadSnapshotRecord(jsonName);
                    if (!record) continue;
                    this.snapshotQueue.push(record);
                    this.detectionRecords.unshift(record);
                }

                this.snapshotQueue = this.snapshotQueue.slice(-60);
                this.detectionRecords = this.detectionRecords.slice(0, 80);

                if (this.currentSnapshotIndex < 0 && this.snapshotQueue.length > 0) {
                    this.currentSnapshotIndex = Math.max(0, this.snapshotQueue.length - 1);
                }

                this.renderResultBuffer();
                if (this.displayMode === 'data') {
                    this.renderCaptureDataRows();
                } else {
                    this.showCurrentSnapshot();
                }
            })
            .catch(err => {
                console.error('[ERROR] failed to load json4 snapshot list:', err);
            });
    },

    async loadSnapshotRecord(jsonName) {
        const safeJsonName = String(jsonName || '').split('/').pop();
        if (!safeJsonName || !safeJsonName.toLowerCase().endsWith('.json')) return null;

        let meta = {};
        try {
            const response = await fetch(`${this.snapshotJsonBaseUrl}${encodeURIComponent(safeJsonName)}?t=${Date.now()}`, { cache: 'no-store' });
            if (response.ok) meta = await response.json();
        } catch (_) {}

        const fallbackImage = safeJsonName.replace(/\.json$/i, '.jpg');
        const imageName = String(meta.image_name || fallbackImage);
        const parsed = this.parseSnapshotInfo(imageName, meta);
        parsed.jsonName = safeJsonName;
        parsed.imageName = imageName;
        parsed.imageUrl = `${this.snapshotImageBaseUrl}${encodeURIComponent(imageName)}`;
        return parsed;
    },

    showNextSnapshot() {
        if (!this.snapshotQueue.length) {
            this.renderSnapshotPlaceholder();
            return;
        }
        this.currentSnapshotIndex = (this.currentSnapshotIndex + 1) % this.snapshotQueue.length;
        this.showCurrentSnapshot();
    },

    showCurrentSnapshot() {
        if (!this.els.capture.image || !this.els.capture.placeholder || !this.els.capture.dataList) return;
        const current = this.snapshotQueue[this.currentSnapshotIndex] || this.snapshotQueue[this.snapshotQueue.length - 1];
        if (!current) {
            this.renderSnapshotPlaceholder();
            return;
        }
        this.els.capture.dataList.style.display = 'none';
        this.els.capture.image.src = `${current.imageUrl}?t=${Date.now()}`;
        this.els.capture.image.style.display = 'block';
        this.els.capture.placeholder.style.display = 'none';
    },

    renderSnapshotPlaceholder() {
        if (!this.els.capture.image || !this.els.capture.placeholder || !this.els.capture.dataList) return;
        this.els.capture.image.removeAttribute('src');
        this.els.capture.image.style.display = 'none';
        this.els.capture.dataList.style.display = 'none';
        if (this.displayMode === 'snapshot') this.els.capture.placeholder.style.display = 'flex';
    },

    renderCaptureDataPlaceholder() {
        if (!this.els.capture.dataList || !this.els.capture.placeholder) return;
        this.els.capture.dataList.innerHTML = '';
        this.els.capture.dataList.style.display = 'none';
        if (this.displayMode === 'data') this.els.capture.placeholder.style.display = 'flex';
    },

    parseSnapshotInfo(filename, meta = {}) {
        const imageName = String(filename || meta.image_name || '');
        const upper = imageName.toUpperCase();
        const isFire = upper.startsWith('FIRE');
        const isBoot = upper.startsWith('BOOT');
        const isPeriodic = upper.startsWith('PERIODIC');
        const match = imageName.match(/_(\d{8})-(\d{6})/);
        const timeStr = match
            ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)} ${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}`
            : this.formatHMS(new Date());
        const fireCount = Number(meta.fire_count || 0);
        const typeText = isFire ? '火情截图' : (isBoot ? '启动截图' : (isPeriodic ? '周期截图' : '检测截图'));

        return {
            filename: imageName,
            isFire,
            timeStr,
            fireCount,
            typeText,
            tempC: meta.temp_c || meta.temperature_c || '',
            humidity: meta.humidity_rh || '',
            dewpoint: meta.dewpoint_c || '',
            smokePpm: meta.smoke_ppm || '',
            smokeState: meta.smoke_state || meta.smoke_mq2_state || '',
            text: isFire
                ? `[${timeStr}] 检测到火情，火焰数量 ${fireCount || 1}`
                : `[${timeStr}] ${typeText}，未检测到火情`
        };
    },

    renderCaptureDataRows() {
        if (!this.els.capture.dataList || !this.els.capture.placeholder || !this.els.capture.image) return;

        this.els.capture.image.style.display = 'none';
        if (this.displayMode !== 'data') {
            this.els.capture.dataList.style.display = 'none';
            return;
        }

        if (!this.snapshotDisplayRunning || this.detectionRecords.length === 0) {
            this.renderCaptureDataPlaceholder();
            return;
        }

        const rows = this.detectionRecords.slice(0, 60).map((item) => {
            const cls = item.isFire ? 'is-fire' : 'is-safe';
            const title = this.escapeHtml(item.text);
            const detailParts = [
                item.tempC !== '' ? `温度 ${this.escapeHtml(item.tempC)}℃` : '',
                item.humidity !== '' ? `湿度 ${this.escapeHtml(item.humidity)}%` : '',
                item.smokePpm !== '' ? `烟感 ${this.escapeHtml(item.smokePpm)}ppm` : '',
                item.smokeState ? `状态 ${this.escapeHtml(item.smokeState)}` : ''
            ].filter(Boolean);
            const detail = detailParts.length ? `<div class="yjy-detection-meta">${detailParts.join(' / ')}</div>` : '';
            return `<div class="yjy-capture-data-item ${cls}" title="${title}">
                <div class="yjy-detection-main">${title}</div>
                <div class="yjy-detection-file">${this.escapeHtml(item.filename)}</div>
                ${detail}
            </div>`;
        });

        this.els.capture.placeholder.style.display = 'none';
        this.els.capture.dataList.innerHTML = rows.join('');
        this.els.capture.dataList.style.display = 'flex';
        this.els.capture.dataList.scrollTop = 0;
    },

    updateCaptureModeText() {
        const isSnapshot = this.displayMode === 'snapshot';
        if (this.els.capture.title) {
            this.els.capture.title.textContent = isSnapshot ? '火灾检测截图' : '火灾检测数据';
        }
        if (this.els.capture.toggleModeBtn) {
            this.els.capture.toggleModeBtn.textContent = isSnapshot ? '显示火灾数据' : '显示火灾截图';
        }
        if (this.els.capture.startAllBtn) {
            this.els.capture.startAllBtn.textContent = '开始显示';
        }
        if (this.els.capture.stopAllBtn) {
            this.els.capture.stopAllBtn.textContent = '结束显示';
        }
    },

    syncCaptureToggleBtnText() {
        this.updateCaptureModeText();
    },

    toggleDisplayMode() {
        this.displayMode = this.displayMode === 'snapshot' ? 'data' : 'snapshot';
        this.snapshotDisplayRunning = false;
        this.stopDisplayUpdate();
        this.updateCaptureModeText();

        if (this.displayMode === 'snapshot') {
            this.renderSnapshotPlaceholder();
        } else {
            this.renderCaptureDataPlaceholder();
        }
    },

    startDisplayUpdate() {
        this.stopDisplayUpdate();
        this.pollLatestSnapshot();
        this.displayUpdateTimer = window.setInterval(() => {
            if (this.snapshotDisplayRunning) this.pollLatestSnapshot();
        }, 1200);
    },

    stopDisplayUpdate() {
        if (this.displayUpdateTimer) {
            window.clearInterval(this.displayUpdateTimer);
            this.displayUpdateTimer = null;
        }
        if (this.snapshotSlideTimer) {
            window.clearInterval(this.snapshotSlideTimer);
            this.snapshotSlideTimer = null;
        }
    },

    loadRealSnapshots() {
        this.snapshotDisplayRunning = true;
        this.latestSnapshotFilename = '';
        this.latestSnapshotJsonName = '';
        this.snapshotQueue = [];
        this.currentSnapshotIndex = -1;
        this.detectionRecords = [];

        if (this.displayMode === 'snapshot') {
            this.renderSnapshotPlaceholder();
        } else {
            this.renderCaptureDataPlaceholder();
        }
        this.startDisplayUpdate();
    },

    pollLatestSnapshot() {
        fetch(`${this.snapshotListUrl}&t=${Date.now()}`, { cache: 'no-store' })
            .then(response => response.json())
            .then(async (list) => {
                if (!Array.isArray(list) || list.length === 0) {
                    await this.pollLatestSnapshotImageFallback();
                    return;
                }

                const latestJsonName = typeof list[0] === 'string' ? list[0] : '';
                if (!latestJsonName || latestJsonName === this.latestSnapshotJsonName) {
                    await this.pollLatestSnapshotImageFallback();
                    return;
                }

                const record = await this.loadSnapshotRecord(latestJsonName);
                if (!record) {
                    await this.pollLatestSnapshotImageFallback();
                    return;
                }

                this.applySnapshotRecord(record, { jsonName: latestJsonName });
            })
            .catch(err => {
                console.error('[ERROR] failed to load latest json4 snapshot:', err);
                this.pollLatestSnapshotImageFallback();
            });
    },

    async pollLatestSnapshotImageFallback() {
        try {
            const response = await fetch(`${this.snapshotImageListUrl}&t=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const list = await response.json();
            if (!Array.isArray(list) || list.length === 0) return;

            const latestImageName = typeof list[0] === 'string' ? list[0] : '';
            if (!latestImageName || latestImageName === this.latestSnapshotFilename) return;

            const record = this.createSnapshotRecordFromImage(latestImageName);
            this.applySnapshotRecord(record, { imageOnly: true });
        } catch (err) {
            console.error('[ERROR] failed to load snapshot4 image fallback:', err);
        }
    },

    createSnapshotRecordFromImage(imageName) {
        const safeImageName = String(imageName || '').split('/').pop();
        const record = this.parseSnapshotInfo(safeImageName, {});
        record.imageName = safeImageName;
        record.imageUrl = `${this.snapshotImageBaseUrl}${encodeURIComponent(safeImageName)}`;
        record.source = 'snapshot4';
        return record;
    },

    applySnapshotRecord(record, options = {}) {
        if (!record) return;

        if (options.jsonName) this.latestSnapshotJsonName = options.jsonName;
        this.latestSnapshotFilename = record.imageName || record.filename || '';
        this.snapshotQueue = [record];
        this.currentSnapshotIndex = 0;
        this.detectionRecords.unshift(record);
        this.detectionRecords = this.detectionRecords.slice(0, 80);
        this.renderResultBuffer();
        if (record.isFire) {
            this.handleFireEmergency(record);
        }

        if (this.displayMode === 'snapshot') {
            this.showCurrentSnapshot();
        } else {
            this.renderCaptureDataRows();
        }
    },

    showNextSnapshot() {
        this.showCurrentSnapshot();
    },

    showCurrentSnapshot() {
        if (!this.els.capture.image || !this.els.capture.placeholder || !this.els.capture.dataList) return;
        const current = this.snapshotQueue[0];
        if (!current) {
            this.renderSnapshotPlaceholder();
            return;
        }
        this.els.capture.dataList.style.display = 'none';
        this.els.capture.image.src = `${current.imageUrl}?t=${Date.now()}`;
        this.els.capture.image.style.display = 'block';
        this.els.capture.placeholder.style.display = 'none';
        if (current.isFire) {
            this.handleFireEmergency(current);
        }
    },

    setCapturePlaceholderMode(mode) {
        if (!this.els.capture.placeholder) return;

        const iconEl = this.els.capture.placeholder.querySelector('.yjy-placeholder-icon');
        const textEl = this.els.capture.placeholder.querySelector('.yjy-placeholder-text');
        const hintEl = this.els.capture.placeholder.querySelector('.yjy-placeholder-hint');

        if (mode === 'data') {
            if (iconEl) iconEl.style.display = 'none';
            if (textEl) textEl.textContent = '暂无火灾检测数据';
            if (hintEl) hintEl.textContent = '点击“开始显示”后接收实时检测结果';
            return;
        }

        if (iconEl) {
            iconEl.style.display = '';
            iconEl.textContent = '📷';
        }
        if (textEl) textEl.textContent = '实时火灾截图';
        if (hintEl) hintEl.textContent = '';
    },

    renderSnapshotPlaceholder() {
        if (!this.els.capture.image || !this.els.capture.placeholder || !this.els.capture.dataList) return;
        this.setCapturePlaceholderMode('snapshot');
        this.els.capture.image.style.display = this.snapshotQueue[0] && this.snapshotDisplayRunning ? 'block' : 'none';
        this.els.capture.dataList.style.display = 'none';
        if (this.displayMode === 'snapshot' && (!this.snapshotQueue[0] || !this.snapshotDisplayRunning)) {
            this.els.capture.placeholder.style.display = 'flex';
        } else {
            this.els.capture.placeholder.style.display = 'none';
        }
    },

    renderCaptureDataPlaceholder() {
        if (!this.els.capture.dataList || !this.els.capture.placeholder || !this.els.capture.image) return;
        this.els.capture.image.style.display = 'none';
        this.els.capture.dataList.innerHTML = '';
        this.els.capture.dataList.style.display = 'none';

        if (this.displayMode !== 'data') {
            return;
        }

        this.setCapturePlaceholderMode('data');
        if (!this.snapshotDisplayRunning || this.detectionRecords.length === 0) {
            this.els.capture.placeholder.style.display = 'flex';
        } else {
            this.els.capture.placeholder.style.display = 'none';
        }
    },

    parseSnapshotInfo(filename, meta = {}) {
        const imageName = String(filename || meta.image_name || '');
        const upper = imageName.toUpperCase();
        const isFire = upper.startsWith('FIRE');
        const isBoot = upper.startsWith('BOOT');
        const isPeriodic = upper.startsWith('PERIODIC');
        const match = imageName.match(/_(\d{8})-(\d{6})/);
        const timeStr = match
            ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)} ${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}`
            : this.formatHMS(new Date());
        const fireCount = Number(meta.fire_count || 0);
        const flameCount = fireCount > 0 ? fireCount : (isFire ? 1 : 0);
        const typeText = isFire ? '火情截图' : (isBoot ? '启动截图' : (isPeriodic ? '周期截图' : '检测截图'));
        const text = isFire
            ? `[${timeStr}] 检测到 ${flameCount} 处火焰，请立即处理！`
            : `[${timeStr}] 持续监测中，未发现火情异常。`;

        return {
            filename: imageName,
            isFire,
            timeStr,
            fireCount: flameCount,
            typeText,
            text
        };
    },

    renderCaptureDataRows() {
        if (!this.els.capture.dataList || !this.els.capture.placeholder || !this.els.capture.image) return;

        this.els.capture.image.style.display = 'none';
        if (this.displayMode !== 'data') {
            this.els.capture.dataList.style.display = 'none';
            return;
        }

        if (!this.snapshotDisplayRunning || this.detectionRecords.length === 0) {
            this.renderCaptureDataPlaceholder();
            return;
        }

        const rows = this.detectionRecords.slice(0, 60).map((item) => {
            const cls = item.isFire ? 'is-fire' : 'is-safe';
            const title = this.escapeHtml(item.text);
            return `<div class="yjy-capture-data-item ${cls}" title="${title}">
                <div class="yjy-detection-main">${title}</div>
            </div>`;
        });

        this.els.capture.placeholder.style.display = 'none';
        this.els.capture.dataList.innerHTML = rows.join('');
        this.els.capture.dataList.style.display = 'flex';
        this.els.capture.dataList.scrollTop = 0;
    },

    parseSnapshotInfo(filename, meta = {}) {
        const imageName = String(filename || meta.image_name || '');
        const upper = imageName.toUpperCase();
        const isFire = upper.startsWith('FIRE');
        const isBoot = upper.startsWith('BOOT');
        const isPeriodic = upper.startsWith('PERIODIC');
        const match = imageName.match(/_(\d{8})-(\d{6})/);
        const timeStr = match
            ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)} ${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}`
            : this.formatHMS(new Date());
        const fireCount = Number(meta.fire_count || meta.flame_count || meta.count || 0);
        const flameCount = fireCount > 0 ? fireCount : (isFire ? 1 : 0);
        const typeText = isFire ? '火情截图' : (isBoot ? '启动截图' : (isPeriodic ? '周期截图' : '检测截图'));
        const statusText = isFire ? '火情告警' : '正常监测';
        const message = isFire
            ? `检测到 ${flameCount} 处火焰，请立即处理！`
            : '持续监测中，未发现火情异常。';
        const subText = isFire
            ? '请立即核验现场画面，并执行应急处置流程。'
            : '系统正在读取最新截图，当前监测状态平稳。';
        const text = `[${timeStr}] ${message}`;

        return {
            filename: imageName,
            isFire,
            timeStr,
            fireCount: flameCount,
            typeText,
            statusText,
            message,
            subText,
            text
        };
    },

    renderCaptureDataRows() {
        if (!this.els.capture.dataList || !this.els.capture.placeholder || !this.els.capture.image) return;

        this.els.capture.image.style.display = 'none';
        if (this.displayMode !== 'data') {
            this.els.capture.dataList.style.display = 'none';
            return;
        }

        if (!this.snapshotDisplayRunning || this.detectionRecords.length === 0) {
            this.renderCaptureDataPlaceholder();
            return;
        }

        const rows = this.detectionRecords.slice(0, 60).map((item) => {
            const cls = item.isFire ? 'is-fire' : 'is-safe';
            const title = this.escapeHtml(item.text);
            const statusText = this.escapeHtml(item.statusText || (item.isFire ? '火情告警' : '正常监测'));
            const timeStr = this.escapeHtml(item.timeStr || '');
            const message = this.escapeHtml(item.message || item.text || '');
            const subText = this.escapeHtml(item.subText || '');
            return `<div class="yjy-capture-data-item ${cls}" title="${title}">
                <div class="yjy-detection-head">
                    <span class="yjy-detection-status">${statusText}</span>
                    <span class="yjy-detection-time">${timeStr}</span>
                </div>
                <div class="yjy-detection-message">${message}</div>
                <div class="yjy-detection-sub">${subText}</div>
            </div>`;
        });

        this.els.capture.placeholder.style.display = 'none';
        this.els.capture.dataList.innerHTML = rows.join('');
        this.els.capture.dataList.style.display = 'flex';
        this.els.capture.dataList.scrollTop = 0;
    },

    setLocalVideoFile(target, file) {
        if (!target?.video) return;

        this.clearLocalVideo(target);
        const url = URL.createObjectURL(file);
        target.objectUrl = url;
        target.video.src = url;
        target.video.load();

        const playPromise = target.video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }
    },

    clearLocalVideo(target) {
        if (!target?.video) return;

        if (target.objectUrl) {
            URL.revokeObjectURL(target.objectUrl);
            target.objectUrl = null;
        }
        target.video.removeAttribute('src');
        target.video.load();
    },

    formatTime(d) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    },

    addFireInfo(text, time = new Date()) {
        const line = `[${this.formatTime(time)}] ${String(text ?? '').trim()}`;
        if (!line.trim()) return;
        this.logs.unshift(line);
    },

    escapeHtml(s) {
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    },

    clearHistoryData() {
        this.snapshotRecords = [];
        this.detectionRecords = [];
    },

    handleFireEmergency(record = {}) {
        const key = [
            record.filename || record.imageName || '',
            record.timeStr || '',
            record.fireCount || ''
        ].join('|');

        if (key && key === this.lastFireEmergencyKey) {
            return;
        }
        this.lastFireEmergencyKey = key || String(Date.now());

        this.showFireEmergencyAlerts();
        this.activateEmergencyDevices();
        this.showDeviceFireAccessAlert(record);
    },

    showDeviceFireAccessAlert(record = {}) {
        if (!this.isDeviceLinkageActive()) return;

        const key = [
            record.filename || record.imageName || '',
            record.timeStr || '',
            record.fireCount || ''
        ].join('|') || String(Date.now());

        if (key === this.lastDeviceFireAccessKey) {
            return;
        }
        this.lastDeviceFireAccessKey = key;

        const stage = this.els.overview.wsFrame?.closest('.yjy-video-stage')
            || this.els.overview.video?.closest('.yjy-video-stage');
        if (!stage) return;

        let alert = stage.querySelector('.yjy-device-fire-access-alert');
        if (!alert) {
            alert = document.createElement('div');
            alert.className = 'yjy-device-fire-access-alert';
            alert.setAttribute('role', 'alert');
            alert.setAttribute('aria-live', 'assertive');
            stage.appendChild(alert);
        }

        alert.innerHTML = `
            <div class="yjy-device-fire-access-kicker">应急通行联动</div>
            <div class="yjy-device-fire-access-title">收到工厂内部火灾警报</div>
            <div class="yjy-device-fire-access-text">门禁已开启，请人员尽快离开</div>
        `;
        alert.classList.add('show');

        if (this.deviceFireAccessTimer) {
            window.clearTimeout(this.deviceFireAccessTimer);
        }
        this.deviceFireAccessTimer = window.setTimeout(() => {
            this.hideDeviceFireAccessAlert();
        }, 5000);
    },

    hideDeviceFireAccessAlert() {
        if (this.deviceFireAccessTimer) {
            window.clearTimeout(this.deviceFireAccessTimer);
            this.deviceFireAccessTimer = null;
        }

        const alert = document.querySelector('.yjy-device-fire-access-alert');
        if (alert) {
            alert.classList.remove('show');
        }
    },

    showFireEmergencyAlerts() {
        const stack = this.ensureFireAlertStack();
        stack.innerHTML = [
            {
                label: '火情告警',
                title: '检测到工厂内部发生火情',
                message: '警报灯已打开'
            },
            {
                label: '应急处置',
                title: '灭火水阀已开启',
                message: '人员尽快离开危险区域'
            }
        ].map((item) => `
            <div class="yjy-fire-alert-card">
                <div class="yjy-fire-alert-label">${item.label}</div>
                <div class="yjy-fire-alert-title">${item.title}</div>
                <div class="yjy-fire-alert-message">${item.message}</div>
            </div>
        `).join('');
        stack.classList.add('show');

        if (this.fireAlertTimer) {
            window.clearTimeout(this.fireAlertTimer);
        }
        this.fireAlertTimer = window.setTimeout(() => {
            stack.classList.remove('show');
            stack.innerHTML = '';
            this.fireAlertTimer = null;
        }, 3000);
    },

    ensureFireAlertStack() {
        let stack = document.getElementById('yjy-fire-alert-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'yjy-fire-alert-stack';
            stack.className = 'yjy-fire-alert-stack';
            document.body.appendChild(stack);
        }
        return stack;
    },

    activateEmergencyDevices() {
        // ★ FIRE 自动触发：仅更新 UI，不上传服务器（sendDeviceFlag / cloud POST 均跳过）
        this.setDeviceStatus('beacon', true);
        this.setDeviceStatus('valve', true);

        // ★ 记录最近一次 FIRE 自动触发的时间戳（供 yingjijiuyuan2.html 手动点击逻辑判断）
        window.__lastFireAutoTime = Date.now();

        if (this.fireEmergencyTimer) {
            window.clearTimeout(this.fireEmergencyTimer);
        }
        this.fireEmergencyTimer = window.setTimeout(() => {
            // ★ 10 秒后自动恢复关闭（仅 UI，不上传）
            this.setDeviceStatus('beacon', false);
            this.setDeviceStatus('valve', false);
            this.fireEmergencyTimer = null;
        }, 10000);
    },

    setEmergencyDeviceState(device, isOn) {
        this.setDeviceStatus(device, isOn);
        this.sendDeviceFlag(device, isOn);
    },

    setDeviceStatus(device, isOn) {
        const on = Boolean(isOn);

        const card = document.querySelector(`.yjy-linkage-card[data-device="${device}"]`);
        if (card) {
            const optOn = card.querySelector('.yjy-linkage-option[data-state="on"]');
            const optOff = card.querySelector('.yjy-linkage-option[data-state="off"]');
            if (optOn) optOn.classList.toggle('active', on);
            if (optOff) optOff.classList.toggle('active', !on);
        }

        const row = document.querySelector(`.linkage-table-row[data-device="${device}"]`);
        if (row) {
            const btnOn = row.querySelector('.linkage-status-btn[data-state="on"]');
            const btnOff = row.querySelector('.linkage-status-btn[data-state="off"]');
            if (btnOn) btnOn.classList.toggle('active', on);
            if (btnOff) btnOff.classList.toggle('active', !on);
        }

        return on;
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => YingJiJiuYuanScene.init());
} else {
    YingJiJiuYuanScene.init();
}

window.YingJiJiuYuanAPI = {
    addFireInfo: (text, time) => YingJiJiuYuanScene.addFireInfo(text, time),
    setDeviceStatus: (device, isOn) => YingJiJiuYuanScene.setDeviceStatus(device, isOn)
};

window.onLinkageChange = (device, state) => {
    if (device !== 'beacon' && device !== 'valve') return;
    YingJiJiuYuanScene.sendDeviceFlag(device, state === 'on');
};
