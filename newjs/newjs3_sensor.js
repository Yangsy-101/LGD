/**
 * 应急救援场景 — 工厂传感器数据接收器（端口 10011）
 *
 * 由 yingjijiuyuan2.html 引入。
 * 点击「开始接收数据」后，定时从核心网关拉取传感器 JSON 数据，
 * 解析为温湿度 / 烟感数值，推送到 YingJiJiuYuanScene 的折线图中展示。
 *
 * 完整链路：
 *   WiFi传感器 → server.py:11408 → 核心网关转发 → HTTP :10011/latest.json
 *     → 前端轮询 → YingJiJiuYuanScene.pushEnvDataPoint() → ECharts 图表
 */

var YJY_SENSOR_CONFIG = {
    host: '192.168.0.233',
    port: 10011,
    endpoint: '/latest.json',
    pollIntervalMs: 3000
};

/**
 * 应急救援传感器接收器
 * @param {object} config - { host, port, endpoint, pollIntervalMs }
 */
function YJYSensorReceiver(config) {
    this.url = 'http://' + config.host + ':' + config.port + config.endpoint;
    this.pollIntervalMs = config.pollIntervalMs || 3000;
    this.running = false;
    this._timer = null;
    this._lastDataKey = '';
    // 绑定方法，确保 this 始终指向实例
    this._poll = this._poll.bind(this);
}

YJYSensorReceiver.prototype.start = function () {
    if (this.running) {
        console.log('[YJY-Sensor] 已在运行中，跳过');
        return;
    }
    this.running = true;
    this._lastDataKey = '';
    console.log('[YJY-Sensor] 开始轮询传感器数据: ' + this.url);

    // 确保 YingJiJiuYuanScene 当前为 sensor 模式
    var scene = (typeof YingJiJiuYuanScene !== 'undefined') ? YingJiJiuYuanScene : null;
    if (scene) {
        if (scene.envPanelMode !== 'sensor') {
            scene.envPanelMode = 'sensor';
            if (typeof scene.syncEnvPanelMode === 'function') {
                scene.syncEnvPanelMode();
            }
        }
    }

    // 立即拉一次，然后定时拉
    this._poll();
    this._timer = setInterval(this._poll, this.pollIntervalMs);
};

YJYSensorReceiver.prototype.stop = function () {
    this.running = false;
    if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
    }
    this._lastDataKey = '';
    console.log('[YJY-Sensor] 停止轮询');
};

YJYSensorReceiver.prototype._poll = function () {
    // running 检查（防止 stop 后残留请求继续处理）
    if (!this.running) return;

    var self = this;

    fetch(this.url + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        })
        .then(function (data) {
            if (!self.running) return;

            var scene = (typeof YingJiJiuYuanScene !== 'undefined') ? YingJiJiuYuanScene : null;
            if (!scene || typeof scene.normalizeEnvData !== 'function') {
                console.warn('[YJY-Sensor] YingJiJiuYuanScene 不可用');
                return;
            }

            // 使用场景已有的解析方法
            var meta = scene.normalizeEnvData(data);
            if (!meta) {
                console.warn('[YJY-Sensor] 数据解析失败:', data);
                return;
            }

            // 去重：相同温湿度+烟感数据不重复推送
            var dataKey = [
                meta.temperature == null ? '' : Number(meta.temperature).toFixed(1),
                meta.humidity == null ? '' : Number(meta.humidity).toFixed(1),
                meta.smokePpm == null ? '' : Number(meta.smokePpm).toFixed(2)
            ].join('|');
            if (dataKey === self._lastDataKey) {
                console.log('[YJY-Sensor] 数据未变化，跳过');
                return;
            }
            self._lastDataKey = dataKey;

            // 推送数据到温湿度折线图 + 烟感折线图 + 概要卡片
            if (typeof scene.pushEnvDataPoint === 'function') {
                scene.pushEnvDataPoint(meta, true);
                console.log('[YJY-Sensor] 数据已推送 | temp=' +
                    (meta.temperature != null ? meta.temperature.toFixed(1) : '--') +
                    ' hum=' + (meta.humidity != null ? meta.humidity.toFixed(1) : '--') +
                    ' smoke=' + (meta.smokePpm != null ? meta.smokePpm.toFixed(2) : '--'));
            }
        })
        .catch(function (err) {
            console.warn('[YJY-Sensor] 拉取传感器数据失败:', err.message);
        });
    // 注意：不再用 .finally 链式调度，改用 setInterval
};
