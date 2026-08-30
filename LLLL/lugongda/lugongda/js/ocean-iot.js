/**
 * 远海远域物联通信场景专用脚本 - 重构版
 */

// 场景数据管理
const OceanIoTScene = {
    // 传感器图表实例
    sensorChart: null,
    lightSoundChart: null,
    gatewayChart: null,
    windChart: null,
    
    // 当前传感器数值（用于控制面板同步）
    currentTemp: 26.5,
    currentHumidity: 65.0,
    currentWind: 6.8,
    currentLight: 7200,
    currentLoudness: 56,
    linkPopupAutoCloseTimer: null,
    lastAlarmTimestampMs: 0,

    formatHMS(d) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    },
    
    // 传感器历史数据
    sensorHistory: {
        temperature: [],
        humidity: [],
        timestamps: []
    },

    // 风力历史数据
    windHistory: {
        speed: [],
        direction: [],  // 风向角度 0-360
        timestamps: []
    },

    // 光照与响度历史数据
    lightSoundHistory: {
        light: [],
        loudness: [],
        timestamps: []
    },

    // 风向角度转方位文字
    degToDirection(deg) {
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(deg / 22.5) % 16;
        return dirs[index];
    },

    gatewayHistory: {
        latency: [],
        loss: [],
        upload: [],
        timestamps: []
    },
    
    // 传感器阈值
    thresholds: {
        temperature: { warning: 32, alert: 38 },
        humidity: { warning: 80, alert: 90 },
        wind: { warning: 17.2, alert: 24.5 },  // 8级风=17.2m/s, 10级风=24.5m/s
        light: { warning: 9000, alert: 11000 },
        loudness: { warning: 72, alert: 85 }
    },
    
    // 网关状态
    gateway: {
        status: 'online',
        link: '5G',
        lastTime: null,
        latency: 45,
        lossRate: 0.2,
        uplinkMbps: 5.2,
        pendingPackets: 0,
        isRetransmitting: false,
        retransmitProgress: 100
    },
    
    // RFID统计
    rfidStats: {
        scanned: 0,
        planned: 12,
        passed: 0,
        blocked: 0
    },

    // 摄像头监控状态（仅实时流，不拉取snapshot2）
    cameraMonitor: {
        streamUrl: 'http://36.152.33.88:8081/media/get_video_only.jsp',
        fallbackStreamUrls: [
            'http://36.152.33.88:8081/media/video_only/latest.jpg'
        ],
        currentStreamIndex: 0,
        polling: false,
        resultVisible: false
    },

    rfidRecent: [],
    rfidAbnormal: [],
    
    // 事件时间线
    events: [],
    
    // 资产清单（模拟数据）
    assetList: [
        { name: '集装箱A-001', rfid: 'RFID-8A3F2B1C', authorized: true },
        { name: '集装箱A-002', rfid: 'RFID-9B4G3C2D', authorized: true },
        { name: '集装箱B-001', rfid: 'RFID-7C2E1A0B', authorized: true },
        { name: '危险品箱C-001', rfid: 'RFID-6D1F0B9A', authorized: false },
        { name: '未知设备', rfid: 'RFID-UNKNOWN', authorized: false },
        { name: '电子设备箱D-001', rfid: 'RFID-5E0G9C8D', authorized: true },
        { name: '精密仪器箱E-001', rfid: 'RFID-4F9H8D7E', authorized: true },
        { name: '未授权设备X', rfid: 'RFID-INVALID', authorized: false }
    ],
    
    // 初始化场景
    init() {
        console.log('远海远域物联通信场景初始化...');
        this.initButtons();
        this.initKeyboardShortcuts();
        this.initCameraMonitor();
        this.initLightSoundChart();
        this.initSensorChart();
        this.initWindChart();
        this.setCommMode('5g', { silent: true });
        this.initTimeline();
        this.updateRFIDUI();
        this.updateKeyStatus();
        
        // 启动定时更新
        setInterval(() => this.updateLightSoundData(), 4000);
        setInterval(() => this.updateSensorData(), 3000);
        setInterval(() => this.updateWindData(), 5000);  // 风力数据5秒更新
        setInterval(() => this.simulateEvents(), 8000);
    },

    initLightSoundChart() {
        const chartDom = document.getElementById('light-sound-chart');
        if (!chartDom) return;

        this.lightSoundChart = echarts.init(chartDom);

        for (let i = 0; i < 6; i++) {
            this.lightSoundHistory.light.push(Math.round(6500 + Math.random() * 2200));
            this.lightSoundHistory.loudness.push(Math.round(45 + Math.random() * 18));
            const time = new Date(Date.now() - (5 - i) * 4000);
            this.lightSoundHistory.timestamps.push(this.formatHMS(time));
        }

        this.updateLightSoundCards();
        this.renderLightSoundChart();

        window.addEventListener('resize', () => {
            if (this.lightSoundChart) this.lightSoundChart.resize();
        });
    },

    renderLightSoundChart() {
        if (!this.lightSoundChart) return;

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                borderColor: '#00d4ff',
                textStyle: { color: '#fff', fontSize: 11 }
            },
            legend: {
                data: ['光照(Lux)', '响度(dB)'],
                top: 4,
                textStyle: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 11 }
            },
            grid: {
                left: '8%', right: '10%', top: '18%', bottom: '14%', containLabel: true
            },
            xAxis: {
                type: 'category',
                data: this.lightSoundHistory.timestamps,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.25)' } },
                axisLabel: { color: '#67c5ff', fontSize: 9, interval: 0, rotate: 25 }
            },
            yAxis: [
                {
                    type: 'value',
                    name: 'Lux',
                    nameTextStyle: { color: '#67c5ff', fontSize: 10 },
                    axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.25)' } },
                    axisLabel: { color: 'rgba(255, 255, 255, 0.6)', fontSize: 10 },
                    splitLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.08)' } }
                },
                {
                    type: 'value',
                    name: 'dB',
                    nameTextStyle: { color: '#67c5ff', fontSize: 10 },
                    axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.25)' } },
                    axisLabel: { color: 'rgba(255, 255, 255, 0.6)', fontSize: 10 },
                    splitLine: { show: false }
                }
            ],
            series: [
                {
                    name: '光照(Lux)',
                    type: 'line',
                    smooth: true,
                    data: this.lightSoundHistory.light,
                    lineStyle: { color: '#fbbf24', width: 2.4 },
                    itemStyle: { color: '#fbbf24' },
                    areaStyle: { color: 'rgba(251, 191, 36, 0.12)' }
                },
                {
                    name: '响度(dB)',
                    type: 'line',
                    yAxisIndex: 1,
                    smooth: true,
                    data: this.lightSoundHistory.loudness,
                    lineStyle: { color: '#22d3ee', width: 2.4 },
                    itemStyle: { color: '#22d3ee' },
                    areaStyle: { color: 'rgba(34, 211, 238, 0.1)' }
                }
            ]
        };

        this.lightSoundChart.setOption(option);
    },

    updateLightSoundCards() {
        const light = this.lightSoundHistory.light[this.lightSoundHistory.light.length - 1] || this.currentLight;
        const loudness = this.lightSoundHistory.loudness[this.lightSoundHistory.loudness.length - 1] || this.currentLoudness;

        this.currentLight = Number(light);
        this.currentLoudness = Number(loudness);

        const lightEl = document.getElementById('val-light');
        const loudnessEl = document.getElementById('val-loudness');
        if (lightEl) lightEl.textContent = String(light);
        if (loudnessEl) loudnessEl.textContent = String(loudness);

        const lightCard = document.getElementById('sensor-light');
        const loudnessCard = document.getElementById('sensor-loudness');

        if (lightCard) {
            lightCard.className = 'sensor-card' + (light >= this.thresholds.light.alert ? ' alert' : light >= this.thresholds.light.warning ? ' warning' : '');
        }
        if (loudnessCard) {
            loudnessCard.className = 'sensor-card' + (loudness >= this.thresholds.loudness.alert ? ' alert' : loudness >= this.thresholds.loudness.warning ? ' warning' : '');
        }
    },

    updateLightSoundData() {
        const newLight = Math.round(6500 + Math.random() * 2600);
        const newLoudness = Math.round(45 + Math.random() * 24);

        this.lightSoundHistory.light.push(newLight);
        this.lightSoundHistory.loudness.push(newLoudness);
        this.lightSoundHistory.timestamps.push(this.formatHMS(new Date()));

        if (this.lightSoundHistory.light.length > 6) {
            this.lightSoundHistory.light.shift();
            this.lightSoundHistory.loudness.shift();
            this.lightSoundHistory.timestamps.shift();
        }

        this.renderLightSoundChart();
        this.updateLightSoundCards();
        this.addEvent('upload', '光照/响度数据上报');
    },
    
    // 初始化按钮
    initButtons() {
        const demoNormal = document.getElementById('rfid-demo-normal');
        const demoAbnormal = document.getElementById('rfid-demo-abnormal');
        if (demoNormal) demoNormal.addEventListener('click', () => this.performRFIDScan({ mode: 'normal' }));
        if (demoAbnormal) demoAbnormal.addEventListener('click', () => this.performRFIDScan({ mode: 'abnormal' }));

        const startBtn = document.getElementById('btn-ocean-start');
        const stopBtn = document.getElementById('btn-ocean-stop');
        const resultBtn = document.getElementById('btn-ocean-result');

        if (startBtn) startBtn.addEventListener('click', () => this.startCameraMonitor());
        if (stopBtn) stopBtn.addEventListener('click', () => this.stopCameraMonitor());
        if (resultBtn) {
            resultBtn.addEventListener('click', () => {
                this.cameraMonitor.resultVisible = !this.cameraMonitor.resultVisible;
                this.updateCameraResultVisibility();
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

    applyCommState(state, options = {}) {
        const indicator5g = document.getElementById('ocean-comm-indicator-5g');
        const indicatorTiantong = document.getElementById('ocean-comm-indicator-tiantong');
        const indicatorShortwave = document.getElementById('ocean-comm-indicator-shortwave');
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
            const item = el.closest('.ocean-comm-method-item');
            if (item) item.classList.toggle('active-route', isOnline);
        });

        if (state['5g'] && state.shortwave) {
            this.gateway.link = '5G+短波';
        } else if (state['5g']) {
            this.gateway.link = '5G';
        } else if (state.tiantong) {
            this.gateway.link = '天通';
        } else if (state.shortwave) {
            this.gateway.link = '短波';
        }

        if (!options.silent) {
            this.updateGatewayUI();
            this.syncCameraResultMeta();
        }
    },

    setCommMode(mode, options = {}) {
        const state = {
            '5g': false,
            tiantong: false,
            shortwave: false
        };
        if (Object.prototype.hasOwnProperty.call(state, mode)) {
            state[mode] = true;
        }
        this.applyCommState(state, options);
    },

    setCommRecoveryState(options = {}) {
        this.applyCommState({
            '5g': true,
            tiantong: false,
            shortwave: true
        }, options);
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
        const toastId = 'ocean-link-toast';
        let toast = document.getElementById(toastId);

        if (!toast) {
            toast = document.createElement('div');
            toast.id = toastId;
            toast.className = 'ocean-link-toast';
            toast.innerHTML = `
                <div class="ocean-link-card" id="ocean-link-card" role="alert" aria-live="assertive">
                    <div class="ocean-link-header">
                        <span class="ocean-link-icon" id="ocean-link-icon">!</span>
                        <span id="ocean-link-title">链路异常告警</span>
                    </div>
                    <div class="ocean-link-message" id="ocean-link-message"></div>
                </div>
            `;
            document.body.appendChild(toast);
        }

        const cardEl = document.getElementById('ocean-link-card');
        const iconEl = document.getElementById('ocean-link-icon');
        const titleEl = document.getElementById('ocean-link-title');
        const messageEl = document.getElementById('ocean-link-message');

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
                <div class="ocean-link-message-main">${config.mainMessage || ''}</div>
                <div class="ocean-link-message-sub">${config.subMessage || ''}</div>
                <div class="ocean-link-statusbar">${config.statusMessage || ''}</div>
                <span class="ocean-link-timestamp">[发生时间: ${timestamp}]</span>
            `;
        }

        clearTimeout(this.linkPopupAutoCloseTimer);
        toast.classList.add('show');
        const closeDelay = 5000 + Math.floor(Math.random() * 3001);
        this.linkPopupAutoCloseTimer = setTimeout(() => {
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
        this.showLinkWarningPopup(alarmTs);
        this.addEvent('alert', '5G链路阻断→短波接管', true);
    },

    triggerLinkRecovery() {
        const now = Date.now();
        const recoveryTs = Math.max(now, this.lastAlarmTimestampMs + 1);
        this.setCommRecoveryState();
        this.showLinkRecoveryPopup(recoveryTs);
        this.addEvent('comm', '主链路恢复→5G全速运行');
    },

    initCameraMonitor() {
        this.updateCameraResultVisibility();
        this.syncCameraResultMeta();
    },

    updateCameraResultVisibility() {
        const overlay = document.getElementById('ocean-result-overlay');
        const resultBtn = document.getElementById('btn-ocean-result');
        if (overlay) overlay.style.display = this.cameraMonitor.resultVisible ? 'block' : 'none';
        if (resultBtn) {
            resultBtn.classList.toggle('active', this.cameraMonitor.resultVisible);
            resultBtn.textContent = this.cameraMonitor.resultVisible ? '📊 隐藏检测结果' : '📊 显示检测结果';
        }
    },

    syncCameraResultMeta() {
        const commEl = document.getElementById('ocean-result-comm');
        if (commEl) commEl.textContent = this.gateway.link || '--';
    },

    setCameraStatus(text) {
        const statusEl = document.getElementById('ocean-result-status');
        const timeEl = document.getElementById('ocean-result-time');
        if (statusEl) statusEl.textContent = text;
        if (timeEl) timeEl.textContent = this.formatHMS(new Date());
    },

    fetchNextCameraFrame() {
        if (!this.cameraMonitor.polling) return;

        const canvas = document.getElementById('ocean-stream-canvas');
        const placeholder = document.querySelector('#ocean-camera-view .camera-placeholder');
        if (!canvas || !placeholder) return;

        const streamUrls = [this.cameraMonitor.streamUrl].concat(this.cameraMonitor.fallbackStreamUrls || []);
        const streamIndex = this.cameraMonitor.currentStreamIndex || 0;
        const streamUrl = streamUrls[streamIndex] || this.cameraMonitor.streamUrl;
        const img = new Image();
        img.onload = () => {
            if (!this.cameraMonitor.polling) return;
            this.cameraMonitor.currentStreamIndex = streamIndex;

            const ctx = canvas.getContext('2d', { alpha: false });
            const frameWidth = img.naturalWidth || img.width;
            const frameHeight = img.naturalHeight || img.height;
            if (frameWidth > 0 && frameHeight > 0 && (canvas.width !== frameWidth || canvas.height !== frameHeight)) {
                canvas.width = frameWidth;
                canvas.height = frameHeight;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            canvas.style.display = 'block';
            placeholder.style.display = 'none';
            this.setCameraStatus('检测中');

            setTimeout(() => this.fetchNextCameraFrame(), 30);
        };

        img.onerror = () => {
            if (!this.cameraMonitor.polling) return;
            if (streamIndex < streamUrls.length - 1) {
                this.cameraMonitor.currentStreamIndex = streamIndex + 1;
            }
            this.setCameraStatus('连接重试中');
            setTimeout(() => this.fetchNextCameraFrame(), 200);
        };

        img.src = `${streamUrl}?t=${Date.now()}`;
    },

    startCameraMonitor() {
        if (this.cameraMonitor.polling) return;
        this.cameraMonitor.polling = true;
        this.cameraMonitor.currentStreamIndex = 0;

        const placeholder = document.querySelector('#ocean-camera-view .camera-placeholder');
        if (placeholder) {
            placeholder.style.display = 'flex';
            const statusText = placeholder.querySelector('.camera-status');
            if (statusText) statusText.textContent = '连接中...';
        }

        this.syncCameraResultMeta();
        this.setCameraStatus('连接中');
        this.fetchNextCameraFrame();
        this.addEvent('upload', '摄像头检测启动');
    },

    stopCameraMonitor() {
        this.cameraMonitor.polling = false;

        const canvas = document.getElementById('ocean-stream-canvas');
        const placeholder = document.querySelector('#ocean-camera-view .camera-placeholder');
        if (canvas) canvas.style.display = 'none';
        if (placeholder) {
            placeholder.style.display = 'flex';
            const statusText = placeholder.querySelector('.camera-status');
            if (statusText) statusText.textContent = '检测已停止';
        }

        this.setCameraStatus('已停止');
        this.addEvent('upload', '摄像头检测结束');
    },
    
    // 初始化网关数据
    initGatewayData() {
        this.gateway.lastTime = new Date();
        this.initGatewayChart();
        this.seedGatewayHistory();
        this.updateGatewayUI();
    },

    initGatewayChart() {
        const dom = document.getElementById('gateway-trend-chart');
        if (!dom) return;
        this.gatewayChart = echarts.init(dom);
        window.addEventListener('resize', () => {
            if (this.gatewayChart) this.gatewayChart.resize();
        });
    },

    seedGatewayHistory() {
        const points = 12;
        this.gatewayHistory.latency = [];
        this.gatewayHistory.loss = [];
        this.gatewayHistory.upload = [];
        this.gatewayHistory.timestamps = [];

        for (let i = points - 1; i >= 0; i--) {
            const t = new Date(Date.now() - i * 5000);
            const timeStr = this.formatHMS(t);
            this.gatewayHistory.timestamps.push(timeStr);
            this.gatewayHistory.latency.push(40 + Math.floor(Math.random() * 30));
            this.gatewayHistory.loss.push(parseFloat((Math.random() * 0.5).toFixed(2)));
            this.gatewayHistory.upload.push(parseFloat((4.5 + Math.random() * 2.5).toFixed(1)));
        }

        // 初始化阶段：KPI 与趋势图最后一个点严格一致
        const li = this.gatewayHistory.latency.length - 1;
        if (li >= 0) {
            this.gateway.latency = this.gatewayHistory.latency[li];
            this.gateway.lossRate = this.gatewayHistory.loss[li];
            this.gateway.uplinkMbps = this.gatewayHistory.upload[li];
            this.gateway.lastTime = new Date();
        }

        this.renderGatewayTrend();
    },
    
    // 初始化时间线
    initTimeline() {
        this.addEvent('comm', '系统启动→通信就绪');
        this.addEvent('upload', '传感器自检→完成');
        this.addEvent('comm', '链路已连接');
    },
    
    // 初始化传感器图表
    initSensorChart() {
        const chartDom = document.getElementById('sensor-chart');
        if (!chartDom) return;
        
        this.sensorChart = echarts.init(chartDom);
        
        // 初始化历史数据（最近6个数据点）
        for (let i = 0; i < 6; i++) {
            this.sensorHistory.temperature.push((26 + Math.random() * 4).toFixed(1));
            this.sensorHistory.humidity.push((65 + Math.random() * 8).toFixed(1));
            
            const time = new Date(Date.now() - (5 - i) * 3000);
            const timeStr = this.formatHMS(time);
            this.sensorHistory.timestamps.push(timeStr);
        }
        
        this.renderSensorChart();
        this.updateSensorCards();
        
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
                axisLabel: { color: '#67c5ff', fontSize: 9, margin: 10, interval: 0, rotate: 25, hideOverlap: false }
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
    
    // 更新传感器当前值卡片
    updateSensorCards() {
        const temp = parseFloat(this.sensorHistory.temperature[this.sensorHistory.temperature.length - 1]);
        const humidity = parseFloat(this.sensorHistory.humidity[this.sensorHistory.humidity.length - 1]);
        
        document.getElementById('val-temp').textContent = temp.toFixed(1);
        document.getElementById('val-humidity').textContent = humidity.toFixed(0);
        
        // 检查阈值并高亮
        const tempCard = document.getElementById('sensor-temp');
        const humidityCard = document.getElementById('sensor-humidity');
        
        tempCard.className = 'sensor-card' + (temp >= this.thresholds.temperature.alert ? ' alert' : temp >= this.thresholds.temperature.warning ? ' warning' : '');
        humidityCard.className = 'sensor-card' + (humidity >= this.thresholds.humidity.alert ? ' alert' : humidity >= this.thresholds.humidity.warning ? ' warning' : '');
    },
    
    // 更新传感器数据
    updateSensorData() {
        const newTemp = (26 + Math.random() * 6).toFixed(1);
        const newHumidity = (65 + Math.random() * 12).toFixed(1);
        
        // 更新当前值（用于控制面板同步）
        this.currentTemp = parseFloat(newTemp);
        this.currentHumidity = parseFloat(newHumidity);
        
        this.sensorHistory.temperature.push(newTemp);
        this.sensorHistory.humidity.push(newHumidity);
        
        const now = new Date();
        const timeStr = this.formatHMS(now);
        this.sensorHistory.timestamps.push(timeStr);
        
        if (this.sensorHistory.temperature.length > 6) {
            this.sensorHistory.temperature.shift();
            this.sensorHistory.humidity.shift();
            this.sensorHistory.timestamps.shift();
        }
        
        this.renderSensorChart();
        this.updateSensorCards();
        this.addEvent('upload', '传感器数据上报');
    },
    
    // 更新网关UI
    updateGatewayUI() {
        const gw = this.gateway;

        const statusEl = document.getElementById('gw-status-text');
        const linkEl = document.getElementById('gw-link-tag');
        const latencyEl = document.getElementById('gw-latency');
        const lossEl = document.getElementById('gw-loss');
        const uplinkEl = document.getElementById('gw-uplink');
        const pendingEl = document.getElementById('gw-pending');

        if (statusEl) {
            const statusText = gw.isRetransmitting ? '补传中' : (gw.status === 'online' ? '在线' : '离线缓存中');
            statusEl.textContent = statusText;
            statusEl.className = 'gateway-status' + (gw.status !== 'online' ? ' alert' : gw.isRetransmitting ? ' warning' : '');
        }
        if (linkEl) linkEl.textContent = gw.link;

        if (latencyEl) latencyEl.textContent = gw.latency + 'ms';
        if (lossEl) lossEl.textContent = (gw.lossRate * 100).toFixed(1) + '%';
        if (uplinkEl) uplinkEl.textContent = `${gw.uplinkMbps.toFixed(1)}Mbps`;
        if (pendingEl) {
            pendingEl.textContent = gw.pendingPackets;
            pendingEl.className = 'metric-value' + (gw.pendingPackets > 0 ? ' warning' : '');
        }
        
        const lastTimeEl = document.getElementById('gw-last-time');
        if (gw.lastTime && lastTimeEl) {
            const timeStr = `${String(gw.lastTime.getHours()).padStart(2, '0')}:${String(gw.lastTime.getMinutes()).padStart(2, '0')}:${String(gw.lastTime.getSeconds()).padStart(2, '0')}`;
            lastTimeEl.textContent = timeStr;
        }

        this.updateKeyStatus();
    },

    pushGatewayHistory() {
        const now = new Date();
        const timeStr = this.formatHMS(now);

        this.gatewayHistory.timestamps.push(timeStr);
        this.gatewayHistory.latency.push(this.gateway.latency);
        this.gatewayHistory.loss.push(parseFloat(this.gateway.lossRate.toFixed(2)));
        this.gatewayHistory.upload.push(parseFloat(this.gateway.uplinkMbps.toFixed(1)));

        const max = 12;
        if (this.gatewayHistory.timestamps.length > max) {
            this.gatewayHistory.timestamps.shift();
            this.gatewayHistory.latency.shift();
            this.gatewayHistory.loss.shift();
            this.gatewayHistory.upload.shift();
        }
    },

    renderGatewayTrend() {
        if (!this.gatewayChart) return;

        const timeLabels = this.gatewayHistory.timestamps;

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                borderColor: 'rgba(0, 212, 255, 0.35)',
                textStyle: { color: '#fff', fontSize: 11 },
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(255, 255, 255, 0.18)' } },
                formatter: (params) => {
                    const di = params?.[0]?.dataIndex ?? 0;
                    const t = this.gatewayHistory.timestamps[di] || '--:--:--';
                    const lines = [`${t}`];
                    params.forEach(p => lines.push(`${p.marker}${p.seriesName}：${p.data}`));
                    return lines.join('<br/>');
                }
            },
            legend: {
                data: ['时延(ms)', '丢包(%)'],
                top: 2,
                textStyle: { color: 'rgba(255, 255, 255, 0.65)', fontSize: 11 }
            },
            grid: { left: '7%', right: '9%', top: '18%', bottom: '12%', containLabel: true },
            xAxis: {
                type: 'category',
                data: timeLabels,
                boundaryGap: false,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.18)' } },
                axisTick: { show: false },
                axisLabel: { color: 'rgba(255, 255, 255, 0.45)', fontSize: 10, interval: 1, margin: 10 }
            },
            yAxis: [
                {
                    type: 'value',
                    axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.18)' } },
                    axisLabel: { color: 'rgba(255, 255, 255, 0.45)', fontSize: 10, formatter: (v) => v + 'ms', margin: 12 },
                    splitLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.06)' } }
                },
                {
                    type: 'value',
                    axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.18)' } },
                    axisLabel: { color: 'rgba(255, 255, 255, 0.45)', fontSize: 10, formatter: (v) => v + '%', margin: 12 },
                    splitLine: { show: false }
                }
            ],
            series: [
                {
                    name: '时延(ms)',
                    type: 'line',
                    data: this.gatewayHistory.latency,
                    smooth: false,
                    showSymbol: false,
                    lineStyle: { color: '#5eead4', width: 2.5 },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(94, 234, 212, 0.20)' },
                            { offset: 1, color: 'rgba(94, 234, 212, 0.02)' }
                        ])
                    },
                    emphasis: { focus: 'series' }
                },
                {
                    name: '丢包(%)',
                    type: 'line',
                    yAxisIndex: 1,
                    data: this.gatewayHistory.loss.map(v => parseFloat((v * 100).toFixed(1))),
                    smooth: false,
                    showSymbol: false,
                    lineStyle: { color: '#93c5fd', width: 2.5 },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(147, 197, 253, 0.14)' },
                            { offset: 1, color: 'rgba(147, 197, 253, 0.02)' }
                        ])
                    },
                    emphasis: { focus: 'series' }
                }
            ]
        };

        this.gatewayChart.setOption(option);
    },
    
    // 更新网关KPI
    updateGatewayKPI() {
        this.gateway.latency = 40 + Math.floor(Math.random() * 30);
        this.gateway.lossRate = Math.random() * 0.5;
        this.gateway.uplinkMbps = 4.5 + Math.random() * 2.8;
        this.gateway.lastTime = new Date();
        
        // 偶尔模拟断链
        if (Math.random() < 0.1 && !this.gateway.isRetransmitting) {
            this.simulateLinkFailure();
        }
        
        this.pushGatewayHistory();
        this.renderGatewayTrend();
        this.updateGatewayUI();
    },
    
    // 模拟断链
    simulateLinkFailure() {
        this.gateway.pendingPackets = Math.floor(Math.random() * 10) + 5;
        this.gateway.status = 'offline';
        this.gateway.isRetransmitting = false;
        this.gateway.retransmitProgress = 0;
        this.addEvent('comm', '断链→进入缓存');
        this.updateGatewayUI();

        setTimeout(() => {
            this.gateway.status = 'online';
            this.gateway.isRetransmitting = true;
            this.addEvent('comm', '链路恢复→开始补传');
            this.updateGatewayUI();

            // 模拟补传过程
            const retransmitInterval = setInterval(() => {
                this.gateway.retransmitProgress += 20;
                this.gateway.pendingPackets = Math.max(0, this.gateway.pendingPackets - 2);
                this.updateGatewayUI();
                
                if (this.gateway.retransmitProgress >= 100) {
                    clearInterval(retransmitInterval);
                    this.gateway.isRetransmitting = false;
                    this.gateway.pendingPackets = 0;
                    this.addEvent('comm', '补传完成');
                    this.updateGatewayUI();
                }
            }, 1500);
        }, 2500);
    },
    
    // RFID扫描
    performRFIDScan({ mode }) {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const channelPool = ['通道A', '通道B', '通道C'];
        const channel = channelPool[Math.floor(Math.random() * channelPool.length)];

        let asset;
        let authorized;
        let reason = '';

        if (mode === 'normal') {
            const list = this.assetList.filter(a => a.authorized);
            asset = list[Math.floor(Math.random() * list.length)];
            authorized = true;
        } else {
            const list = this.assetList.filter(a => !a.authorized);
            asset = list[Math.floor(Math.random() * list.length)];
            authorized = false;
            const reasons = ['不在计划', '未授权'];
            reason = reasons[Math.floor(Math.random() * reasons.length)];
        }

        this.rfidStats.scanned++;

        const record = {
            time: timeStr,
            assetName: asset.name,
            rfid: asset.rfid,
            channel,
            authorized,
            reason
        };

        this.rfidRecent.unshift(record);
        this.rfidRecent = this.rfidRecent.slice(0, 5);
        if (!authorized) {
            this.rfidAbnormal.unshift(record);
            this.rfidAbnormal = this.rfidAbnormal.slice(0, 10);
        }

        if (authorized) {
            this.rfidStats.passed++;
            this.addEvent('rfid', `卸货放行：${asset.name}`);
        } else {
            this.rfidStats.blocked++;
            this.addEvent('alert', `异常带离：设备#${asset.name}（已拦截）`, true);
        }

        this.updateRFIDLatestCard(record);
        this.renderRFIDLists();
        this.updateRFIDUI();
        this.updateKeyStatus();
    },

    updateRFIDLatestCard(record) {
        const card = document.getElementById('rfid-latest-card');
        const state = document.getElementById('rfid-latest-state');
        const main = document.getElementById('rfid-main-result');

        document.getElementById('rfid-asset').textContent = record.assetName;
        document.getElementById('rfid-code').textContent = record.rfid;
        document.getElementById('rfid-channel').textContent = record.channel;

        const resultEl = document.getElementById('rfid-result');
        const reasonRow = document.getElementById('rfid-reason-row');
        const reasonEl = document.getElementById('rfid-reason');

        if (record.authorized) {
            if (card) card.className = 'rfid-latest-compact passed';
            if (state) state.textContent = `放行 · ${record.time}`;
            if (main) {
                main.textContent = '放行';
                main.className = 'rfid-main-result-compact passed';
            }
            if (resultEl) resultEl.textContent = '放行';
            if (reasonRow) reasonRow.style.display = 'none';
        } else {
            if (card) card.className = 'rfid-latest-compact blocked';
            if (state) state.textContent = `告警 · ${record.time}`;
            if (main) {
                main.textContent = '设备被带走';
                main.className = 'rfid-main-result-compact blocked';
            }
            if (resultEl) resultEl.textContent = '拦截';
            if (reasonRow) reasonRow.style.display = 'flex';
            if (reasonEl) reasonEl.textContent = record.reason || '未授权';
        }
    },

    updateRFIDUI() {
        const scannedNum = document.getElementById('rfid-scanned-num');
        const plannedNum = document.getElementById('rfid-planned-num');
        const fill = document.getElementById('rfid-progress-fill');
        const passed = document.getElementById('rfid-passed');
        const blocked = document.getElementById('rfid-blocked');

        if (scannedNum) scannedNum.textContent = this.rfidStats.scanned;
        if (plannedNum) plannedNum.textContent = this.rfidStats.planned;
        if (passed) passed.textContent = this.rfidStats.passed;
        if (blocked) blocked.textContent = this.rfidStats.blocked;
        if (fill) {
            const pct = this.rfidStats.planned > 0 ? Math.min(100, (this.rfidStats.scanned / this.rfidStats.planned) * 100) : 0;
            fill.style.width = pct.toFixed(0) + '%';
        }

        const card = document.getElementById('rfid-latest-card');
        if (this.rfidStats.scanned === 0 && card) {
            const state = document.getElementById('rfid-latest-state');
            const main = document.getElementById('rfid-main-result');
            const reasonRow = document.getElementById('rfid-reason-row');
            card.className = 'rfid-latest-compact';
            if (state) state.textContent = '等待扫描';
            if (main) {
                main.textContent = '等待扫描';
                main.className = 'rfid-main-result-compact';
            }
            if (reasonRow) reasonRow.style.display = 'none';
        }
    },

    renderRFIDLists() {
        // 列表功能已移除（融合后精简），保留空函数以兼容
        return;

        const renderList = (container, list, emptyText) => {
            container.innerHTML = '';
            if (!list.length) {
                const empty = document.createElement('div');
                empty.className = 'rfid-empty';
                empty.textContent = emptyText;
                container.appendChild(empty);
                return;
            }

            list.forEach(item => {
                const row = document.createElement('div');
                row.className = 'rfid-list-item';
                row.innerHTML = `
                    <div class="rfid-item-main">
                        <div class="rfid-item-title">${item.assetName} · ${item.channel}</div>
                        <div class="rfid-item-sub">${item.rfid} · ${item.time}</div>
                    </div>
                    <div class="rfid-item-badge ${item.authorized ? 'passed' : 'blocked'}">${item.authorized ? '放行' : '拦截'}</div>
                `;
                container.appendChild(row);
            });
        };

        renderList(recentEl, this.rfidRecent, '暂无记录');
        renderList(abnormalEl, this.rfidAbnormal, '暂无异常');
    },

    updateKeyStatus() {
        const el = document.getElementById('timeline-key-status');
        if (!el) return;

        const hasAlert = this.events.some(e => e.isAlert);
        if (hasAlert) {
            el.textContent = '告警中';
            el.className = 'timeline-key-status-mini alert';
            return;
        }

        if (this.gateway.isRetransmitting) {
            el.textContent = '补传中';
            el.className = 'timeline-key-status-mini warning';
            return;
        }

        el.textContent = '正常';
        el.className = 'timeline-key-status-mini';
    },
    
    // 添加事件到时间线
    addEvent(type, text, isAlert = false) {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        // 检查是否可以合并
        const lastEvent = this.events[0];
        if (lastEvent && lastEvent.type === type && lastEvent.text === text) {
            lastEvent.count = (lastEvent.count || 1) + 1;
            lastEvent.isAlert = lastEvent.isAlert || isAlert;
            this.renderTimeline();
            this.updateKeyStatus();
            return;
        }
        
        this.events.unshift({ type, text, time: timeStr, isAlert, count: 1 });
        
        // 限制事件数量
        if (this.events.length > 20) {
            this.events.pop();
        }
        
        this.renderTimeline();
        this.updateKeyStatus();
    },
    
    // 渲染时间线
    renderTimeline() {
        const container = document.getElementById('event-timeline');
        if (!container) return;
        
        container.innerHTML = '';

        const alerts = this.events.filter(e => e.isAlert);
        const normals = this.events.filter(e => !e.isAlert);
        const displayEvents = alerts.concat(normals);

        displayEvents.forEach(event => {
            const item = document.createElement('div');
            item.className = 'timeline-item' + (event.isAlert ? ' alert' : '');
            
            const tagClass = event.type;
            const tagText = { comm: '通信', upload: '上报', rfid: 'RFID', alert: '告警' }[event.type] || event.type;
            
            item.innerHTML = `
                <div class="timeline-time">${event.time}</div>
                <div class="timeline-content">
                    <span class="timeline-tag ${tagClass}">${tagText}</span>
                    <span class="timeline-text">${event.text}</span>
                    ${event.count > 1 ? `<span class="timeline-count">×${event.count}</span>` : ''}
                </div>
            `;
            
            container.appendChild(item);
        });
    },
    
    // 模拟随机事件
    simulateEvents() {
        const events = [
            { type: 'upload', text: '上报成功' },
            { type: 'comm', text: '链路保持稳定' }
        ];
        
        const event = events[Math.floor(Math.random() * events.length)];
        this.addEvent(event.type, event.text);
    },

    // ========== 海口环海公路真实风力模拟 ==========
    // 基于海口北部海岸（琼州海峡南岸）7月海陆风特征生成真实感数据
    // 白天：海风从 NNE（琼州海峡）吹来，风速 3-8 m/s，下午最强
    // 夜晚：陆风从 SSW（海南岛内陆）吹来，风速 1-3 m/s
    // 7月属台风季节，偶有强阵风；每年 5-11 月为海南台风季
    generateRealisticWind(prevDirection, targetHour) {
        const hour = (targetHour != null) ? targetHour : (() => {
            const d = new Date();
            return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
        })();

        // ---- 1. 风速模拟 ----
        // 海口沿海 7 月基准风速约 3.2 m/s
        const baseSpeed = 3.2;

        // 昼夜正弦波：峰值 14:00（海风最强），谷值 2:00（陆风最弱）
        const hourAngle = (hour - 2) * Math.PI / 12;
        const diurnalFactor = Math.sin(hourAngle);          // -1 ~ +1
        const diurnalAmplitude = 2.6;                        // 昼夜振幅

        // 海陆风爬升/衰减（非线性过渡）
        let seaBreezeBoost = 0;
        if (hour >= 7.5 && hour < 10.5) {
            seaBreezeBoost = (hour - 7.5) / 3 * 2.2;        // 海风建立期 0→2.2
        } else if (hour >= 10.5 && hour < 15) {
            seaBreezeBoost = 2.2;                            // 海风最强平台期
        } else if (hour >= 15 && hour < 18) {
            seaBreezeBoost = (18 - hour) / 3 * 2.2;          // 海风消退期 2.2→0
        }

        // 湍流扰动（模拟瞬时阵性风波动）
        const turbulence = (Math.random() - 0.5) * 1.4;

        // 阵风事件（约 10% 概率，每次持续约 5 秒可见）
        let gustFactor = 1.0;
        const isGust = Math.random() < 0.10;
        if (isGust) {
            gustFactor = 1.25 + Math.random() * 0.65;        // 1.25 ~ 1.9 倍瞬时风速
        }

        // 台风季远距影响（约 3% 概率出现异常高风速）
        let typhoonSurge = 0;
        const isTyphoonInfluence = Math.random() < 0.03;
        if (isTyphoonInfluence) {
            typhoonSurge = 3 + Math.random() * 10;           // 额外 3~13 m/s
        }

        let speed = (baseSpeed
            + diurnalFactor * diurnalAmplitude
            + seaBreezeBoost
            + turbulence
            + typhoonSurge) * gustFactor;

        speed = Math.max(0.2, Math.min(38, speed));          // 钳制 0.2~38 m/s
        speed = Math.round(speed * 10) / 10;                  // 保留 1 位小数

        // ---- 2. 风向模拟 ----
        // 海口北岸：白天海风 NNE≈22.5°，夜晚陆风 SSW≈202.5°
        const seaBreezeDir = 22.5;    // NNE — 琼州海峡 → 陆地
        const landBreezeDir = 202.5;  // SSW — 海南岛内陆 → 海洋

        // 风向转换比风速滞后约 1.5 小时
        const dirAngle = (hour - 3.5) * Math.PI / 12;
        const dirFraction = (Math.sin(dirAngle) + 1) / 2;    // 0(夜)=陆风 → 1(昼)=海风

        // 处理 360° 环绕
        let rawBaseDir = landBreezeDir + dirFraction * (seaBreezeDir - landBreezeDir + 360);
        if (rawBaseDir >= 360) rawBaseDir -= 360;

        // 风向短周期摆动 ±18°
        const dirJitter = (Math.random() - 0.5) * 36;

        // 基于前一风向平滑（单次跳变不超过 40°）
        let direction;
        if (prevDirection != null) {
            let candidate = rawBaseDir + dirJitter;
            let diff = candidate - prevDirection;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            diff = Math.max(-40, Math.min(40, diff));
            direction = ((prevDirection + diff) % 360 + 360) % 360;
        } else {
            direction = ((rawBaseDir + dirJitter) % 360 + 360) % 360;
        }
        direction = Math.round(direction);

        return { speed, direction };
    },

    // ========== 极地风力监测数据 ==========
    initWindChart() {
        const chartDom = document.getElementById('wind-chart');
        if (!chartDom) return;
        
        this.windChart = echarts.init(chartDom);
        
        // 初始化历史数据（最近6个数据点，每点间隔5秒，基于真实昼夜风场）
        let prevDir = null;
        for (let i = 0; i < 6; i++) {
            const offsetMs = (5 - i) * 5000;                       // 从早到晚排列
            const pastTime = new Date(Date.now() - offsetMs);
            const pastHour = pastTime.getHours() + pastTime.getMinutes() / 60 + pastTime.getSeconds() / 3600;

            const wind = this.generateRealisticWind(prevDir, pastHour);
            this.windHistory.speed.push(wind.speed.toFixed(1));
            this.windHistory.direction.push(wind.direction);
            this.windHistory.timestamps.push(this.formatHMS(pastTime));
            prevDir = wind.direction;
        }
        
        this.renderWindChart();
        this.updateWindCard();
        
        window.addEventListener('resize', () => {
            if (this.windChart) this.windChart.resize();
        });
    },

    renderWindChart() {
        if (!this.windChart) return;

        const timeLabels = this.windHistory.timestamps;
        const self = this;
        
        // 生成带风向箭头的数据点
        const dataWithArrows = this.windHistory.speed.map((speed, idx) => {
            const dir = this.windHistory.direction[idx];
            return {
                value: speed,
                symbol: 'path://M0,-8 L3,0 L0,-2 L-3,0 Z',
                symbolSize: [8, 12],
                symbolRotate: dir,
                symbolOffset: [0, -18],
                itemStyle: {
                    color: 'rgba(103, 197, 255, 0.5)',
                    shadowColor: 'rgba(103, 197, 255, 0.3)',
                    shadowBlur: 4
                }
            };
        });
        
        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                borderColor: 'rgba(0, 212, 255, 0.4)',
                borderWidth: 1,
                borderRadius: 6,
                padding: [8, 12],
                textStyle: { color: '#fff', fontSize: 12 },
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(255, 255, 255, 0.18)' } },
                formatter: (params) => {
                    const di = params?.[0]?.dataIndex ?? 0;
                    const t = self.windHistory.timestamps[di] || '--:--:--';
                    const speed = parseFloat(self.windHistory.speed[di]) || '--';
                    const dir = self.windHistory.direction[di] ?? 0;
                    const dirText = self.degToDirection(dir);
                    return `<div style="font-size:11px;color:rgba(255,255,255,0.65);margin-bottom:4px;">${t}</div>` +
                           `<div style="margin-bottom:3px;">风速：<span style="color:#22d3ee;font-weight:bold;">${speed}</span> m/s</div>` +
                           `<div>来风方向：<span style="color:#67c5ff;font-weight:bold;">${dirText} ${dir}°</span></div>`;
                }
            },
            grid: {
                left: '8%', right: '6%', top: '18%', bottom: '15%', containLabel: true
            },
            xAxis: {
                type: 'category',
                data: timeLabels,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.3)' } },
                axisTick: { show: false },
                axisLabel: { color: '#67c5ff', fontSize: 9, margin: 10, interval: 0, rotate: 25 }
            },
            yAxis: {
                type: 'value',
                name: '风速(m/s)',
                nameTextStyle: { color: 'rgba(255, 255, 255, 0.55)', fontSize: 10 },
                nameGap: 8,
                axisLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.18)' } },
                axisLabel: { color: 'rgba(255, 255, 255, 0.55)', fontSize: 10, margin: 12 },
                splitLine: { lineStyle: { color: 'rgba(0, 212, 255, 0.08)' } }
            },
            series: [
                {
                    name: '风速',
                    type: 'line',
                    data: this.windHistory.speed,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: { 
                        color: '#22d3ee', 
                        width: 2.5,
                        shadowColor: 'rgba(34, 211, 238, 0.4)',
                        shadowBlur: 6
                    },
                    itemStyle: { 
                        color: '#22d3ee',
                        shadowColor: 'rgba(34, 211, 238, 0.5)',
                        shadowBlur: 4
                    },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(34, 211, 238, 0.2)' },
                            { offset: 1, color: 'rgba(34, 211, 238, 0.02)' }
                        ])
                    },
                    markLine: {
                        silent: true,
                        symbol: ['none', 'none'],
                        label: { show: false },
                        data: [
                            { yAxis: this.thresholds.wind.warning, lineStyle: { color: '#fbbf24', type: 'dashed', width: 1 } },
                            { yAxis: this.thresholds.wind.alert, lineStyle: { color: '#ef4444', type: 'dashed', width: 1 } }
                        ]
                    }
                },
                {
                    name: '风向',
                    type: 'line',
                    data: dataWithArrows,
                    smooth: true,
                    lineStyle: { width: 0 },
                    emphasis: { disabled: true }
                }
            ]
        };
        
        this.windChart.setOption(option);
    },

    updateWindCard() {
        const speed = parseFloat(this.windHistory.speed[this.windHistory.speed.length - 1]);
        const direction = this.windHistory.direction[this.windHistory.direction.length - 1];
        const windEl = document.getElementById('val-wind');
        const levelEl = document.getElementById('wind-level');
        const valueContainer = windEl?.parentElement;
        const dirTextEl = document.getElementById('val-wind-dir-text');
        const dirDegEl = document.getElementById('val-wind-dir-deg');
        const compassNeedle = document.getElementById('compass-needle');
        
        if (windEl) windEl.textContent = speed.toFixed(1);
        
        // 更新风向显示
        if (dirTextEl) dirTextEl.textContent = this.degToDirection(direction);
        if (dirDegEl) dirDegEl.textContent = direction;
        if (compassNeedle) {
            compassNeedle.style.transform = `rotate(${direction}deg)`;
        }
        
        // 计算风力等级（蒲福风级）
        let level = 0;
        if (speed < 0.3) level = 0;
        else if (speed < 1.6) level = 1;
        else if (speed < 3.4) level = 2;
        else if (speed < 5.5) level = 3;
        else if (speed < 8.0) level = 4;
        else if (speed < 10.8) level = 5;
        else if (speed < 13.9) level = 6;
        else if (speed < 17.2) level = 7;
        else if (speed < 20.8) level = 8;
        else if (speed < 24.5) level = 9;
        else if (speed < 28.5) level = 10;
        else if (speed < 32.7) level = 11;
        else level = 12;
        
        if (levelEl) {
            levelEl.textContent = level + '级';
            // 根据风力等级设置样式
            if (level >= 10) {
                levelEl.className = 'wind-level-value alert';
            } else if (level >= 8) {
                levelEl.className = 'wind-level-value warning';
            } else {
                levelEl.className = 'wind-level-value';
            }
        }
        
        // 更新风速值颜色
        if (valueContainer) {
            if (speed >= this.thresholds.wind.alert) {
                valueContainer.className = 'wind-value alert';
            } else if (speed >= this.thresholds.wind.warning) {
                valueContainer.className = 'wind-value warning';
            } else {
                valueContainer.className = 'wind-value';
            }
        }
    },

    updateWindData() {
        // 使用基于海口环海公路真实海陆风模型的模拟数据
        const lastDir = this.windHistory.direction.length > 0
            ? this.windHistory.direction[this.windHistory.direction.length - 1]
            : null;
        const wind = this.generateRealisticWind(lastDir);

        // 更新当前值（用于控制面板同步）
        this.currentWind = wind.speed;

        this.windHistory.speed.push(wind.speed.toFixed(1));
        this.windHistory.direction.push(wind.direction);

        const timeStr = this.formatHMS(new Date());
        this.windHistory.timestamps.push(timeStr);

        if (this.windHistory.speed.length > 6) {
            this.windHistory.speed.shift();
            this.windHistory.direction.shift();
            this.windHistory.timestamps.shift();
        }

        this.renderWindChart();
        this.updateWindCard();
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    OceanIoTScene.init();
    initSensorDrawer();
});

// ========== 传感器控制抽屉功能 ==========
const SensorDrawer = {
    overlay: null,
    drawer: null,
    currentSensor: null,
    currentSubSensor: null,
    updateTimer: null,
    
    // 频率值映射 (slider index -> Hz value)
    frequencyValues: [0.5, 1, 2, 5, 10],
    
    sensors: {
        sensor: {
            name: '海洋温湿度传感器',
            type: '环境监测',
            deviceId: 'SENSOR-OC-001',
            online: true,
            isDualValue: true,
            unit: '°C',
            currentValue: 26.5,
            humidityValue: 65.0,
            signal: -65,
            sampleFrequency: 1,
            uploadInterval: 5,
            heartbeatPeriod: 30,
            offlineThreshold: 3
        },
        lightsound: {
            name: '光照与响度传感器组',
            type: '环境感知',
            hasSwitcher: true,
            subSensors: {
                light: {
                    name: '光照传感器',
                    deviceId: 'SENSOR-LT-001',
                    unit: 'Lux',
                    currentValue: 7200,
                    signal: -62
                },
                loudness: {
                    name: '响度传感器',
                    deviceId: 'SENSOR-SD-001',
                    unit: 'dB',
                    currentValue: 56,
                    signal: -60
                }
            },
            online: true,
            sampleFrequency: 1,
            uploadInterval: 4,
            heartbeatPeriod: 20,
            offlineThreshold: 3
        },
        wind: {
            name: '极地风力传感器',
            type: '气象监测',
            deviceId: 'SENSOR-WD-001',
            online: true,
            unit: 'm/s',
            currentValue: 6.8,
            signal: -58,
            sampleFrequency: 2,
            uploadInterval: 3,
            heartbeatPeriod: 15,
            offlineThreshold: 3
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
            this.validateHeartbeat();
        });
        
        // 心跳周期输入验证与联动校验
        const heartbeatInput = document.getElementById('param-heartbeat');
        heartbeatInput?.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
            this.validateHeartbeat();
        });
        heartbeatInput?.addEventListener('blur', (e) => {
            if (!e.target.value || e.target.value === '') {
                e.target.value = 30;
            }
            this.validateHeartbeat();
        });
        
        intervalInput?.addEventListener('input', () => this.validateHeartbeat());
        
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
        
        // 输入校验
        document.querySelectorAll('.param-input').forEach(input => {
            input.addEventListener('input', (e) => this.validateInput(e.target));
            input.addEventListener('blur', (e) => this.validateInput(e.target));
        });
    },
    
    switchSubSensor(subSensor) {
        this.currentSubSensor = subSensor;

        if (this.currentSensor !== 'lightsound') return;
        const sensor = this.sensors.lightsound;
        const sub = sensor.subSensors[subSensor];
        if (!sub) return;

        document.getElementById('drawer-sensor-name').textContent = sub.name;
        document.getElementById('drawer-device-id').textContent = '设备ID: ' + sub.deviceId;
        document.getElementById('drawer-current-value').textContent = sub.currentValue;
        document.getElementById('drawer-current-unit').textContent = sub.unit;
        document.getElementById('drawer-signal').textContent = sub.signal + ' dBm';
        document.getElementById('drawer-update-time').textContent = this.formatTime();
    },
    
    updateFromChartData() {
        if (!this.currentSensor) return;
        
        const time = this.formatTime();
        
        if (this.currentSensor === 'sensor') {
            // 从OceanIoTScene获取最新数据
            const tempValue = (OceanIoTScene.currentTemp || 26.5).toFixed(1);
            const humidityValue = (OceanIoTScene.currentHumidity || 65.0).toFixed(1);
            
            document.getElementById('drawer-temp-value').textContent = tempValue;
            document.getElementById('drawer-humidity-value').textContent = humidityValue;
            document.getElementById('drawer-update-time-dual').textContent = time;
            
            this.sensors.sensor.currentValue = parseFloat(tempValue);
            this.sensors.sensor.humidityValue = parseFloat(humidityValue);
            
        } else if (this.currentSensor === 'wind') {
            const windValue = (OceanIoTScene.currentWind || 6.8).toFixed(1);
            document.getElementById('drawer-current-value').textContent = windValue;
            document.getElementById('drawer-update-time').textContent = time;
            this.sensors.wind.currentValue = parseFloat(windValue);
        } else if (this.currentSensor === 'lightsound') {
            this.sensors.lightsound.subSensors.light.currentValue = OceanIoTScene.currentLight || 7200;
            this.sensors.lightsound.subSensors.loudness.currentValue = OceanIoTScene.currentLoudness || 56;

            const activeSub = this.currentSubSensor || 'light';
            const activeData = this.sensors.lightsound.subSensors[activeSub];
            if (activeData) {
                document.getElementById('drawer-current-value').textContent = activeData.currentValue;
                document.getElementById('drawer-current-unit').textContent = activeData.unit;
                document.getElementById('drawer-update-time').textContent = time;
            }
        }
    },
    
    startAutoUpdate() {
        if (this.updateTimer) return;
        
        this.updateTimer = setInterval(() => {
            this.updateFromChartData();
        }, 5000);
    },
    
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
        
        if (isNaN(heartbeat) || heartbeat < 1 || heartbeat > 600) {
            heartbeatInput.classList.add('invalid');
            if (warningRow) {
                warningRow.style.display = 'flex';
                warningText.textContent = '心跳周期必须为1-600之间的正整数';
            }
            return false;
        }
        
        if (!isNaN(uploadInterval) && heartbeat > uploadInterval * 2) {
            heartbeatInput.classList.remove('invalid');
            if (warningRow) {
                warningRow.style.display = 'flex';
                warningText.textContent = `心跳周期(${heartbeat}s)建议不超过上报周期(${uploadInterval}s)的2倍`;
            }
            return true;
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
        
        if (sensor.isDualValue) {
            // 双值显示模式
            singleValueDisplay.style.display = 'none';
            dualValueDisplay.style.display = 'block';
            sensorSwitcher.style.display = 'none';
            
            const tempValue = (OceanIoTScene.currentTemp || sensor.currentValue).toFixed(1);
            const humidityValue = (OceanIoTScene.currentHumidity || sensor.humidityValue).toFixed(1);
            
            document.getElementById('drawer-temp-value').textContent = tempValue;
            document.getElementById('drawer-humidity-value').textContent = humidityValue;
            document.getElementById('drawer-update-time-dual').textContent = time;
            document.getElementById('drawer-signal-dual').textContent = sensor.signal + ' dBm';
            
            document.getElementById('drawer-sensor-name').textContent = sensor.name;
            document.getElementById('drawer-sensor-type').textContent = sensor.type;
            document.getElementById('drawer-device-id').textContent = '设备ID: ' + sensor.deviceId;
            
        } else if (sensor.hasSwitcher) {
            singleValueDisplay.style.display = 'flex';
            dualValueDisplay.style.display = 'none';
            sensorSwitcher.style.display = 'flex';

            sensor.subSensors.light.currentValue = OceanIoTScene.currentLight || sensor.subSensors.light.currentValue;
            sensor.subSensors.loudness.currentValue = OceanIoTScene.currentLoudness || sensor.subSensors.loudness.currentValue;

            this.currentSubSensor = 'light';
            sensorSwitcher.querySelectorAll('.sensor-switch-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.sensor === 'light');
            });

            const sub = sensor.subSensors.light;
            document.getElementById('drawer-sensor-name').textContent = sub.name;
            document.getElementById('drawer-sensor-type').textContent = sensor.type;
            document.getElementById('drawer-device-id').textContent = '设备ID: ' + sub.deviceId;
            document.getElementById('drawer-current-value').textContent = sub.currentValue;
            document.getElementById('drawer-current-unit').textContent = sub.unit;
            document.getElementById('drawer-update-time').textContent = time;
            document.getElementById('drawer-signal').textContent = sub.signal + ' dBm';

        } else {
            // 单值显示模式
            singleValueDisplay.style.display = 'flex';
            dualValueDisplay.style.display = 'none';
            sensorSwitcher.style.display = 'none';
            
            let currentValue = sensor.currentValue;
            if (sensorType === 'wind' && OceanIoTScene.currentWind) {
                currentValue = OceanIoTScene.currentWind;
            }
            
            document.getElementById('drawer-sensor-name').textContent = sensor.name;
            document.getElementById('drawer-sensor-type').textContent = sensor.type;
            document.getElementById('drawer-device-id').textContent = '设备ID: ' + sensor.deviceId;
            document.getElementById('drawer-current-value').textContent = currentValue.toFixed ? currentValue.toFixed(1) : currentValue;
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
        
        this.loadSensorParams(sensor);
        
        this.overlay.classList.add('active');
        this.drawer.classList.add('active');
        
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
        
        const warningRow = document.getElementById('heartbeat-warning-row');
        if (warningRow) warningRow.style.display = 'none';
        
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
        
        const heartbeatInput = document.getElementById('param-heartbeat');
        const offlineSelect = document.getElementById('param-offline-threshold');
        if (heartbeatInput) heartbeatInput.value = 30;
        if (offlineSelect) offlineSelect.value = 3;
        
        const warningRow = document.getElementById('heartbeat-warning-row');
        if (warningRow) warningRow.style.display = 'none';
        
        document.querySelectorAll('.param-input').forEach(input => input.classList.remove('invalid'));
        
        this.showResult(true, '已恢复默认参数');
    },
    
    validateAll() {
        let valid = true;
        const params = this.getParams();
        
        if (!this.paramSpecs.sampleFrequency.allowedValues.includes(params.sampleFrequency)) {
            valid = false;
        }
        
        if (isNaN(params.uploadInterval) || params.uploadInterval < 1 || params.uploadInterval > 300) {
            document.getElementById('param-interval')?.classList.add('invalid');
            valid = false;
        }
        
        if (isNaN(params.heartbeatPeriod) || params.heartbeatPeriod < 1 || params.heartbeatPeriod > 600) {
            document.getElementById('param-heartbeat')?.classList.add('invalid');
            valid = false;
        }
        
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
    // document.querySelectorAll('.sensor-ctrl-btn').forEach(btn => {
    //     btn.addEventListener('click', (e) => {
    //         const upperSection = e.target.closest('.upper-sensor-section');
    //         if (upperSection) {
    //             SensorDrawer.open('lightsound');
    //             return;
    //         }
    //
    //         const panel = e.target.closest('.ocean-panel');
    //         if (!panel) return;
    //
    //         let sensorType = 'sensor';
    //         if (panel.classList.contains('wind-monitor')) {
    //             sensorType = 'wind';
    //         }
    //
    //         SensorDrawer.open(sensorType);
    //     });
    // });
}
