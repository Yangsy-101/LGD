/**
 * 森林火灾场景专用脚本
 */

// 生成最近12小时的时间标签
function generateTimeLabels() {
    const labels = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
        const time = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hour = time.getHours();
        labels.push(`${hour}:00`);
    }
    return labels;
}

// 生成模拟的传感器数据（模拟真实波动）
function generateSensorData(baseValue, range, trend = 0) {
    const data = [];
    let current = baseValue;
    for (let i = 0; i < 12; i++) {
        // 添加随机波动
        const randomChange = (Math.random() - 0.5) * range;
        // 添加趋势
        const trendChange = trend * i / 12;
        current = baseValue + randomChange + trendChange;
        // 确保数值在合理范围内
        data.push(Math.round(current * 10) / 10);
    }
    return data;
}

// 两个地区的数据配置
const LOCATION_DATA = {
    haikou: {
        name: '海口',
        camera: '海口森林监控摄像头实时画面',
        capture: '海口最新抓拍图片 - ' + new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        light: '光照强度：8500 Lux\n天气：晴朗\n能见度：优秀',
        // 检测日志
        detectionLogs: [],
        // 温湿度数据 - 海口较热，湿度变化较大（海边城市）
        temperatureData: generateSensorData(28, 3, -1),  // 基准28°C，波动±3°C，略微下降趋势
        humidityData: generateSensorData(65, 15, 5),     // 基准65%，波动±15%，上升趋势（海边湿度变化大）
        // 烟感数据 - PM2.5数据
        smokeData: generateSensorData(35, 8, 2)          // 基准35，波动±8，略微上升
    },
    nanjing: {
        name: '南京溧水',
        camera: '南京溧水森林监控摄像头实时画面',
        capture: '南京溧水最新抓拍图片 - ' + new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        light: '光照强度：6200 Lux\n天气：多云\n能见度：良好',
        // 检测日志
        detectionLogs: [],
        // 温湿度数据 - 南京较冷，湿度变化适中
        temperatureData: generateSensorData(12, 2.5, 1.5), // 基准12°C，波动±2.5°C，上升趋势（白天升温）
        humidityData: generateSensorData(58, 12, -3),      // 基准58%，波动±12%，下降趋势（白天湿度降低）
        // 烟感数据 - PM2.5数据
        smokeData: generateSensorData(28, 6, -1)           // 基准28，波动±6，略微下降
    }
};

// 图表实例
let temperatureChart = null;
let smokeChart = null;
let lightChart = null;
let windChart = null;

// 火情模拟状态
const FireSimState = {
    fireDetected: false,      // 是否检测到火情图片
    sensorOverThreshold: 0,   // 传感器超阈值百分比 (0, 20, 40+)
    commFailed: false,        // 通信故障
    alertLevel: 'none',       // none / low / medium / high
    imageScore: 0,
    sensorScore: 0,
    fusionScore: 0,
    latestFireImage: '',
    sensorSnapshot: null
};

// 场景数据管理
const ForestFireScene = {
    currentLocation: 'nanjing', // 默认选择南京溧水
    isDetecting: false,        // 检测状态
    isShowingResult: false,    // 是否正在展示结果
    lastProcessedImage: null,  // 记录上一张处理的最新图片，避免重复刷新
    autoUpdateTimer: null,     // 自动更新定时器
    currentLightValue: 8500,   // 当前光照值
    currentWindValue: 4.5,     // 当前风速值
    lightLogTimer: null,
    lightLogEndpoint: 'http://36.152.33.88:8081/media/get_recv_logs.jsp',
    latestLightLogLine: '',
    usingRealLightValue: false,
    linkWarningTimer: null,
    linkWarningAutoCloseTimer: null,
    lastAlarmTimestampMs: 0,
    
    // 初始化场景
    init() {
        console.log('森林火灾场景初始化...');
        this.initButtons();
        this.initKeyboardShortcuts();
        this.initCharts();
        this.setCommMode('5g');
        this.updateContent(this.currentLocation);
        
        // 页面加载后自动开始更新数据
        this.startAutoUpdate();
    },
    
    // 初始化图表
    initCharts() {
        // 初始化温湿度图表
        const tempChartDom = document.getElementById('temperature-chart');
        if (tempChartDom) {
            temperatureChart = echarts.init(tempChartDom);
        }
        
        // 初始化烟感图表
        const smokeChartDom = document.getElementById('smoke-chart');
        if (smokeChartDom) {
            smokeChart = echarts.init(smokeChartDom);
        }
        
        // 初始化光照图表
        const lightChartDom = document.getElementById('light-chart');
        if (lightChartDom) {
            lightChart = echarts.init(lightChartDom);
        }
        
        // 初始化风速图表
        const windChartDom = document.getElementById('wind-chart');
        if (windChartDom) {
            windChart = echarts.init(windChartDom);
            console.log('风速图表初始化成功');
        } else {
            console.log('风速图表容器未找到');
        }
        
        // 延迟resize确保图表正确渲染
        setTimeout(() => {
            if (lightChart) lightChart.resize();
            if (windChart) windChart.resize();
        }, 100);
    },

    // 初始化按钮事件
    initButtons() {
        // 地区切换按钮
        const haikouBtn = document.getElementById('btn-haikou');
        const nanjingBtn = document.getElementById('btn-nanjing');

        if (haikouBtn) {
            haikouBtn.addEventListener('click', () => {
                this.switchLocation('haikou');
            });
        }

        if (nanjingBtn) {
            nanjingBtn.addEventListener('click', () => {
                this.switchLocation('nanjing');
            });
        }

        const startDetectBtn = document.getElementById('btn-start-detect');
        const stopDetectBtn = document.getElementById('btn-stop-detect');
        const showResultBtn = document.getElementById('btn-show-result');
        const streamCanvas = document.getElementById('streamCanvas');
        const cameraPlaceholder = document.getElementById('camera-placeholder');

        const playerState = {
            playing: false,
            streamUrl: 'http://36.152.33.88:8081/media/video1/get_image1.jsp',
            canvas: streamCanvas,
            placeholder: cameraPlaceholder,
            ctx: streamCanvas ? streamCanvas.getContext("2d", { alpha: false }) : null,
            frameSeq: 0,
            lastServerSeq: 0,
            frameTimer: null,
            loadTimer: null,
            fetchAbort: null,
            objectUrl: null,
            frameDelay: 0,
            retryDelay: 120,
            frameTimeout: 3500,
            lastWidth: 0,
            lastHeight: 0
        };

        function scheduleNextFrame(delay = 0) {
            if (!playerState.playing) return;
            playerState.frameTimer = window.setTimeout(loadNextFrame, delay);
        }

        function clearFrameLoadTimer() {
            if (playerState.loadTimer) {
                window.clearTimeout(playerState.loadTimer);
                playerState.loadTimer = null;
            }
        }

        function resizeCanvasToFrame(width, height) {
            if (!playerState.canvas || width <= 0 || height <= 0) return;
            if (playerState.lastWidth !== width || playerState.lastHeight !== height) {
                playerState.canvas.width = width;
                playerState.canvas.height = height;
                playerState.lastWidth = width;
                playerState.lastHeight = height;
                playerState.ctx = playerState.canvas.getContext("2d", { alpha: false });
            }
        }

        function showCanvasFrame() {
            if (playerState.canvas) playerState.canvas.style.display = "block";
            if (playerState.placeholder) playerState.placeholder.style.display = "none";
        }

        function drawBlobByImage(blob, requestSeq) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                const nextUrl = URL.createObjectURL(blob);
                const prevUrl = playerState.objectUrl;
                playerState.objectUrl = nextUrl;

                img.onload = function () {
                    if (!playerState.playing || playerState.frameSeq !== requestSeq) {
                        URL.revokeObjectURL(nextUrl);
                        reject(new Error("stale frame"));
                        return;
                    }
                    resizeCanvasToFrame(this.naturalWidth || this.width, this.naturalHeight || this.height);
                    playerState.ctx.drawImage(this, 0, 0, playerState.canvas.width, playerState.canvas.height);
                    if (prevUrl) URL.revokeObjectURL(prevUrl);
                    showCanvasFrame();
                    resolve();
                };
                img.onerror = function () {
                    URL.revokeObjectURL(nextUrl);
                    if (playerState.objectUrl === nextUrl) playerState.objectUrl = prevUrl || null;
                    reject(new Error("image decode failed"));
                };
                img.src = nextUrl;
            });
        }

        async function drawFrameBlob(blob, requestSeq) {
            if (typeof createImageBitmap === "function") {
                const bitmap = await createImageBitmap(blob);
                try {
                    if (!playerState.playing || playerState.frameSeq !== requestSeq) return;
                    resizeCanvasToFrame(bitmap.width, bitmap.height);
                    playerState.ctx.drawImage(bitmap, 0, 0, playerState.canvas.width, playerState.canvas.height);
                    showCanvasFrame();
                } finally {
                    bitmap.close();
                }
                return;
            }

            await drawBlobByImage(blob, requestSeq);
        }

        function loadNextFrame() {
            if (!playerState.playing || !playerState.canvas || !playerState.ctx) return;

            const requestSeq = (playerState.frameSeq || 0) + 1;
            playerState.frameSeq = requestSeq;

            if (playerState.fetchAbort) {
                playerState.fetchAbort.abort();
                playerState.fetchAbort = null;
            }

            const controller = new AbortController();
            playerState.fetchAbort = controller;
            clearFrameLoadTimer();
            playerState.loadTimer = window.setTimeout(() => {
                if (!playerState.playing || playerState.frameSeq !== requestSeq) return;
                controller.abort();
            }, playerState.frameTimeout);

            const frameUrl = `${playerState.streamUrl}?t=${Date.now()}&seq=${requestSeq}&wait=1&timeout=1200&since=${encodeURIComponent(playerState.lastServerSeq || 0)}`;

            fetch(frameUrl, { cache: "no-store", signal: controller.signal })
                .then((response) => {
                    if (!playerState.playing || playerState.frameSeq !== requestSeq) return null;
                    clearFrameLoadTimer();
                    playerState.fetchAbort = null;

                    if (response.status === 204) {
                        scheduleNextFrame(50);
                        return null;
                    }

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const serverSeq = Number(response.headers.get("X-Frame-Seq") || 0);
                    if (serverSeq > 0 && serverSeq === playerState.lastServerSeq) {
                        scheduleNextFrame(30);
                        return null;
                    }
                    if (serverSeq > 0) playerState.lastServerSeq = serverSeq;
                    return response.blob();
                })
                .then((blob) => {
                    if (!blob || !playerState.playing || playerState.frameSeq !== requestSeq) return false;
                    if (blob.size <= 0) {
                        scheduleNextFrame(playerState.retryDelay);
                        return false;
                    }
                    return drawFrameBlob(blob, requestSeq).then(() => true);
                })
                .then((drawn) => {
                    if (!drawn || !playerState.playing || playerState.frameSeq !== requestSeq) return;
                    scheduleNextFrame(playerState.frameDelay);
                })
                .catch((err) => {
                    if (!playerState.playing || playerState.frameSeq !== requestSeq) return;
                    clearFrameLoadTimer();
                    playerState.fetchAbort = null;
                    scheduleNextFrame(err && err.name === "AbortError" ? 180 : playerState.retryDelay);
                });
        }

        if (startDetectBtn) {
            startDetectBtn.addEventListener('click', () => {
                if (playerState.playing) return;
                playerState.playing = true;
                playerState.lastServerSeq = 0;
                ForestFireScene.addLogEntry("开始从外部视频源获取视频拉流...", "info");
                loadNextFrame();
            });
        }

        if (stopDetectBtn) {
            stopDetectBtn.addEventListener('click', () => {
                playerState.playing = false;
                if (playerState.frameTimer) {
                    clearTimeout(playerState.frameTimer);
                    playerState.frameTimer = null;
                }
                clearFrameLoadTimer();
                if (playerState.fetchAbort) {
                    playerState.fetchAbort.abort();
                    playerState.fetchAbort = null;
                }
                if (playerState.objectUrl) {
                    URL.revokeObjectURL(playerState.objectUrl);
                    playerState.objectUrl = null;
                }
                if(playerState.canvas) playerState.canvas.style.display = "none";
                if(playerState.placeholder) playerState.placeholder.style.display = "flex";
                ForestFireScene.addLogEntry("结束外部视频拉流", "info");
                
                // 停止检测后清除结果显示
                ForestFireScene.isShowingResult = false;
                ForestFireScene.stopLightLogPolling();
                ForestFireScene.lastProcessedImage = null;
                const resultImg = document.getElementById('result-snapshot-img');
                if (resultImg) resultImg.style.display = 'none';
                const capturePlaceholder = document.getElementById('capture-placeholder');
                if (capturePlaceholder) capturePlaceholder.style.display = 'flex';
                ForestFireScene.clearFire();
            });
        }

        if (showResultBtn) {
            showResultBtn.addEventListener('click', () => {
                if (ForestFireScene.isShowingResult) return;
                ForestFireScene.isShowingResult = true;
                ForestFireScene.lastProcessedImage = null; // 重置，强制首次立刻获取
                ForestFireScene.addLogEntry("开启实时检测结果轮询获取模式...", "info");
                const captureView = document.getElementById('capture-view');
                if (captureView) {
                    let resultImg = document.getElementById('result-snapshot-img');
                    if (!resultImg) {
                        resultImg = document.createElement('img');
                        resultImg.id = 'result-snapshot-img';
                        resultImg.style.width = '100%';
                        resultImg.style.height = '100%';
                        resultImg.style.objectFit = 'contain';
                        captureView.appendChild(resultImg);
                    }
                }
                const logContainer = document.getElementById('detection-log');
                if (logContainer) logContainer.innerHTML = '';
                
                ForestFireScene.fetchAndShowDetectionResult();
                ForestFireScene.startLightLogPolling();
            });
        }
    },

    initKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            const key = (event.key || '').toLowerCase();
            if (event.repeat) return;
            if (event.ctrlKey && event.shiftKey && key === 'x') {
                event.preventDefault();
                this.triggerLinkExceptionAlarm();
                return;
            }
            if (event.ctrlKey && event.shiftKey && key === 'z') {
                event.preventDefault();
                this.triggerLinkRecovery();
            }
        });
    },

    applyCommState(state) {
        const indicator5g = document.getElementById('comm-indicator-5g');
        const indicatorTiantong = document.getElementById('comm-indicator-tiantong');
        const indicatorShortwave = document.getElementById('comm-indicator-shortwave');
        const indicators = {
            '5g': indicator5g,
            tiantong: indicatorTiantong,
            shortwave: indicatorShortwave
        };

        Object.keys(indicators).forEach((key) => {
            const el = indicators[key];
            if (!el) return;
            const isOnline = Boolean(state[key]);
            el.classList.toggle('online', isOnline);
            const item = el.closest('.comm-method-item');
            if (item) item.classList.toggle('active-route', isOnline);
        });
    },

    setCommMode(mode) {
        const state = {
            '5g': false,
            tiantong: false,
            shortwave: false
        };
        if (Object.prototype.hasOwnProperty.call(state, mode)) {
            state[mode] = true;
        }
        this.applyCommState(state);
    },

    setCommRecoveryState() {
        this.applyCommState({
            '5g': true,
            tiantong: false,
            shortwave: true
        });
    },

    formatPreciseTimestamp(date = new Date()) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mi = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
    },

    showLinkPopup(config) {
        const toastId = 'link-warning-toast';
        let toast = document.getElementById(toastId);

        if (!toast) {
            toast = document.createElement('div');
            toast.id = toastId;
            toast.className = 'link-warning-toast';
            toast.innerHTML = `
                <div class="link-warning-card" id="link-warning-card" role="alert" aria-live="assertive">
                    <div class="link-warning-header">
                        <span class="link-warning-icon" id="link-warning-icon">!</span>
                        <span id="link-warning-title">链路异常告警</span>
                    </div>
                    <div class="link-warning-message" id="link-warning-message"></div>
                </div>
            `;
            document.body.appendChild(toast);
        }

        const cardEl = document.getElementById('link-warning-card');
        const iconEl = document.getElementById('link-warning-icon');
        const titleEl = document.getElementById('link-warning-title');
        const messageEl = document.getElementById('link-warning-message');

        const popupState = config && config.state === 'recovery' ? 'state-recovery' : 'state-warning';
        if (cardEl) {
            cardEl.classList.remove('state-warning', 'state-recovery');
            cardEl.classList.add(popupState);
        }
        if (iconEl) iconEl.textContent = config.icon || '!';
        if (titleEl) titleEl.textContent = config.title || '链路异常告警';

        const tsMs = config.timestampMs || Date.now();
        const timestamp = this.formatPreciseTimestamp(new Date(tsMs));
        if (messageEl) {
            messageEl.innerHTML = `
                <div class="link-warning-message-main">${config.mainMessage || ''}</div>
                <div class="link-warning-message-sub">${config.subMessage || ''}</div>
                <div class="link-warning-statusbar">${config.statusMessage || ''}</div>
                <span class="link-warning-timestamp">[发生时间: ${timestamp}]</span>
            `;
        }

        clearTimeout(this.linkWarningTimer);
        clearTimeout(this.linkWarningAutoCloseTimer);

        toast.classList.add('show');
        const closeDelay = 5000 + Math.floor(Math.random() * 3001); // 5-8秒
        this.linkWarningAutoCloseTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, closeDelay);
    },

    showLinkWarningPopup(timestampMs) {
        this.showLinkPopup({
            state: 'warning',
            icon: '!',
            title: '链路异常告警',
            mainMessage: '检测到5G链路物理级阻断，系统已自动执行智能接入策略。',
            subMessage: '当前数据通道已切换为短波通信模块，链路带宽进入降级运行模式，核心监测数据保持连续同步。',
            statusMessage: '当前系统状态: 短波信道降级运行中，关键数据同步正常。',
            timestampMs
        });
    },

    showLinkRecoveryPopup(timestampMs) {
        this.showLinkPopup({
            state: 'recovery',
            icon: '✓',
            title: '✅ 链路重连成功',
            mainMessage: '系统检测到主链路(5G)物理信号已恢复，握手协议执行完毕。',
            subMessage: '链路仲裁器已自动将数据通道无缝切回高带宽模式。业务流全面恢复常态，端到端延迟指标已达到最优。',
            statusMessage: '当前系统状态: 5G信道全速运行中，宽带网络已接管。',
            timestampMs
        });
    },

    triggerLinkExceptionAlarm() {
        const alarmTs = Date.now();
        this.lastAlarmTimestampMs = alarmTs;
        this.setCommMode('shortwave');
        FireSimState.commFailed = true;
        this.showLinkWarningPopup(alarmTs);

        const timestamp = this.formatPreciseTimestamp(new Date(alarmTs));
        this.addLogEntry(`⚠ 链路异常触发，已切换到短波通信模块 [发生时间: ${timestamp}]`, 'warning');
    },

    triggerLinkRecovery() {
        const now = Date.now();
        const recoveryTs = Math.max(now, this.lastAlarmTimestampMs + 1);

        this.setCommRecoveryState();
        FireSimState.commFailed = false;
        this.showLinkRecoveryPopup(recoveryTs);

        const timestamp = this.formatPreciseTimestamp(new Date(recoveryTs));
        this.addLogEntry(`✓ 链路恢复完成，系统切回5G主链路高带宽模式 [发生时间: ${timestamp}]`, 'success');
    },
    
    // 显示检测结果数据
    fetchAndShowDetectionResult() {
        if (!this.isShowingResult) return;

        const captureView = document.getElementById('capture-view');
        const logContainer = document.getElementById('detection-log');

        fetch('http://36.152.33.88:8081/media/list_images.jsp?folder=snapshot1')
            .then(response => response.json())
            .then(files => {
                if (!Array.isArray(files) || files.length === 0) {
                    return;
                }

                // 取最新的图片展示
                const latestImg = files[0];
                
                // 如果最新的图片没变，就无需更新，继续等待下一张新图片
                if (this.lastProcessedImage === latestImg) {
                    return;
                }

                // 新的图片到达了，进行处理和渲染
                this.lastProcessedImage = latestImg;
                const snapshotUrl = `http://36.152.33.88:8081/media/snapshot1/${latestImg}`;
                
                let resultImg = document.getElementById('result-snapshot-img');
                if (resultImg) {
                    resultImg.src = snapshotUrl + "?t=" + Date.now();
                    resultImg.style.display = 'block';
                }
                
                const placeholder = document.getElementById('capture-placeholder');
                if (placeholder) {
                    placeholder.style.display = 'none';
                }

                let hasFire = false;

                // 为了避免日志无限堆叠，处理后我们不用清空日志，而是直接在新图片到来时往日志里追加一条最新图片的解析
                // 也可以把前N条数据在这里重新刷一次，这里选择每次最新到达时只把这最新图片加入Log，以符合实时追加效果
                // 或者直接追加当次最新文件的解析：
                if (!latestImg.startsWith("BOOT")) {
                    let match = latestImg.match(/_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
                    let timeStr = "";
                    if (match) {
                        timeStr = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
                    } else {
                        // 回退到当前时间格式
                        const now = new Date();
                        timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
                    }

                    const locationName = LOCATION_DATA[this.currentLocation].name;
                    
                    const div = document.createElement('div');
                    if (this.isFireImageName(latestImg)) {
                        div.className = 'log-entry error';
                        div.textContent = `[${timeStr}] ${locationName}处检测到火，请立即处理！`;
                        hasFire = true;
                    } else if (latestImg.startsWith("PERIODIC")) {
                        div.className = 'log-entry success';
                        div.textContent = `[${timeStr}] ${locationName}持续监测中，未发现火情异常。`;
                    }

                    if (logContainer) {
                        logContainer.appendChild(div);
                        // 如果日志过多，移除老的
                        if (logContainer.children.length > 50) {
                            logContainer.removeChild(logContainer.children[0]);
                        }
                        logContainer.scrollTop = logContainer.scrollHeight;
                    }
                }

                if (hasFire) {
                    this.applyFireAlertFromImage(latestImg);
                } else {
                    this.clearFire();
                }
            })
            .catch(err => {
                console.error(err);
                // 如果是网络间歇断开，不用一直报错刷屏，这里可以选择静默失败等下一秒重试
            });
    },

    startLightLogPolling() {
        if (this.lightLogTimer) return;
        this.latestLightLogLine = '';
        this.poll58SuoLightValue();
        this.lightLogTimer = window.setInterval(() => {
            this.poll58SuoLightValue();
        }, 2000);
        this.addLogEntry('开始实时读取 58Suo 最新光照数据...', 'info');
    },

    stopLightLogPolling() {
        if (this.lightLogTimer) {
            window.clearInterval(this.lightLogTimer);
            this.lightLogTimer = null;
        }
    },

    poll58SuoLightValue() {
        const url = `${this.lightLogEndpoint}?source=58Suo&lineLimit=120&fileLimit=20&t=${Date.now()}`;
        fetch(url, { method: 'GET', cache: 'no-store' })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((data) => {
                const parsed = this.extractLatestLightValue(data);
                if (!parsed) return;

                if (parsed.line === this.latestLightLogLine) return;
                this.applyRealLightValue(parsed.light, parsed.line);
            })
            .catch((err) => {
                console.error('[58Suo] 光照数据读取失败:', err);
            });
    },

    extractLatestLightValue(data) {
        const entries = Array.isArray(data && data.entries) ? data.entries : [];

        for (let i = 0; i < entries.length; i++) {
            const lines = Array.isArray(entries[i].lines) ? entries[i].lines : [];
            for (let j = lines.length - 1; j >= 0; j--) {
                const line = lines[j];
                const light = this.parseLightFromLogLine(line);
                if (light !== null) {
                    return { light, line };
                }
            }
        }

        return null;
    },

    parseLightFromLogLine(line) {
        if (typeof line !== 'string' || !line.trim()) return null;

        const jsonStart = line.indexOf('{');
        if (jsonStart >= 0) {
            try {
                const payload = JSON.parse(line.slice(jsonStart));
                const lightRaw = payload && payload.data_content ? payload.data_content.light : null;
                const lightValue = Number(lightRaw);
                if (Number.isFinite(lightValue)) return Math.max(0, Math.round(lightValue));
            } catch (_) {}
        }

        const match = line.match(/"light"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
        if (!match) return null;
        const fallbackValue = Number(match[1]);
        return Number.isFinite(fallbackValue) ? Math.max(0, Math.round(fallbackValue)) : null;
    },

    applyRealLightValue(lightValue, sourceLine) {
        this.currentLightValue = lightValue;
        this.usingRealLightValue = true;
        this.updateLightChart(LOCATION_DATA[this.currentLocation]);
        if (window.SensorDrawer && typeof window.SensorDrawer.refreshCurrentValues === 'function') {
            window.SensorDrawer.refreshCurrentValues();
        }

        if (sourceLine && sourceLine !== this.latestLightLogLine) {
            this.latestLightLogLine = sourceLine;
            this.pulseLightPanel();
            this.addLogEntry(`58Suo 最新光照数据更新：${lightValue} Lux`, 'success');
        }
    },

    getAdaptiveLightRange(lightValue) {
        const value = Number(lightValue);
        if (!Number.isFinite(value) || value <= 0) {
            return { min: 0, max: 1000 };
        }

        const span = Math.max(300, value * 0.75);
        const min = Math.max(0, Math.floor((value - span * 0.45) / 50) * 50);
        const max = Math.max(min + 300, Math.ceil((value + span * 0.55) / 50) * 50);
        return { min, max };
    },

    pulseLightPanel() {
        const panel = document.querySelector('.sensor-light');
        if (!panel) return;
        panel.classList.remove('light-value-updated');
        void panel.offsetWidth;
        panel.classList.add('light-value-updated');
    },

    // 启动自动更新
    startAutoUpdate() {
        if (this.autoUpdateTimer) return;
        
        this.autoUpdateTimer = setInterval(() => {
            this.refreshAllData();
        }, 5000);
    },
    
    // 刷新所有数据
    refreshAllData() {
        const location = this.currentLocation;
        const baseData = LOCATION_DATA[location];
        
        // 更新温湿度数据
        baseData.temperatureData = generateSensorData(
            location === 'haikou' ? 28 : 12,
            location === 'haikou' ? 3 : 2.5,
            Math.random() * 2 - 1
        );
        baseData.humidityData = generateSensorData(
            location === 'haikou' ? 75 : 58,
            location === 'haikou' ? 8 : 12,
            Math.random() * 4 - 2
        );
        
        // 更新烟感数据
        baseData.smokeData = generateSensorData(
            location === 'haikou' ? 35 : 28,
            location === 'haikou' ? 8 : 6,
            Math.random() * 2 - 1
        );
        
        // 未接入真实光照数据前使用模拟值；一旦58Suo数据到达，就不再覆盖真实值。
        if (!this.usingRealLightValue) {
            const baseLightValue = location === 'haikou' ? 8500 : 6200;
            this.currentLightValue = baseLightValue + Math.floor(Math.random() * 3000 - 1500);
        }
        
        // 生成风速随机值
        const baseWindValue = location === 'haikou' ? 4.5 : 3.2;
        this.currentWindValue = baseWindValue + Math.random() * 3 - 1.5;
        this.currentWindValue = Math.max(0, Math.round(this.currentWindValue * 10) / 10);
        
        // 更新图表
        this.updateTemperatureChart(baseData);
        this.updateSmokeChart(baseData);
        this.updateLightChart(baseData);
        this.updateWindChart(baseData);
        
        // 获取当前数据用于日志显示
        const currentTemp = baseData.temperatureData[baseData.temperatureData.length - 1].toFixed(1);
        const currentHumidity = baseData.humidityData[baseData.humidityData.length - 1].toFixed(1);
        const currentSmoke = baseData.smokeData[baseData.smokeData.length - 1].toFixed(0);
        
        // 将原先添加随机检测日志的功能屏蔽，现在通过 fetchAndShowDetectionResult 中 fetch 持久化快照数据
        if (this.isShowingResult) {
            this.fetchAndShowDetectionResult();
        }
    },
    
    // 添加日志条目
    addLogEntry(text, type = '') {
        const log = document.getElementById('detection-log');
        if (!log) return;
        
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        const div = document.createElement('div');
        div.className = `log-entry ${type}`;
        div.textContent = `[${time}] ${text}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    },

    isFireImageName(filename = '') {
        const upperName = String(filename || '').toUpperCase();
        if (!upperName || upperName.includes('NOFIRE')) return false;
        return upperName.startsWith('FIRE') || /(^|[_-])FIRE([_.-]|$)/.test(upperName);
    },

    getCurrentSensorSnapshot() {
        const data = LOCATION_DATA[this.currentLocation] || {};
        const normalize = (values) => (Array.isArray(values) ? values : [])
            .map(value => Number(value))
            .filter(value => Number.isFinite(value));
        const average = (values) => {
            if (!values.length) return 0;
            return values.reduce((sum, value) => sum + value, 0) / values.length;
        };
        const latest = (values) => values.length ? values[values.length - 1] : 0;

        const temperatureData = normalize(data.temperatureData);
        const humidityData = normalize(data.humidityData);
        const smokeData = normalize(data.smokeData);
        const previousTemperature = temperatureData.slice(0, -1);
        const previousHumidity = humidityData.slice(0, -1);
        const previousSmoke = smokeData.slice(0, -1);
        const temperature = latest(temperatureData);
        const humidity = latest(humidityData);
        const smoke = latest(smokeData);

        return {
            temperature,
            humidity,
            smoke,
            temperatureRise: temperature - average(previousTemperature),
            humidityRise: humidity - average(previousHumidity),
            smokeRise: smoke - average(previousSmoke)
        };
    },

    calculateSensorRiskScore(snapshot = this.getCurrentSensorSnapshot()) {
        const temperatureRise = Math.max(0, Number(snapshot.temperatureRise) || 0);
        const smokeRise = Math.max(0, Number(snapshot.smokeRise) || 0);
        const temperatureScore = Math.min(12, (temperatureRise / 8) * 12);
        const smokeScore = Math.min(18, (smokeRise / 18) * 18);
        return Math.round(Math.min(30, temperatureScore + smokeScore));
    },

    calculateFireAlertFusion(filename) {
        const hasFireImage = this.isFireImageName(filename);
        const sensorSnapshot = this.getCurrentSensorSnapshot();
        const imageScore = hasFireImage ? 70 : 0;
        const sensorScore = this.calculateSensorRiskScore(sensorSnapshot);
        const fusionScore = imageScore + sensorScore;
        let alertLevel = 'none';

        if (hasFireImage) {
            alertLevel = fusionScore >= 85 ? 'high' : 'medium';
        }

        return {
            hasFireImage,
            imageScore,
            sensorScore,
            fusionScore,
            alertLevel,
            sensorSnapshot
        };
    },

    applyFireAlertFromImage(filename) {
        const fusion = this.calculateFireAlertFusion(filename);

        if (!fusion.hasFireImage) {
            this.clearFire();
            return;
        }

        FireSimState.fireDetected = true;
        FireSimState.latestFireImage = filename;
        FireSimState.imageScore = fusion.imageScore;
        FireSimState.sensorScore = fusion.sensorScore;
        FireSimState.sensorOverThreshold = fusion.sensorScore;
        FireSimState.fusionScore = fusion.fusionScore;
        FireSimState.alertLevel = fusion.alertLevel;
        FireSimState.sensorSnapshot = fusion.sensorSnapshot;

        this.renderAlertLevel();
        this.updateCaptureStatus();
        this.addFireLog();
    },
    
    // 模拟火情
    simulateFire() {
        FireSimState.fireDetected = true;
        const fusion = this.calculateFireAlertFusion('FIRE_MANUAL_TRIGGER.jpg');
        FireSimState.latestFireImage = 'FIRE_MANUAL_TRIGGER.jpg';
        FireSimState.imageScore = fusion.imageScore;
        FireSimState.sensorScore = fusion.sensorScore;
        FireSimState.sensorOverThreshold = fusion.sensorScore;
        FireSimState.fusionScore = fusion.fusionScore;
        FireSimState.alertLevel = fusion.alertLevel;
        FireSimState.sensorSnapshot = fusion.sensorSnapshot;
        this.updateAlertLevel();
        this.updateCaptureStatus();
        this.addFireLog();
    },
    
    // 解除火情
    clearFire() {
        FireSimState.fireDetected = false;
        FireSimState.sensorOverThreshold = 0;
        FireSimState.alertLevel = 'none';
        FireSimState.imageScore = 0;
        FireSimState.sensorScore = 0;
        FireSimState.fusionScore = 0;
        FireSimState.latestFireImage = '';
        FireSimState.sensorSnapshot = null;
        this.updateAlertLevel();
        this.updateCaptureStatus();
        this.addClearLog();
    },
    
    // 模拟通信故障
    simulateCommFailure() {
        FireSimState.commFailed = !FireSimState.commFailed;
        this.addCommLog();
    },
    
    // 更新警报等级
    updateAlertLevel() {
        if (!FireSimState.fireDetected) {
            FireSimState.alertLevel = 'none';
        } else if (FireSimState.fusionScore >= 85) {
            FireSimState.alertLevel = 'high';
        } else {
            FireSimState.alertLevel = 'medium';
        }
        this.renderAlertLevel();
    },
    
    // 渲染警报等级UI
    renderAlertLevel() {
        const display = document.getElementById('alert-level-display');
        const levelBarLow = document.getElementById('level-bar-low');
        const levelBarMedium = document.getElementById('level-bar-medium');
        const levelBarHigh = document.getElementById('level-bar-high');
        const levelIcon = document.getElementById('level-icon');
        const levelText = document.getElementById('level-text');
        const levelDesc = document.getElementById('level-desc');
        
        if (!display) return;
        
        // 移除所有状态类
        display.classList.remove('level-none', 'level-low-alert', 'level-medium-alert', 'level-high-alert');
        [levelBarLow, levelBarMedium, levelBarHigh].forEach(bar => bar && bar.classList.remove('active'));
        const panel = display.closest('.fire-alert-box');
        if (panel) {
            panel.classList.remove('alert-active', 'alert-low', 'alert-medium', 'alert-high');
        }

        const alertConfig = {
            none: {
                class: 'level-none',
                icon: '✓',
                text: '无警报',
                desc: '',
                bars: []
            },
            low: {
                class: 'level-low-alert',
                icon: '!',
                text: '低等级警报',
                desc: '',
                bars: [levelBarLow]
            },
            medium: {
                class: 'level-medium-alert',
                icon: '!',
                text: '中等级警报',
                desc: '',
                bars: [levelBarMedium]
            },
            high: {
                class: 'level-high-alert',
                icon: '!',
                text: '高等级警报',
                desc: '',
                bars: [levelBarHigh]
            }
        };
        
        const config = alertConfig[FireSimState.alertLevel];
        display.classList.add(config.class);
        if (levelIcon) levelIcon.textContent = config.icon;
        if (levelText) levelText.textContent = config.text;
        if (levelDesc) levelDesc.textContent = config.desc;
        config.bars.forEach(bar => bar && bar.classList.add('active'));
        if (panel && FireSimState.alertLevel !== 'none') {
            panel.classList.add('alert-active', `alert-${FireSimState.alertLevel}`);
        }
    },
    
    // 更新抓拍状态
    updateCaptureStatus() {
        const placeholder = document.getElementById('capture-placeholder');
        const captureText = document.getElementById('capture-text');
        
        if (placeholder) {
            if (FireSimState.fireDetected) {
                placeholder.classList.add('fire-detected');
                if (captureText) captureText.textContent = '🔥 检测到火情!';
            } else {
                placeholder.classList.remove('fire-detected');
                if (captureText) captureText.textContent = '未检测到火情';
            }
        }
    },
    
    // 添加火情日志
    addFireLog() {
        const log = document.getElementById('detection-log');
        if (!log) return;
        
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const location = LOCATION_DATA[this.currentLocation].name;
        
        const entries = [
            { text: `[${time}] 检测到 FIRE 火情图片 - ${location}`, class: 'warning' },
            { text: `[${time}] 触发${FireSimState.alertLevel === 'high' ? '高' : FireSimState.alertLevel === 'medium' ? '中' : '低'}等级火灾警报`, class: 'error' }
        ];
        
        entries.forEach(entry => {
            const div = document.createElement('div');
            div.className = `log-entry ${entry.class}`;
            div.textContent = entry.text;
            log.appendChild(div);
        });
        
        log.scrollTop = log.scrollHeight;
    },
    
    // 添加解除日志
    addClearLog() {
        const log = document.getElementById('detection-log');
        if (!log) return;
        
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        const div = document.createElement('div');
        div.className = 'log-entry success';
        div.textContent = `[${time}] ✓ 火情解除，系统恢复正常`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    },
    
    // 添加通信日志
    addCommLog() {
        const log = document.getElementById('detection-log');
        if (!log) return;
        
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        const div = document.createElement('div');
        if (FireSimState.commFailed) {
            div.className = 'log-entry error';
            div.textContent = `[${time}] ❌ 5G/天通通信中断，切换至短波回传...`;
        } else {
            div.className = 'log-entry success';
            div.textContent = `[${time}] ✓ 通信链路恢复正常`;
        }
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    },

    // 切换地区
    switchLocation(location) {
        if (this.currentLocation === location) return;
        
        console.log(`切换到：${LOCATION_DATA[location].name}`);
        this.currentLocation = location;
        
        // 更新按钮状态
        this.updateButtonState(location);
        
        // 更新内容
        this.updateContent(location);
    },
    
    // 更新按钮状态
    updateButtonState(location) {
        const haikouBtn = document.getElementById('btn-haikou');
        const nanjingBtn = document.getElementById('btn-nanjing');
        const cameraLocation = document.getElementById('camera-location');
        const ipSelect = document.getElementById('ip-address-select');
        
        if (location === 'haikou') {
            if (haikouBtn) haikouBtn.classList.add('active');
            if (nanjingBtn) nanjingBtn.classList.remove('active');
            if (cameraLocation) cameraLocation.textContent = '海口';
            // 更新海口IP地址选项
            if (ipSelect) {
                ipSelect.innerHTML = `
                    <option value="10.10.1.101">10.10.1.101 - 海口摄像头1</option>
                    <option value="10.10.1.102">10.10.1.102 - 海口摄像头2</option>
                    <option value="10.10.1.103">10.10.1.103 - 海口摄像头3</option>
                    <option value="10.10.1.200">10.10.1.200 - 海口边缘网关</option>
                `;
            }
        } else {
            if (haikouBtn) haikouBtn.classList.remove('active');
            if (nanjingBtn) nanjingBtn.classList.add('active');
            if (cameraLocation) cameraLocation.textContent = '南京溧水';
            // 更新南京溧水IP地址选项
            if (ipSelect) {
                ipSelect.innerHTML = `
                    <option value="10.20.1.101">10.20.1.101 - 溧水摄像头1</option>
                    <option value="10.20.1.102">10.20.1.102 - 溧水摄像头2</option>
                    <option value="10.20.1.103">10.20.1.103 - 溧水摄像头3</option>
                    <option value="10.20.1.200">10.20.1.200 - 溧水边缘网关</option>
                `;
            }
        }
    },

    // 更新页面内容
    updateContent(location) {
        const data = LOCATION_DATA[location];
        
        // 添加淡出效果
        const panels = document.querySelectorAll('.fire-panel-content');
        panels.forEach(panel => {
            panel.style.opacity = '0';
        });
        
        // 延迟更新内容，创造切换动画效果
        setTimeout(() => {
            // 摄像头和抓拍保持占位符，不需要更新
            
            // 更新实时检测结果日志
            const detectionLog = document.getElementById('detection-log');
            if (detectionLog && data.detectionLogs) {
                detectionLog.innerHTML = '';
                data.detectionLogs.forEach((log, index) => {
                    const logEntry = document.createElement('div');
                    logEntry.className = 'log-entry';
                    if (log.includes('未发现异常') || log.includes('正常')) {
                        logEntry.classList.add('success');
                    }
                    logEntry.textContent = log;
                    detectionLog.appendChild(logEntry);
                });
                // 自动滚动到底部
                detectionLog.scrollTop = detectionLog.scrollHeight;
            }
            
            // 更新温湿度图表
            this.updateTemperatureChart(data);
            
            // 更新烟感图表
            this.updateSmokeChart(data);
            
            // 更新光照图表
            this.updateLightChart(data);
            
            // 更新风速图表
            this.updateWindChart(data);
            
            // 恢复透明度，触发淡入动画
            panels.forEach(panel => {
                panel.style.opacity = '1';
            });
        }, 200);
    },
    
    // 更新温湿度图表
    updateTemperatureChart(data) {
        if (!temperatureChart) return;
        
        const timeLabels = generateTimeLabels(); // 使用实时生成的时间标签
        
        const option = {
            backgroundColor: 'transparent',
            grid: {
                left: '10%',
                right: '10%',
                top: '15%',
                bottom: '15%'
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                borderColor: '#00d4ff',
                textStyle: {
                    color: '#fff'
                }
            },
            legend: {
                data: ['温度', '湿度'],
                textStyle: {
                    color: '#00d4ff'
                },
                top: '5%'
            },
            xAxis: {
                type: 'category',
                data: timeLabels,
                axisLine: {
                    lineStyle: {
                        color: 'rgba(0, 212, 255, 0.3)'
                    }
                },
                axisLabel: {
                    color: '#67c5ff',
                    fontSize: 10
                }
            },
            yAxis: [
                {
                    type: 'value',
                    name: '温度(°C)',
                    nameTextStyle: {
                        color: '#00d4ff',
                        fontSize: 10
                    },
                    axisLine: {
                        lineStyle: {
                            color: 'rgba(0, 212, 255, 0.3)'
                        }
                    },
                    axisLabel: {
                        color: '#67c5ff',
                        fontSize: 10
                    },
                    splitLine: {
                        lineStyle: {
                            color: 'rgba(0, 212, 255, 0.1)'
                        }
                    }
                },
                {
                    type: 'value',
                    name: '湿度(%)',
                    nameTextStyle: {
                        color: '#00d4ff',
                        fontSize: 10
                    },
                    axisLine: {
                        lineStyle: {
                            color: 'rgba(0, 212, 255, 0.3)'
                        }
                    },
                    axisLabel: {
                        color: '#67c5ff',
                        fontSize: 10
                    },
                    splitLine: {
                        show: false
                    }
                }
            ],
            series: [
                {
                    name: '温度',
                    type: 'line',
                    data: data.temperatureData,
                    smooth: true,
                    lineStyle: {
                        color: '#ff6b6b',
                        width: 2
                    },
                    itemStyle: {
                        color: '#ff6b6b'
                    },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(255, 107, 107, 0.3)' },
                                { offset: 1, color: 'rgba(255, 107, 107, 0.05)' }
                            ]
                        }
                    }
                },
                {
                    name: '湿度',
                    type: 'line',
                    yAxisIndex: 1,
                    data: data.humidityData,
                    smooth: true,
                    lineStyle: {
                        color: '#4ecdc4',
                        width: 2
                    },
                    itemStyle: {
                        color: '#4ecdc4'
                    },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(78, 205, 196, 0.3)' },
                                { offset: 1, color: 'rgba(78, 205, 196, 0.05)' }
                            ]
                        }
                    }
                }
            ]
        };
        
        temperatureChart.setOption(option);
    },
    
    // 更新烟感图表
    updateSmokeChart(data) {
        if (!smokeChart) return;
        
        const timeLabels = generateTimeLabels(); // 使用实时生成的时间标签
        
        const option = {
            backgroundColor: 'transparent',
            grid: {
                left: '12%',
                right: '10%',
                top: '20%',
                bottom: '15%'
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                borderColor: '#00d4ff',
                textStyle: {
                    color: '#fff'
                },
                formatter: '{b}<br/>PM2.5: {c} μg/m³'
            },
            title: {
                text: 'PM2.5浓度',
                left: 'center',
                top: '5%',
                textStyle: {
                    color: '#00d4ff',
                    fontSize: 12
                }
            },
            xAxis: {
                type: 'category',
                data: timeLabels,
                axisLine: {
                    lineStyle: {
                        color: 'rgba(0, 212, 255, 0.3)'
                    }
                },
                axisLabel: {
                    color: '#67c5ff',
                    fontSize: 10
                }
            },
            yAxis: {
                type: 'value',
                name: 'μg/m³',
                nameTextStyle: {
                    color: '#00d4ff',
                    fontSize: 10
                },
                axisLine: {
                    lineStyle: {
                        color: 'rgba(0, 212, 255, 0.3)'
                    }
                },
                axisLabel: {
                    color: '#67c5ff',
                    fontSize: 10
                },
                splitLine: {
                    lineStyle: {
                        color: 'rgba(0, 212, 255, 0.1)'
                    }
                }
            },
            series: [
                {
                    name: 'PM2.5',
                    type: 'line',
                    data: data.smokeData,
                    smooth: true,
                    lineStyle: {
                        color: '#ffd93d',
                        width: 2
                    },
                    itemStyle: {
                        color: '#ffd93d'
                    },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(255, 217, 61, 0.3)' },
                                { offset: 1, color: 'rgba(255, 217, 61, 0.05)' }
                            ]
                        }
                    }
                }
            ]
        };
        
        smokeChart.setOption(option);
    },
    
    // 更新光照图表 - 使用仪表盘样式
    updateLightChart(data) {
        if (!lightChart) return;
        
        // 使用当前光照值（已在refreshAllData中生成）
        const lightValue = this.currentLightValue || (this.currentLocation === 'haikou' ? 8500 : 6200);
        const lightRange = this.getAdaptiveLightRange(lightValue);
        const weather = this.currentLocation === 'haikou' ? '晴朗' : '多云';
        
        const option = {
            backgroundColor: 'transparent',
            series: [
                {
                    type: 'gauge',
                    startAngle: 200,
                    endAngle: -20,
                    min: lightRange.min,
                    max: lightRange.max,
                    splitNumber: 4,
                    center: ['50%', '58%'],
                    radius: '86%',
                    itemStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 1, y2: 0,
                            colorStops: [
                                { offset: 0, color: '#3b82f6' },
                                { offset: 0.5, color: '#fbbf24' },
                                { offset: 1, color: '#ef4444' }
                            ]
                        }
                    },
                    progress: {
                        show: true,
                        width: 10
                    },
                    pointer: {
                        show: false
                    },
                    axisLine: {
                        lineStyle: {
                            width: 10,
                            color: [[1, 'rgba(0, 212, 255, 0.15)']]
                        }
                    },
                    axisTick: {
                        show: false
                    },
                    splitLine: {
                        show: false
                    },
                    axisLabel: {
                        distance: 10,
                        color: '#67c5ff',
                        fontSize: 9,
                        formatter: function(value) {
                            if (value >= 1000) {
                                const formatted = value % 1000 === 0 ? (value / 1000).toFixed(0) : (value / 1000).toFixed(1);
                                return `${formatted}k`;
                            }
                            return String(Math.round(value));
                        }
                    },
                    anchor: {
                        show: false
                    },
                    title: {
                        show: true,
                        offsetCenter: [0, '68%'],
                        fontSize: 11,
                        color: '#94a3b8'
                    },
                    detail: {
                        valueAnimation: true,
                        fontSize: 21,
                        offsetCenter: [0, '30%'],
                        formatter: function(value) {
                            return `${Math.round(value)} Lux`;
                        },
                        color: '#fbbf24',
                        fontWeight: 'bold'
                    },
                    data: [
                        {
                            value: lightValue,
                            name: '☀️ ' + weather
                        }
                    ]
                }
            ]
        };
        
        lightChart.setOption(option);
    },
    
    // 更新风速图表 - 使用仪表盘样式
    updateWindChart(data) {
        if (!windChart) return;
        
        const windValue = this.currentWindValue || (this.currentLocation === 'haikou' ? 4.5 : 3.2);
        const windLevel = windValue < 2 ? '微风' : windValue < 5 ? '和风' : windValue < 8 ? '清风' : '强风';
        
        const option = {
            backgroundColor: 'transparent',
            series: [
                {
                    type: 'gauge',
                    startAngle: 200,
                    endAngle: -20,
                    min: 0,
                    max: 15,
                    splitNumber: 5,
                    center: ['50%', '60%'],
                    radius: '90%',
                    itemStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 1, y2: 0,
                            colorStops: [
                                { offset: 0, color: '#10b981' },
                                { offset: 0.5, color: '#22d3ee' },
                                { offset: 1, color: '#a855f7' }
                            ]
                        }
                    },
                    progress: {
                        show: true,
                        width: 12
                    },
                    pointer: {
                        show: false
                    },
                    axisLine: {
                        lineStyle: {
                            width: 12,
                            color: [[1, 'rgba(0, 212, 255, 0.15)']]
                        }
                    },
                    axisTick: {
                        show: false
                    },
                    splitLine: {
                        show: false
                    },
                    axisLabel: {
                        distance: 15,
                        color: '#67c5ff',
                        fontSize: 10,
                        formatter: function(value) {
                            return value + '';
                        }
                    },
                    anchor: {
                        show: false
                    },
                    title: {
                        show: true,
                        offsetCenter: [0, '70%'],
                        fontSize: 12,
                        color: '#94a3b8'
                    },
                    detail: {
                        valueAnimation: true,
                        fontSize: 24,
                        offsetCenter: [0, '30%'],
                        formatter: function(value) {
                            return value.toFixed(1) + ' m/s';
                        },
                        color: '#22d3ee',
                        fontWeight: 'bold'
                    },
                    data: [
                        {
                            value: windValue,
                            name: '🌬️ ' + windLevel
                        }
                    ]
                }
            ]
        };
        
        windChart.setOption(option);
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    ForestFireScene.init();
    
    // 确保布局正确显示和图表自适应
    window.addEventListener('resize', () => {
        console.log('窗口大小改变，调整布局...');
        if (temperatureChart) {
            temperatureChart.resize();
        }
        if (smokeChart) {
            smokeChart.resize();
        }
        if (lightChart) {
            lightChart.resize();
        }
        if (windChart) {
            windChart.resize();
        }
    });
    
    // 初始化传感器控制抽屉
    initSensorDrawer();
});

// ========== 传感器控制抽屉功能 ==========
const SensorDrawer = {
    overlay: null,
    drawer: null,
    currentSensor: null,
    currentSubSensor: null, // 用于光照/风速切换
    updateTimer: null,
    
    // 频率值映射 (slider index -> Hz value)
    frequencyValues: [0.5, 1, 2, 5, 10],
    
    // 传感器配置信息
    sensors: {
        temperature: {
            name: '温湿度传感器',
            type: '环境监测',
            deviceId: 'SENSOR-TH-001',
            online: true,
            isDualValue: true, // 双值显示
            unit: '°C',
            currentValue: 26.5,
            humidityValue: 65.0,
            signal: -65,
            sampleFrequency: 1,
            uploadInterval: 5,
            heartbeatPeriod: 30,
            offlineThreshold: 3
        },
        smoke: {
            name: '烟感传感器',
            type: '安全监测',
            deviceId: 'SENSOR-SM-001',
            online: true,
            unit: 'ppm',
            currentValue: 12,
            signal: -58,
            sampleFrequency: 2,
            uploadInterval: 3,
            heartbeatPeriod: 15,
            offlineThreshold: 3
        },
        lightwind: {
            name: '光照/风速传感器',
            type: '气象监测',
            hasSwitcher: true, // 有子传感器切换
            subSensors: {
                light: {
                    name: '光照传感器',
                    deviceId: 'SENSOR-LT-001',
                    unit: 'Lux',
                    currentValue: 8500,
                    signal: -68
                },
                wind: {
                    name: '风速传感器',
                    deviceId: 'SENSOR-WD-001',
                    unit: 'm/s',
                    currentValue: 4.5,
                    signal: -72
                }
            },
            online: true,
            sampleFrequency: 0.5,
            uploadInterval: 10,
            heartbeatPeriod: 60,
            offlineThreshold: 5
        }
    },
    
    // 参数规格定义
    paramSpecs: {
        sampleFrequency: {
            field: 'sampleFrequency',
            label: '工作频率',
            unit: 'Hz',
            defaultValue: 1,
            allowedValues: [0.5, 1, 2, 5, 10],
            tooltip: '传感器每秒采样次数。高频率提升精度但增加功耗'
        },
        uploadInterval: {
            field: 'uploadInterval',
            label: '上报周期',
            unit: 's',
            defaultValue: 5,
            presetValues: [1, 3, 5, 10, 30, 60],
            min: 1,
            max: 300,
            tooltip: '数据上报服务器的间隔时间'
        },
        heartbeatPeriod: {
            field: 'heartbeatPeriod',
            label: '心跳周期',
            unit: 's',
            defaultValue: 30,
            min: 1,
            max: 600,
            tooltip: '设备向平台发送心跳包的时间间隔，用于判断在线状态'
        },
        offlineThreshold: {
            field: 'offlineThreshold',
            label: '离线判定阈值',
            unit: '次',
            defaultValue: 3,
            allowedValues: [2, 3, 5, 10],
            tooltip: '连续丢失心跳次数后判定设备离线'
        }
    },
    
    init() {
        this.overlay = document.getElementById('sensor-drawer-overlay');
        this.drawer = document.getElementById('sensor-drawer');
        
        if (!this.overlay || !this.drawer) return;
        
        // 绑定关闭事件
        document.getElementById('drawer-close-btn')?.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());
        document.getElementById('drawer-btn-cancel')?.addEventListener('click', () => this.close());
        document.getElementById('drawer-btn-apply')?.addEventListener('click', () => this.apply());
        document.getElementById('drawer-btn-send')?.addEventListener('click', () => this.send());
        document.getElementById('drawer-btn-read')?.addEventListener('click', () => this.readConfig());
        document.getElementById('drawer-btn-reset')?.addEventListener('click', () => this.resetDefaults());
        
        // IP连接按钮
        document.getElementById('ip-connect-btn')?.addEventListener('click', () => this.connectToIP());
        
        // 频率下拉与滑块同步
        const freqSelect = document.getElementById('param-frequency');
        const freqSlider = document.getElementById('param-frequency-slider');
        freqSelect?.addEventListener('change', (e) => {
            const idx = this.frequencyValues.indexOf(parseFloat(e.target.value));
            if (freqSlider && idx >= 0) freqSlider.value = idx;
        });
        freqSlider?.addEventListener('input', (e) => {
            const val = this.frequencyValues[parseInt(e.target.value)];
            if (freqSelect) freqSelect.value = val;
        });
        
        // 上报周期下拉切换自定义输入
        const intervalSelect = document.getElementById('param-interval-select');
        const intervalCustomRow = document.getElementById('interval-custom-row');
        const intervalInput = document.getElementById('param-interval');
        intervalSelect?.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                intervalCustomRow.style.display = 'flex';
                intervalInput?.focus();
            } else {
                intervalCustomRow.style.display = 'none';
                if (intervalInput) intervalInput.value = e.target.value;
            }
        });
        
        // 心跳周期输入验证与联动校验
        const heartbeatInput = document.getElementById('param-heartbeat');
        heartbeatInput?.addEventListener('input', (e) => {
            // 拦截非法字符，只允许正整数
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
            this.validateHeartbeat();
        });
        heartbeatInput?.addEventListener('blur', (e) => {
            // 空值回退默认
            if (!e.target.value || e.target.value === '') {
                e.target.value = 30;
            }
            this.validateHeartbeat();
        });
        
        // 上报周期变化时重新校验心跳
        intervalSelect?.addEventListener('change', () => this.validateHeartbeat());
        intervalInput?.addEventListener('input', () => this.validateHeartbeat());
        
        // 输入校验
        document.querySelectorAll('.param-input').forEach(input => {
            input.addEventListener('input', (e) => this.validateInput(e.target));
            input.addEventListener('blur', (e) => this.validateInput(e.target));
        });
        
        // 传感器切换器事件
        const sensorSwitcher = document.getElementById('sensor-switcher');
        sensorSwitcher?.addEventListener('click', (e) => {
            const btn = e.target.closest('.sensor-switch-btn');
            if (!btn) return;
            
            sensorSwitcher.querySelectorAll('.sensor-switch-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const subSensor = btn.dataset.sensor;
            this.switchSubSensor(subSensor);
        });
    },
    
    // 切换子传感器 (光照/风速)
    switchSubSensor(subSensor) {
        if (!this.currentSensor || this.currentSensor !== 'lightwind') return;
        
        this.currentSubSensor = subSensor;
        const sensor = this.sensors.lightwind;
        const sub = sensor.subSensors[subSensor];
        
        document.getElementById('drawer-sensor-name').textContent = sub.name;
        document.getElementById('drawer-device-id').textContent = '设备ID: ' + sub.deviceId;
        document.getElementById('drawer-current-value').textContent = sub.currentValue;
        document.getElementById('drawer-current-unit').textContent = sub.unit;
        document.getElementById('drawer-signal').textContent = sub.signal + ' dBm';
        document.getElementById('drawer-update-time').textContent = this.formatTime();
    },
    
    // 从图表数据更新抽屉显示
    updateFromChartData() {
        if (!this.currentSensor) return;
        
        const location = ForestFireScene.currentLocation;
        const data = LOCATION_DATA[location];
        const time = this.formatTime();
        
        if (this.currentSensor === 'temperature') {
            // 更新温湿度双值显示
            const tempValue = data.temperatureData[data.temperatureData.length - 1].toFixed(1);
            const humidityValue = data.humidityData[data.humidityData.length - 1].toFixed(1);
            
            document.getElementById('drawer-temp-value').textContent = tempValue;
            document.getElementById('drawer-humidity-value').textContent = humidityValue;
            document.getElementById('drawer-update-time-dual').textContent = time;
            
            // 同时更新sensor数据
            this.sensors.temperature.currentValue = parseFloat(tempValue);
            this.sensors.temperature.humidityValue = parseFloat(humidityValue);
            
        } else if (this.currentSensor === 'smoke') {
            const smokeValue = data.smokeData[data.smokeData.length - 1].toFixed(0);
            document.getElementById('drawer-current-value').textContent = smokeValue;
            document.getElementById('drawer-update-time').textContent = time;
            this.sensors.smoke.currentValue = parseFloat(smokeValue);
            
        } else if (this.currentSensor === 'lightwind') {
            const lightValue = ForestFireScene.currentLightValue;
            const windValue = ForestFireScene.currentWindValue;
            
            // 更新子传感器数据
            this.sensors.lightwind.subSensors.light.currentValue = lightValue;
            this.sensors.lightwind.subSensors.wind.currentValue = windValue;
            
            // 根据当前选中的子传感器更新显示
            if (this.currentSubSensor === 'light') {
                document.getElementById('drawer-current-value').textContent = lightValue;
            } else {
                document.getElementById('drawer-current-value').textContent = windValue.toFixed(1);
            }
            document.getElementById('drawer-update-time').textContent = time;
        }
    },
    
    // 启动自动更新
    startAutoUpdate() {
        if (this.updateTimer) return;
        
        this.updateTimer = setInterval(() => {
            this.updateFromChartData();
        }, 5000);
    },
    
    // 停止自动更新
    stopAutoUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    },
    
    validateInput(input) {
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        const value = parseFloat(input.value);
        
        if (isNaN(value) || (!isNaN(min) && value < min) || (!isNaN(max) && value > max)) {
            input.classList.add('invalid');
            return false;
        } else {
            input.classList.remove('invalid');
            return true;
        }
    },
    
    validateHeartbeat() {
        const heartbeatInput = document.getElementById('param-heartbeat');
        const intervalSelect = document.getElementById('param-interval-select');
        const intervalInput = document.getElementById('param-interval');
        const warningRow = document.getElementById('heartbeat-warning-row');
        const warningText = document.getElementById('heartbeat-warning-text');
        
        if (!heartbeatInput) return true;
        
        const heartbeat = parseInt(heartbeatInput.value);
        let uploadInterval = intervalSelect?.value === 'custom' 
            ? parseInt(intervalInput?.value) 
            : parseInt(intervalSelect?.value);
        
        // 基本范围校验
        if (isNaN(heartbeat) || heartbeat < 1 || heartbeat > 600) {
            heartbeatInput.classList.add('invalid');
            if (warningRow) {
                warningRow.style.display = 'flex';
                warningText.textContent = '心跳周期必须为1-600之间的正整数';
            }
            return false;
        }
        
        // 联动校验：心跳周期不得大于上报周期的2倍
        if (!isNaN(uploadInterval) && heartbeat > uploadInterval * 2) {
            heartbeatInput.classList.remove('invalid');
            if (warningRow) {
                warningRow.style.display = 'flex';
                warningText.textContent = `心跳周期(${heartbeat}s)建议不超过上报周期(${uploadInterval}s)的2倍`;
            }
            return true; // 警告但不阻止
        }
        
        heartbeatInput.classList.remove('invalid');
        if (warningRow) warningRow.style.display = 'none';
        return true;
    },
    
    formatTime() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    },
    
    open(sensorType) {
        const sensor = this.sensors[sensorType];
        if (!sensor) return;
        
        this.currentSensor = sensorType;
        this.hideResult();
        
        const singleValueDisplay = document.getElementById('single-value-display');
        const dualValueDisplay = document.getElementById('dual-value-display');
        const sensorSwitcher = document.getElementById('sensor-switcher');
        const time = this.formatTime();
        
        // 根据传感器类型切换显示模式
        if (sensor.isDualValue) {
            // 温湿度：双值显示
            singleValueDisplay.style.display = 'none';
            dualValueDisplay.style.display = 'block';
            sensorSwitcher.style.display = 'none';
            
            // 从图表获取最新数据
            const location = ForestFireScene.currentLocation;
            const data = LOCATION_DATA[location];
            const tempValue = data.temperatureData[data.temperatureData.length - 1].toFixed(1);
            const humidityValue = data.humidityData[data.humidityData.length - 1].toFixed(1);
            
            document.getElementById('drawer-temp-value').textContent = tempValue;
            document.getElementById('drawer-humidity-value').textContent = humidityValue;
            document.getElementById('drawer-update-time-dual').textContent = time;
            document.getElementById('drawer-signal-dual').textContent = sensor.signal + ' dBm';
            
            document.getElementById('drawer-sensor-name').textContent = sensor.name;
            document.getElementById('drawer-sensor-type').textContent = sensor.type;
            document.getElementById('drawer-device-id').textContent = '设备ID: ' + sensor.deviceId;
            
        } else if (sensor.hasSwitcher) {
            // 光照/风速：带切换器
            singleValueDisplay.style.display = 'flex';
            dualValueDisplay.style.display = 'none';
            sensorSwitcher.style.display = 'flex';
            
            // 默认显示光照传感器
            this.currentSubSensor = 'light';
            const sub = sensor.subSensors.light;
            
            // 重置切换按钮状态
            sensorSwitcher.querySelectorAll('.sensor-switch-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.sensor === 'light');
            });
            
            // 从图表获取最新数据
            const lightValue = ForestFireScene.currentLightValue;
            sensor.subSensors.light.currentValue = lightValue;
            sensor.subSensors.wind.currentValue = ForestFireScene.currentWindValue;
            
            document.getElementById('drawer-sensor-name').textContent = sub.name;
            document.getElementById('drawer-sensor-type').textContent = sensor.type;
            document.getElementById('drawer-device-id').textContent = '设备ID: ' + sub.deviceId;
            document.getElementById('drawer-current-value').textContent = lightValue;
            document.getElementById('drawer-current-unit').textContent = sub.unit;
            document.getElementById('drawer-update-time').textContent = time;
            document.getElementById('drawer-signal').textContent = sub.signal + ' dBm';
            
        } else {
            // 烟感等：单值显示
            singleValueDisplay.style.display = 'flex';
            dualValueDisplay.style.display = 'none';
            sensorSwitcher.style.display = 'none';
            
            // 从图表获取最新数据
            if (sensorType === 'smoke') {
                const location = ForestFireScene.currentLocation;
                const data = LOCATION_DATA[location];
                const smokeValue = data.smokeData[data.smokeData.length - 1].toFixed(0);
                sensor.currentValue = parseFloat(smokeValue);
            }
            
            document.getElementById('drawer-sensor-name').textContent = sensor.name;
            document.getElementById('drawer-sensor-type').textContent = sensor.type;
            document.getElementById('drawer-device-id').textContent = '设备ID: ' + sensor.deviceId;
            document.getElementById('drawer-current-value').textContent = sensor.currentValue;
            document.getElementById('drawer-current-unit').textContent = sensor.unit;
            document.getElementById('drawer-update-time').textContent = time;
            document.getElementById('drawer-signal').textContent = sensor.signal + ' dBm';
        }
        
        const statusEl = document.getElementById('drawer-status');
        if (sensor.online) {
            statusEl.className = 'drawer-status online';
            statusEl.innerHTML = '<span class="status-dot"></span><span class="status-text">通信正常</span>';
        } else {
            statusEl.className = 'drawer-status offline';
            statusEl.innerHTML = '<span class="status-dot"></span><span class="status-text">通信中断</span>';
        }
        
        // B. 更新参数编辑区
        this.loadSensorParams(sensor);
        
        // 显示抽屉
        this.overlay.classList.add('active');
        this.drawer.classList.add('active');
        
        // 启动自动更新
        this.startAutoUpdate();
    },
    
    loadSensorParams(sensor) {
        // 1. 工作频率
        const freqSelect = document.getElementById('param-frequency');
        const freqSlider = document.getElementById('param-frequency-slider');
        if (freqSelect) freqSelect.value = sensor.sampleFrequency;
        if (freqSlider) {
            const idx = this.frequencyValues.indexOf(sensor.sampleFrequency);
            freqSlider.value = idx >= 0 ? idx : 1;
        }
        
        // 2. 上报周期
        const intervalSelect = document.getElementById('param-interval-select');
        const intervalInput = document.getElementById('param-interval');
        const intervalCustomRow = document.getElementById('interval-custom-row');
        const presetValues = [1, 3, 5, 10, 30, 60];
        
        if (presetValues.includes(sensor.uploadInterval)) {
            if (intervalSelect) intervalSelect.value = sensor.uploadInterval;
            if (intervalCustomRow) intervalCustomRow.style.display = 'none';
        } else {
            if (intervalSelect) intervalSelect.value = 'custom';
            if (intervalCustomRow) intervalCustomRow.style.display = 'flex';
        }
        if (intervalInput) intervalInput.value = sensor.uploadInterval;
        
        // 3. 心跳周期
        const heartbeatInput = document.getElementById('param-heartbeat');
        const offlineSelect = document.getElementById('param-offline-threshold');
        if (heartbeatInput) heartbeatInput.value = sensor.heartbeatPeriod;
        if (offlineSelect) offlineSelect.value = sensor.offlineThreshold;
        
        // 隐藏警告
        const warningRow = document.getElementById('heartbeat-warning-row');
        if (warningRow) warningRow.style.display = 'none';
        
        // 执行一次心跳联动校验
        this.validateHeartbeat();
    },
    
    getParams() {
        const intervalSelect = document.getElementById('param-interval-select');
        const intervalInput = document.getElementById('param-interval');
        let uploadInterval = intervalSelect?.value === 'custom' 
            ? parseInt(intervalInput?.value) 
            : parseInt(intervalSelect?.value);
        
        return {
            sampleFrequency: parseFloat(document.getElementById('param-frequency')?.value),
            uploadInterval: uploadInterval,
            heartbeatPeriod: parseInt(document.getElementById('param-heartbeat')?.value),
            offlineThreshold: parseInt(document.getElementById('param-offline-threshold')?.value)
        };
    },
    
    close() {
        this.overlay.classList.remove('active');
        this.drawer.classList.remove('active');
        this.currentSensor = null;
        this.currentSubSensor = null;
        this.stopAutoUpdate();
    },
    
    showResult(success, message) {
        const resultEl = document.getElementById('footer-result');
        if (!resultEl) return;
        
        resultEl.className = 'footer-result show ' + (success ? 'success' : 'error');
        resultEl.querySelector('.result-icon').textContent = success ? '✓' : '✕';
        resultEl.querySelector('.result-text').textContent = message;
        resultEl.querySelector('.result-time').textContent = this.formatTime();
        
        setTimeout(() => this.hideResult(), 5000);
    },
    
    hideResult() {
        const resultEl = document.getElementById('footer-result');
        if (resultEl) resultEl.className = 'footer-result';
    },
    
    connectToIP() {
        const ipSelect = document.getElementById('drawer-ip-select');
        const connectBtn = document.getElementById('ip-connect-btn');
        if (!ipSelect || !connectBtn) return;
        
        const ip = ipSelect.value;
        connectBtn.textContent = '连接中...';
        connectBtn.classList.add('connecting');
        
        // 模拟连接过程
        setTimeout(() => {
            connectBtn.textContent = '已连接';
            connectBtn.classList.remove('connecting');
            this.showResult(true, `已连接到 ${ip}`);
            
            // 更新当前传感器的IP
            if (this.currentSensor && this.sensors[this.currentSensor]) {
                this.sensors[this.currentSensor].connectedIP = ip;
            }
            
            // 2秒后恢复按钮文字
            setTimeout(() => {
                connectBtn.textContent = '连接';
            }, 2000);
        }, 800);
    },
    
    readConfig() {
        if (!this.currentSensor) return;
        const sensor = this.sensors[this.currentSensor];
        
        this.loadSensorParams(sensor);
        this.showResult(true, '已读取设备当前配置');
    },
    
    resetDefaults() {
        // 恢复默认值
        const freqSelect = document.getElementById('param-frequency');
        const freqSlider = document.getElementById('param-frequency-slider');
        if (freqSelect) freqSelect.value = 1;
        if (freqSlider) freqSlider.value = 1;
        
        const intervalSelect = document.getElementById('param-interval-select');
        const intervalInput = document.getElementById('param-interval');
        const intervalCustomRow = document.getElementById('interval-custom-row');
        if (intervalSelect) intervalSelect.value = 5;
        if (intervalInput) intervalInput.value = 5;
        if (intervalCustomRow) intervalCustomRow.style.display = 'none';
        
        // 心跳周期恢复默认
        const heartbeatInput = document.getElementById('param-heartbeat');
        const offlineSelect = document.getElementById('param-offline-threshold');
        if (heartbeatInput) heartbeatInput.value = 30;
        if (offlineSelect) offlineSelect.value = 3;
        
        // 隐藏警告
        const warningRow = document.getElementById('heartbeat-warning-row');
        if (warningRow) warningRow.style.display = 'none';
        
        document.querySelectorAll('.param-input').forEach(input => input.classList.remove('invalid'));
        
        this.showResult(true, '已恢复默认参数');
    },
    
    validateAll() {
        let valid = true;
        const params = this.getParams();
        
        // 校验采样频率
        if (!this.paramSpecs.sampleFrequency.allowedValues.includes(params.sampleFrequency)) {
            valid = false;
        }
        
        // 校验上报周期
        if (isNaN(params.uploadInterval) || params.uploadInterval < 1 || params.uploadInterval > 300) {
            document.getElementById('param-interval')?.classList.add('invalid');
            valid = false;
        }
        
        // 校验心跳周期
        if (isNaN(params.heartbeatPeriod) || params.heartbeatPeriod < 1 || params.heartbeatPeriod > 600) {
            document.getElementById('param-heartbeat')?.classList.add('invalid');
            valid = false;
        }
        
        // 校验离线判定阈值
        if (!this.paramSpecs.offlineThreshold.allowedValues.includes(params.offlineThreshold)) {
            valid = false;
        }
        
        return valid;
    },
    
    apply() {
        if (!this.validateAll()) {
            this.showResult(false, '参数校验失败，请检查输入');
            return;
        }
        
        const params = this.getParams();
        console.log('应用参数:', this.currentSensor, params);
        this.showResult(true, '参数已应用（本地预览）');
    },
    
    send() {
        if (!this.validateAll()) {
            this.showResult(false, '参数校验失败，请检查输入');
            return;
        }
        
        const params = this.getParams();
        console.log('下发参数:', this.currentSensor, params);
        
        const btn = document.getElementById('drawer-btn-send');
        btn.disabled = true;
        btn.textContent = '下发中...';
        
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '下发';
            
            // 更新本地传感器配置
            if (this.currentSensor && this.sensors[this.currentSensor]) {
                Object.assign(this.sensors[this.currentSensor], params);
            }
            
            this.showResult(true, '参数已成功下发到设备');
        }, 800);
    }
};

function initSensorDrawer() {
    SensorDrawer.init();
    
    // ===== 调控按钮功能已注释 =====
    // 为所有调控按钮绑定点击事件
    // document.querySelectorAll('.sensor-ctrl-btn').forEach(btn => {
    //     btn.addEventListener('click', (e) => {
    //         const panel = e.target.closest('.fire-panel');
    //         if (!panel) return;
    //
    //         let sensorType = 'temperature';
    //         if (panel.classList.contains('sensor-smoke')) {
    //             sensorType = 'smoke';
    //         } else if (panel.classList.contains('sensor-light')) {
    //             sensorType = 'lightwind'; // 光照/风速传感器组
    //         }
    //
    //         SensorDrawer.open(sensorType);
    //     });
    // });
}
