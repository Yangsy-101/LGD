/**
 * 远海场景传感器数据轮询接收器 — 端口 10009
 *
 * 由 ocean-iot2.html 的"显示检测结果"按钮触发。
 * 定时 fetch 网关传感器数据，更新光照/响度/温湿度/风速图表。
 */

const OCEAN_SENSOR_CONFIG = {
    host: '192.168.0.233',
    port: 10009,
    endpoint: '/sensor',
    pollIntervalMs: 2000,
};

class OceanSensorReceiver {
    constructor(config) {
        this.url = `http://${config.host}:${config.port}${config.endpoint}`;
        this.running = false;
        this.timer = null;
        this.abortController = null;
        this.lastData = null;
    }

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[OceanSensor] 开始轮询: ' + this.url);
        this._poll();
    }

    stop() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.abortController) { this.abortController.abort(); this.abortController = null; }
        this.lastData = null;
        console.log('[OceanSensor] 停止轮询');
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

            const parsed = OceanSensorReceiver._parse(data);
            if (!parsed) return;

            const key = JSON.stringify(parsed);
            if (key === this.lastData) return;
            this.lastData = key;

            this._apply(parsed);
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.warn('[OceanSensor] 拉取失败:', e.message);
        } finally {
            this.abortController = null;
            if (this.running) {
                this.timer = setTimeout(() => this._poll(), OCEAN_SENSOR_CONFIG.pollIntervalMs);
            }
        }
    }

    static _parse(data) {
        if (!data) return null;

        // 格式 A: 直接 JSON { light, temperature, humidity, wind, loudness, ... }
        if (typeof data === 'object' && !Array.isArray(data)) {
            const result = {};
            const map = { light: 'light', temperature: 'temperature', temp: 'temperature',
                          humidity: 'humidity', humi: 'humidity', wind: 'wind',
                          windspeed: 'wind', loudness: 'loudness', sound: 'loudness' };
            for (const [k, v] of Object.entries(map)) {
                if (data[k] !== undefined && Number.isFinite(Number(data[k]))) {
                    result[v] = Number(data[k]);
                }
            }
            if (Object.keys(result).length > 0) return result;
        }

        // 格式 B: 旧日志行 — data.entries[i].lines[j]
        const entries = Array.isArray(data.entries) ? data.entries : [];
        for (const entry of entries) {
            const lines = Array.isArray(entry.lines) ? entry.lines : [];
            for (let j = lines.length - 1; j >= 0; j--) {
                const p = OceanSensorReceiver._parseLine(lines[j]);
                if (p) return p;
            }
        }

        // 格式 C: 数组
        if (Array.isArray(data)) {
            for (let i = data.length - 1; i >= 0; i--) {
                const p = OceanSensorReceiver._parseLine(data[i]);
                if (p) return p;
            }
        }
        return null;
    }

    static _parseLine(line) {
        if (typeof line !== 'string' || !line.trim()) return null;
        const jsonStart = line.indexOf('{');
        if (jsonStart < 0) return null;
        try {
            const payload = JSON.parse(line.slice(jsonStart));
            const dc = payload && payload.data_content;
            if (!dc) return null;
            const result = {};
            const keys = ['light', 'temperature', 'humidity', 'wind', 'loudness', 'smoke'];
            for (const k of keys) {
                if (dc[k] !== undefined && Number.isFinite(Number(dc[k]))) {
                    result[k] = Number(dc[k]);
                }
            }
            if (Object.keys(result).length > 0) return result;
        } catch (_) {}
        return null;
    }

    _apply(parsed) {
        const scene = window.OceanIoTScene;
        if (!scene) return;

        // 光照
        if (parsed.light !== undefined) {
            scene.currentLight = parsed.light;
            scene.updateLightSoundCards();
            scene.renderLightSoundChart();
            scene.addEvent('upload', '网关光照更新: ' + parsed.light + ' Lux');
        }

        // 响度
        if (parsed.loudness !== undefined) {
            scene.currentLoudness = parsed.loudness;
            scene.updateLightSoundCards();
            scene.renderLightSoundChart();
            scene.addEvent('upload', '网关响度更新: ' + parsed.loudness + ' dB');
        }

        // 温湿度
        if (parsed.temperature !== undefined || parsed.humidity !== undefined) {
            if (parsed.temperature !== undefined) {
                scene.currentTemp = parsed.temperature;
                scene.sensorHistory.temperature.push(parsed.temperature);
                if (scene.sensorHistory.temperature.length > 12) scene.sensorHistory.temperature.shift();
            }
            if (parsed.humidity !== undefined) {
                scene.currentHumidity = parsed.humidity;
                scene.sensorHistory.humidity.push(parsed.humidity);
                if (scene.sensorHistory.humidity.length > 12) scene.sensorHistory.humidity.shift();
            }
            scene.sensorHistory.timestamps.push(OceanSensorReceiver._timeHMS());
            if (scene.sensorHistory.timestamps.length > 12) scene.sensorHistory.timestamps.shift();
            scene.renderSensorChart();
        }

        // 风速
        if (parsed.wind !== undefined) {
            scene.currentWind = parsed.wind;
            scene.updateWindCards();
            scene.renderWindChart();
            scene.addEvent('upload', '网关风速更新: ' + parsed.wind + ' m/s');
        }
    }

    static _timeHMS() {
        var d = new Date();
        return [d.getHours(), d.getMinutes(), d.getSeconds()]
            .map(function(v) { return String(v).padStart(2, '0'); }).join(':');
    }
}
