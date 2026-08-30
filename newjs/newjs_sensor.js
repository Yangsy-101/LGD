/**
 * 传感器数据轮询接收器 — 端口 10008
 *
 * 由 forest-fire2.html 的"显示检测结果"下拉框（显示传感器数据）触发。
 * 定时 fetch 网关传感器数据，更新温湿度/烟感/光照/风速图表。
 * 兼容两种格式：
 *   A. 直接 JSON: {"light":8500, "temperature":26.5, "humidity":65, "smoke":12, "wind":4.5}
 *   B. 旧日志行格式: 包含 data_content.light / data_content.temperature 等
 */

const SENSOR_CONFIG = {
    host: '192.168.0.233',
    port: 10008,
    endpoint: '/sensor',          // 网关传感器数据端点
    pollIntervalMs: 2000,          // 轮询间隔 2s
};

class SensorReceiver {
    constructor(config) {
        this.url = `http://${config.host}:${config.port}${config.endpoint}`;
        this.running = false;
        this.timer = null;
        this.abortController = null;
        this.lastData = null;       // 缓存最近一次数据，去重用
    }

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[Sensor] 开始轮询传感器数据: ' + this.url);
        this._poll();
    }

    stop() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.abortController) { this.abortController.abort(); this.abortController = null; }
        this.lastData = null;
        console.log('[Sensor] 停止轮询');
    }

    async _poll() {
        if (!this.running) return;

        this.abortController = new AbortController();

        try {
            const resp = await fetch(this.url + '?t=' + Date.now(), {
                cache: 'no-store',
                signal: this.abortController.signal,
            });

            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();

            const parsed = SensorReceiver._parseSensorData(data);
            if (!parsed) return;

            // 去重
            const key = JSON.stringify(parsed);
            if (key === this.lastData) return;
            this.lastData = key;

            this._applySensorData(parsed);
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.warn('[Sensor] 拉取失败:', e.message);
        } finally {
            this.abortController = null;
            if (this.running) {
                this.timer = setTimeout(() => this._poll(), SENSOR_CONFIG.pollIntervalMs);
            }
        }
    }

    /**
     * 解析网关返回的传感器数据，支持两种格式
     */
    static _parseSensorData(data) {
        if (!data) return null;

        // 格式 A: 直接 JSON 对象，包含传感器字段
        if (typeof data === 'object' && !Array.isArray(data)) {
            const result = {};
            const keys = ['light', 'temperature', 'temp', 'humidity', 'humi',
                          'smoke', 'pm25', 'wind', 'windspeed'];
            for (const k of keys) {
                if (data[k] !== undefined && Number.isFinite(Number(data[k]))) {
                    result[k] = Number(data[k]);
                }
            }
            // 标准化 key 名
            if (result.temp !== undefined && result.temperature === undefined)
                result.temperature = result.temp;
            if (result.humi !== undefined && result.humidity === undefined)
                result.humidity = result.humi;
            if (result.pm25 !== undefined && result.smoke === undefined)
                result.smoke = result.pm25;
            if (result.windspeed !== undefined && result.wind === undefined)
                result.wind = result.windspeed;

            if (Object.keys(result).length > 0) return result;
        }

        // 格式 B: 旧日志行格式 — data.entries[i].lines[j] 中找 data_content
        const entries = Array.isArray(data.entries) ? data.entries : [];
        for (let i = 0; i < entries.length; i++) {
            const lines = Array.isArray(entries[i].lines) ? entries[i].lines : [];
            for (let j = lines.length - 1; j >= 0; j--) {
                const parsed = SensorReceiver._parseLogLine(lines[j]);
                if (parsed) return parsed;
            }
        }

        // 格式 C: data 本身是数组，直接遍历
        if (Array.isArray(data)) {
            for (let i = data.length - 1; i >= 0; i--) {
                const parsed = SensorReceiver._parseLogLine(data[i]);
                if (parsed) return parsed;
            }
        }

        return null;
    }

    /** 从单行日志中提取传感器值 */
    static _parseLogLine(line) {
        if (typeof line !== 'string' || !line.trim()) return null;

        const jsonStart = line.indexOf('{');
        if (jsonStart < 0) return null;

        try {
            const payload = JSON.parse(line.slice(jsonStart));
            const dc = payload && payload.data_content;
            if (!dc) return null;

            const result = {};
            // 光照
            if (dc.light !== undefined && Number.isFinite(Number(dc.light)))
                result.light = Math.max(0, Math.round(Number(dc.light)));
            // 温度
            if (dc.temperature !== undefined && Number.isFinite(Number(dc.temperature)))
                result.temperature = Number(dc.temperature);
            // 湿度
            if (dc.humidity !== undefined && Number.isFinite(Number(dc.humidity)))
                result.humidity = Number(dc.humidity);
            // 烟感
            if (dc.smoke !== undefined && Number.isFinite(Number(dc.smoke)))
                result.smoke = Math.max(0, Math.round(Number(dc.smoke)));
            // 风速
            if (dc.wind !== undefined && Number.isFinite(Number(dc.wind)))
                result.wind = Number(dc.wind);

            if (Object.keys(result).length > 0) return result;
        } catch (_) {}

        return null;
    }

    /**
     * 将解析出的传感器数据写入 ForestFireScene
     */
    _applySensorData(parsed) {
        const scene = window.ForestFireScene;
        if (!scene) return;

        const loc = scene.currentLocation;

        // 光照
        if (parsed.light !== undefined) {
            scene.currentLightValue = parsed.light;
            scene.usingRealLightValue = true;
            scene.updateLightChart(LOCATION_DATA[loc]);
            scene.addLogEntry(
                '网关光照数据更新: ' + parsed.light + ' Lux', 'success'
            );
        }

        // 温湿度 — 追加到历史数据并刷新图表
        if (parsed.temperature !== undefined || parsed.humidity !== undefined) {
            const data = LOCATION_DATA[loc];
            if (parsed.temperature !== undefined) {
                data.temperatureData.push(parsed.temperature);
                if (data.temperatureData.length > 12) data.temperatureData.shift();
            }
            if (parsed.humidity !== undefined) {
                data.humidityData.push(parsed.humidity);
                if (data.humidityData.length > 12) data.humidityData.shift();
            }
            scene.updateTemperatureChart(data);
        }

        // 烟感
        if (parsed.smoke !== undefined) {
            const data = LOCATION_DATA[loc];
            data.smokeData.push(parsed.smoke);
            if (data.smokeData.length > 12) data.smokeData.shift();
            scene.updateSmokeChart(data);
        }

        // 风速
        if (parsed.wind !== undefined) {
            scene.currentWindValue = parsed.wind;
            scene.updateWindChart(LOCATION_DATA[loc]);
        }
    }
}
