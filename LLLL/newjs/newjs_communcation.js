/**
 * 通信质量实时监测 — 接收器 & 面板 (v3)
 *
 * 三张指标卡:
 *   1. 5G链路质量 — FPS 折线图 + 信道利用率 + 质量等级（优/良/中/差）
 *   2. 心跳包监测 — 边缘网关设备在线状态 + 最近心跳时间
 *   3. 短波丢包率 — 环形进度 + 收发/丢失包统计
 *
 * 数据源: 192.168.0.233:10013
 * 离线时自动切换模拟数据展示 UI 效果。
 */

var COMM_CONFIG = {
    host: '192.168.0.233',
    port: 10013,
    endpoint: '/comm',
    pollIntervalMs: 5000
};

var CommunicationMonitor = (function() {
    'use strict';

    /* ---- SVG 图标 ---- */
    var ICONS = {
        main: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
        g5: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M8 12h1m3 0h1m3 0h1"/><path d="M7 8v8M12 7v10M17 8v8"/></svg>',
        heartbeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"/></svg>',
        shortwave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="5" rx="1"/><rect x="4" y="10" width="16" height="5" rx="1"/><rect x="4" y="17" width="10" height="5" rx="1" opacity="0.4"/></svg>'
    };

    /* ---- 构造 ---- */
    function CommMonitor(config) {
        this.config = config || {};
        this.url = 'http://' + (this.config.host || '192.168.0.233') + ':' + (this.config.port || 10013) + (this.config.endpoint || '/comm');
        this.running = false;
        this.timer = null;
        this.abortController = null;
        this.overlayEl = null;
        this.panelEl = null;
        this._domReady = false;

        // FPS 历史数据（最多 20 个点）
        this.fpsHistory = [];
        // ECharts 实例
        this.chart5g = null;
    }

    /* ================ DOM 构建 ================ */
    CommMonitor.prototype._ensureDOM = function() {
        if (this._domReady) {
            if (!this.overlayEl) this.overlayEl = document.getElementById('comm-monitor-overlay');
            if (!this.panelEl)   this.panelEl   = document.getElementById('comm-monitor-panel');
            return;
        }

        var existingPanel = document.getElementById('comm-monitor-panel');
        if (existingPanel) {
            this.overlayEl = document.getElementById('comm-monitor-overlay');
            this.panelEl   = existingPanel;
            this._domReady = true;
            this._bindEvents();
            return;
        }

        var overlay = document.createElement('div');
        overlay.id = 'comm-monitor-overlay';
        overlay.className = 'comm-monitor-overlay';

        var panel = document.createElement('div');
        panel.id = 'comm-monitor-panel';
        panel.className = 'comm-monitor-panel';

        var hostPort = (this.config.host || '192.168.0.233') + ':' + (this.config.port || 10013);

        panel.innerHTML =
            // -- 头部 --
            '<div class="comm-monitor-header">' +
                '<div class="comm-monitor-title-group">' +
                    '<div class="comm-monitor-icon">' + ICONS.main + '</div>' +
                    '<span class="comm-monitor-title">链路质量监测</span>' +
                '</div>' +
                '<button class="comm-monitor-close" id="comm-monitor-close">✕</button>' +
            '</div>' +

            // -- 内容区 --
            '<div class="comm-monitor-body">' +

                // ===== 1. 5G链路质量 =====
                '<div class="comm-metric-card card-5g">' +
                    '<div class="card-head">' +
                        '<div class="card-title-wrap">' +
                            '<div class="card-icon">' + ICONS.g5 + '</div>' +
                            '<span class="card-title-text">5G链路质量</span>' +
                        '</div>' +
                        '<div class="card-status" id="st-5g">等待中</div>' +
                    '</div>' +
                    // FPS 折线图容器
                    '<div class="chart-5g-wrap" id="chart-5g-wrap">' +
                        '<div class="chart-5g-inner" id="chart-5g"></div>' +
                    '</div>' +
                    // 数值行
                    '<div class="metric-stats-row">' +
                        '<div class="metric-stat">' +
                            '<span class="stat-label">当前 FPS</span>' +
                            '<span class="stat-value" id="val-fps">--</span>' +
                        '</div>' +
                        '<div class="metric-stat">' +
                            '<span class="stat-label">信道利用率</span>' +
                            '<span class="stat-value" id="val-util">--%</span>' +
                        '</div>' +
                        '<div class="metric-stat">' +
                            '<span class="stat-label">质量等级</span>' +
                            '<span class="stat-badge" id="badge-5g">--</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="card-foot"><div class="card-foot-fill" id="bar-5g" style="width:0%"></div></div>' +
                '</div>' +

                // ===== 2. 心跳包监测 =====
                '<div class="comm-metric-card card-heartbeat">' +
                    '<div class="card-head">' +
                        '<div class="card-title-wrap">' +
                            '<div class="card-icon">' + ICONS.heartbeat + '</div>' +
                            '<span class="card-title-text">心跳包监测</span>' +
                        '</div>' +
                        '<div class="card-status" id="st-hb">等待中</div>' +
                    '</div>' +
                    // 设备列表（可滚动）
                    '<div class="device-list" id="device-list">' +
                        '<div class="device-item">' +
                            '<span class="device-dot offline"></span>' +
                            '<div class="device-info">' +
                                '<span class="device-name">边缘网关 #1</span>' +
                                '<span class="device-beat" id="beat-1">等待数据...</span>' +
                            '</div>' +
                            '<span class="device-status-text" id="dev-st-1">离线</span>' +
                        '</div>' +
                        '<div class="device-item">' +
                            '<span class="device-dot offline"></span>' +
                            '<div class="device-info">' +
                                '<span class="device-name">边缘网关 #2</span>' +
                                '<span class="device-beat" id="beat-2">等待数据...</span>' +
                            '</div>' +
                            '<span class="device-status-text" id="dev-st-2">离线</span>' +
                        '</div>' +
                        '<div class="device-item">' +
                            '<span class="device-dot offline"></span>' +
                            '<div class="device-info">' +
                                '<span class="device-name">边缘网关 #3</span>' +
                                '<span class="device-beat" id="beat-3">等待数据...</span>' +
                            '</div>' +
                            '<span class="device-status-text" id="dev-st-3">离线</span>' +
                        '</div>' +
                    '</div>' +
                    // 汇总行
                    '<div class="metric-stats-row">' +
                        '<div class="metric-stat">' +
                            '<span class="stat-label">心跳间隔</span>' +
                            '<span class="stat-value" id="val-hb-int">30s</span>' +
                        '</div>' +
                        '<div class="metric-stat">' +
                            '<span class="stat-label">在线设备</span>' +
                            '<span class="stat-value" id="val-hb-online">0/3</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                // ===== 3. 短波丢包率 =====
                '<div class="comm-metric-card card-shortwave">' +
                    '<div class="card-head">' +
                        '<div class="card-title-wrap">' +
                            '<div class="card-icon">' + ICONS.shortwave + '</div>' +
                            '<span class="card-title-text">短波丢包率</span>' +
                        '</div>' +
                        '<div class="card-status" id="st-sw">等待中</div>' +
                    '</div>' +
                    // 环形图 + 数值
                    '<div class="loss-ring-row">' +
                        '<div class="loss-ring-wrap">' +
                            '<svg class="loss-ring-svg" viewBox="0 0 100 100">' +
                                '<circle class="loss-ring-bg" cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/>' +
                                '<circle class="loss-ring-fg" id="loss-ring-fg" cx="50" cy="50" r="42" fill="none" stroke="#10b981" stroke-width="8" stroke-linecap="round" stroke-dasharray="0 264" transform="rotate(-90 50 50)"/>' +
                            '</svg>' +
                            '<div class="loss-ring-value" id="val-sw">--<span>%</span></div>' +
                        '</div>' +
                        '<div class="loss-stats">' +
                            '<div class="loss-stat-item">' +
                                '<span class="loss-stat-label">发送</span>' +
                                '<span class="loss-stat-val" id="sw-sent">--</span>' +
                            '</div>' +
                            '<div class="loss-stat-item">' +
                                '<span class="loss-stat-label">接收</span>' +
                                '<span class="loss-stat-val" id="sw-recv">--</span>' +
                            '</div>' +
                            '<div class="loss-stat-item">' +
                                '<span class="loss-stat-label">丢失</span>' +
                                '<span class="loss-stat-val loss-red" id="sw-lost">--</span>' +
                            '</div>' +
                            '<div class="loss-stat-item">' +
                                '<span class="loss-stat-label">丢包率</span>' +
                                '<span class="loss-stat-val" id="sw-rate">--%</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

            '</div>' +

            // -- 底部 --
            '<div class="comm-monitor-footer">' +
                '<span class="footer-source" id="footer-source-text">' + hostPort + '</span>' +
                '<span id="comm-footer-time">--:--:--</span>' +
            '</div>';

        document.body.appendChild(overlay);
        document.body.appendChild(panel);

        this.overlayEl = overlay;
        this.panelEl   = panel;
        this._domReady = true;
        this._bindEvents();
    };

    /* ================ 事件绑定 ================ */
    CommMonitor.prototype._bindEvents = function() {
        var self = this;
        var closeBtn = document.getElementById('comm-monitor-close');
        if (closeBtn) {
            if (closeBtn._commHandler) {
                closeBtn.removeEventListener('click', closeBtn._commHandler);
            }
            var handler = function() { self.stop(); };
            closeBtn._commHandler = handler;
            closeBtn.addEventListener('click', handler);
        }
    };

    /* ================ 显示 / 隐藏 ================ */
    CommMonitor.prototype._showPanel = function() {
        this._ensureDOM();
        var self = this;
        setTimeout(function() {
            if (self.panelEl) self.panelEl.classList.add('active');
            // 初始化 ECharts（首次显示时）
            self._initChart5G();
        }, 80);
    };

    CommMonitor.prototype._hidePanel = function() {
        if (this.panelEl) this.panelEl.classList.remove('active');
    };

    /* ================ 启动 / 停止 ================ */
    CommMonitor.prototype.start = function() {
        if (this.running) return;
        this.running = true;
        this._showPanel();
        this._poll();
    };

    CommMonitor.prototype.stop = function() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.abortController) { this.abortController.abort(); this.abortController = null; }
        this._hidePanel();
        var select = document.getElementById('select-detect-mode');
        if (select) { select.value = ''; }
        window._commMonitor = null;
    };

    /* ================ ECharts 折线图 ================ */
    CommMonitor.prototype._initChart5G = function() {
        var dom = document.getElementById('chart-5g');
        if (!dom) return;

        // 释放 DOM 上可能残留的旧 ECharts 实例（跨实例复用 DOM 时）
        if (typeof echarts !== 'undefined') {
            var old = echarts.getInstanceByDom(dom);
            if (old) { old.dispose(); }
        }

        if (this.chart5g) {
            this.chart5g.dispose();
            this.chart5g = null;
        }

        if (typeof echarts === 'undefined') {
            dom.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding-top:40px;font-size:12px">图表库加载中...</div>';
            return;
        }

        this.chart5g = echarts.init(dom);

        var option = {
            grid: { top: 16, right: 8, bottom: 26, left: 40 },
            xAxis: {
                type: 'category',
                data: [],
                axisLine: { lineStyle: { color: 'rgba(148,163,184,0.18)' } },
                axisTick: { show: false },
                axisLabel: {
                    color: 'rgba(200,215,235,0.45)',
                    fontSize: 9,
                    interval: Math.max(0, Math.floor(this.fpsHistory.length / 5) - 1),
                    rotate: 0
                }
            },
            yAxis: {
                type: 'value',
                name: 'FPS',
                nameTextStyle: { color: 'rgba(200,215,235,0.35)', fontSize: 9, padding: [0, 28, 0, 0] },
                min: 0,
                max: 35,
                splitNumber: 7,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: 'rgba(200,215,235,0.4)', fontSize: 9 },
                splitLine: { lineStyle: { color: 'rgba(148,163,184,0.08)', type: 'dashed' } }
            },
            series: [{
                type: 'line',
                data: [],
                smooth: false,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: { color: '#22d3ee', width: 2.2 },
                itemStyle: { color: '#22d3ee', borderColor: 'rgba(34,211,238,0.25)', borderWidth: 1.5 },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(34,211,238,0.30)' },
                        { offset: 1, color: 'rgba(34,211,238,0.01)' }
                    ])
                },
                // 质量等级阈值线
                markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { type: 'dashed', width: 1, opacity: 0.5 },
                    label: { fontSize: 8, color: 'rgba(200,215,235,0.5)', position: 'insideEndTop' },
                    data: [
                        { yAxis: 28.5, name: '优', lineStyle: { color: '#10b981' }, label: { color: '#10b981' } },
                        { yAxis: 27,   name: '良', lineStyle: { color: '#f59e0b' }, label: { color: '#f59e0b' } },
                        { yAxis: 24,   name: '中', lineStyle: { color: '#f97316' }, label: { color: '#f97316' } }
                    ]
                }
            }]
        };

        this.chart5g.setOption(option);
    };

    CommMonitor.prototype._updateChart5G = function() {
        if (!this.chart5g) {
            this._initChart5G();
            if (!this.chart5g) return;
        }

        var times = [];
        var values = [];
        for (var i = 0; i < this.fpsHistory.length; i++) {
            times.push(this.fpsHistory[i].time);
            values.push(this.fpsHistory[i].fps);
        }

        this.chart5g.setOption({
            xAxis: { data: times },
            series: [{ data: values }]
        });
    };

    /* ================ 数据轮询 ================ */
    CommMonitor.prototype._poll = function() {
        if (!this.running) return;
        var self = this;
        this.abortController = new AbortController();

        fetch(this.url + '?t=' + Date.now(), { cache: 'no-store', signal: this.abortController.signal })
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        })
        .then(function(data) {
            var srcEl = document.getElementById('footer-source-text');
            if (srcEl) { srcEl.textContent = self.config.host + ':' + self.config.port; srcEl.style.color = '#10b981'; }
            self._updateUI(self._parseData(data));
            self._scheduleNext();
        })
        .catch(function(err) {
            if (err && err.name === 'AbortError') return;
            var srcEl = document.getElementById('footer-source-text');
            if (srcEl) { srcEl.textContent = '系统离线 - 模拟数据演示中'; srcEl.style.color = '#f59e0b'; }
            self._updateUI(self._parseData(self._generateMockData()));
            self._scheduleNext();
        });
    };

    CommMonitor.prototype._scheduleNext = function() {
        if (!this.running) return;
        var self = this;
        var interval = this.config.pollIntervalMs || 2000;
        this.timer = setTimeout(function() { self._poll(); }, interval);
    };

    /* ================ 数据解析 ================ */
    CommMonitor.prototype._parseData = function(data) {
        var payload = (data && data.data_content) || data;
        payload = (payload && payload.result) || payload;

        function num(obj, keys) {
            for (var i = 0; i < keys.length; i++) {
                if (obj[keys[i]] !== undefined) return Number(obj[keys[i]]);
            }
            return null;
        }
        function arr(obj, keys) {
            for (var i = 0; i < keys.length; i++) {
                if (Array.isArray(obj[keys[i]])) return obj[keys[i]];
            }
            return null;
        }

        return {
            fps:           num(payload, ['fps', 'current_fps', 'frame_rate']),
            snr:           num(payload, ['g5_snr', 'snr']),
            hbDevices:     arr(payload, ['heartbeat_devices', 'devices', 'hb_devices']),
            hbInterval:    num(payload, ['heartbeat_interval', 'hb_interval']),
            swSent:        num(payload, ['shortwave_sent', 'sw_sent', 'packets_sent']),
            swRecv:        num(payload, ['shortwave_recv', 'sw_recv', 'packets_recv']),
            swLost:        num(payload, ['shortwave_lost', 'sw_lost', 'packets_lost']),
            swLossRate:    num(payload, ['shortwave_loss_rate', 'sw_loss_rate', 'packet_loss_rate'])
        };
    };

    /* ================ UI 更新 ================ */
    CommMonitor.prototype._updateUI = function(p) {
        this._update5G(p);
        this._updateHeartbeat(p);
        this._updateShortwave(p);
        this._updateFooterTime();
    };

    // --- 5G 折线图 + 利用率 + 等级 ---
    CommMonitor.prototype._update5G = function(p) {
        var fps = p.fps;
        var MAX_FPS = 30;

        if (fps === null || !isFinite(fps)) return;

        // 1. 记录到历史
        var now = new Date();
        var pad = function(n) { return String(n).padStart ? String(n).padStart(2, '0') : ('0' + n).slice(-2); };
        var timeStr = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

        this.fpsHistory.push({ time: timeStr, fps: fps });
        if (this.fpsHistory.length > 20) { this.fpsHistory.shift(); }

        // 2. 更新折线图
        this._updateChart5G();

        // 3. 计算信道利用率
        var util = Math.min(100, (fps / MAX_FPS) * 100);

        // 4. 质量等级判定
        var rating, ratingLevel;
        if (util >= 95)      { rating = '优'; ratingLevel = 'good'; }
        else if (util >= 90) { rating = '良'; ratingLevel = 'warning'; }
        else if (util >= 80) { rating = '中'; ratingLevel = 'medium'; }
        else                 { rating = '差'; ratingLevel = 'bad'; }

        // 5. 更新 DOM
        this._setText('val-fps', fps.toFixed(1));
        this._setText('val-util', util.toFixed(1) + '%');

        var badge = document.getElementById('badge-5g');
        if (badge) {
            badge.textContent = rating;
            badge.className = 'stat-badge badge-' + ratingLevel;
        }

        var bar = document.getElementById('bar-5g');
        if (bar) { bar.style.width = util + '%'; }

        var stEl = document.getElementById('st-5g');
        if (stEl) {
            stEl.textContent = 'FPS ' + fps.toFixed(1);
            stEl.className = 'card-status status-' + ratingLevel;
        }
    };

    // --- 心跳包：设备在线状态 ---
    CommMonitor.prototype._updateHeartbeat = function(p) {
        var devices = p.hbDevices;
        var interval = p.hbInterval;

        // 默认模拟设备列表（如果网关没返回）
        if (!devices || devices.length === 0) {
            devices = [
                { id: 1, name: '边缘网关 #1', online: true,  lastBeatSec: Math.floor(Math.random() * 5) },
                { id: 2, name: '边缘网关 #2', online: Math.random() > 0.2, lastBeatSec: Math.floor(Math.random() * 8) }
            ];
        }

        var onlineCount = 0;
        for (var i = 0; i < Math.min(devices.length, 3); i++) {
            var dev = devices[i];
            var idx = i + 1;
            if (dev.online) onlineCount++;

            // 更新设备点
            var dot = document.querySelector('#device-list .device-item:nth-child(' + idx + ') .device-dot');
            if (dot) {
                dot.className = 'device-dot ' + (dev.online ? 'online' : 'offline');
            }
            // 更新心跳时间
            var beatEl = document.getElementById('beat-' + idx);
            if (beatEl) {
                beatEl.textContent = dev.online ? (dev.lastBeatSec + 's 前') : '--';
            }
            // 更新状态文字
            var stEl = document.getElementById('dev-st-' + idx);
            if (stEl) {
                stEl.textContent = dev.online ? '在线' : '离线';
                stEl.className = 'device-status-text ' + (dev.online ? 'dev-online' : 'dev-offline');
            }
        }

        // 在线数
        this._setText('val-hb-online', onlineCount + '/' + Math.min(devices.length, 3));

        // 心跳间隔
        if (interval !== null && isFinite(interval)) {
            this._setText('val-hb-int', interval + 's');
        } else {
            this._setText('val-hb-int', '30s');
        }

        // 头部状态
        var stEl = document.getElementById('st-hb');
        if (stEl) {
            stEl.textContent = onlineCount > 0 ? '监测中' : '全部离线';
            stEl.className = 'card-status ' + (onlineCount > 0 ? 'status-good' : 'status-bad');
        }
    };

    // --- 短波丢包率：环形图 + 包统计 ---
    CommMonitor.prototype._updateShortwave = function(p) {
        var sent   = p.swSent;
        var recv   = p.swRecv;
        var lost   = p.swLost;
        var rate   = p.swLossRate;

        // 如果缺少值，用模拟
        if (sent === null || !isFinite(sent)) sent = 100;
        if (recv === null || !isFinite(recv)) recv = 98;
        if (lost === null || !isFinite(lost)) lost = sent - recv;
        if (rate === null || !isFinite(rate)) rate = sent > 0 ? (lost / sent * 100) : 0;

        // 更新环形图
        var circle = document.getElementById('loss-ring-fg');
        if (circle) {
            var circumference = 2 * Math.PI * 42; // r=42
            var dashLen = Math.max(0, (100 - Math.min(100, rate)) / 100 * circumference);
            circle.setAttribute('stroke-dasharray', dashLen + ' ' + circumference);

            var color;
            if (rate <= 2)       color = '#10b981';
            else if (rate <= 8)  color = '#f59e0b';
            else                 color = '#ef4444';
            circle.setAttribute('stroke', color);
        }

        // 环形中心数值
        var valEl = document.getElementById('val-sw');
        if (valEl) {
            valEl.innerHTML = rate.toFixed(1) + '<span>%</span>';
        }

        // 右侧统计
        this._setText('sw-sent', sent);
        this._setText('sw-recv', recv);
        this._setText('sw-lost', lost);
        this._setText('sw-rate', rate.toFixed(1) + '%');

        // 头部状态
        var stEl = document.getElementById('st-sw');
        if (stEl) {
            var label, lvl;
            if (rate <= 2)      { label = '极佳'; lvl = 'good'; }
            else if (rate <= 8) { label = '轻微'; lvl = 'warning'; }
            else                { label = '严重'; lvl = 'bad'; }
            stEl.textContent = label;
            stEl.className = 'card-status status-' + lvl;
        }
    };

    /* ================ 工具方法 ================ */
    CommMonitor.prototype._setText = function(id, text) {
        var el = document.getElementById(id);
        if (el) {
            el.textContent = text;
            el.classList.remove('value-flash');
            void el.offsetWidth;
            el.classList.add('value-flash');
        }
    };

    CommMonitor.prototype._updateFooterTime = function() {
        var el = document.getElementById('comm-footer-time');
        if (!el) return;
        var now = new Date();
        var pad = function(n) { return String(n).padStart ? String(n).padStart(2, '0') : ('0' + n).slice(-2); };
        el.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    };

    /* ================ 模拟数据 ================ */
    CommMonitor.prototype._generateMockData = function() {
        var t = Date.now() / 3000;
        // 模拟 FPS 8~13 波动（用户实际场景）
        var fps = 8 + Math.abs(Math.sin(t + 0.5)) * 5 + Math.random() * 1.5;
        fps = Math.round(fps * 10) / 10;

        var sent   = 120 + Math.floor(Math.random() * 20);
        var lost   = Math.floor(Math.random() * 6);
        var recv   = sent - lost;

        return {
            fps: fps,
            snr: 24 + Math.random() * 6,
            hbDevices: [
                { id: 1, name: '边缘网关 #1', online: true,  lastBeatSec: Math.floor(Math.random() * 4) + 1 },
                { id: 2, name: '边缘网关 #2', online: Math.random() > 0.15, lastBeatSec: Math.floor(Math.random() * 7) + 1 },
                { id: 3, name: '边缘网关 #3', online: Math.random() > 0.3, lastBeatSec: Math.floor(Math.random() * 10) + 1 }
            ],
            hbInterval: 30,
            swSent: sent,
            swRecv: recv,
            swLost: lost,
            swLossRate: sent > 0 ? parseFloat((lost / sent * 100).toFixed(1)) : 0
        };
    };

    return CommMonitor;
})();
