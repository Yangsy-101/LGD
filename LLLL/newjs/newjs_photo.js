/**
 * 火灾检测图片轮询接收器 — 端口 10005
 *
 * 由 forest-fire2.html 的"显示火灾检测图片"下拉选项触发。
 * 定时 fetch 网关最新抓拍图片，从响应头解析图片名判断火情。
 *
 * 规则:
 *   - 图片名含 "FIRE"  → 检测到火情 → 预警等级 >= 中
 *   - 图片名含 "PERIOD" → 无火情正常 → 预警等级恢复
 *   - 同一图片名不重复处理
 */

const PHOTO_CONFIG = {
    host: '192.168.0.233',
    port: 10005,
    endpoint: '/latest.jpg',       // 网关最新抓拍图片端点
    pollIntervalMs: 1000,          // 轮询间隔 1s
};


class PhotoReceiver {
    constructor(config) {
        this.url = `http://${config.host}:${config.port}${config.endpoint}`;
        this.running = false;
        this.timer = null;
        this.abortController = null;
        this.lastImageName = '';    // 已处理的最新图片名，避免重复
        this.lastObjUrl = '';       // 上一张图片的 Object URL（用于 revoke）
    }

    // ==================== 公开 API ====================

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[Photo] 开始轮询检测图片: ' + this.url);
        this._poll();
    }

    stop() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.abortController) { this.abortController.abort(); this.abortController = null; }
        if (this.lastObjUrl) { URL.revokeObjectURL(this.lastObjUrl); this.lastObjUrl = ''; }
        console.log('[Photo] 停止轮询');
    }

    // ==================== 轮询核心 ====================

    async _poll() {
        if (!this.running) return;

        this.abortController = new AbortController();

        try {
            const resp = await fetch(this.url + '?t=' + Date.now(), {
                cache: 'no-store',
                signal: this.abortController.signal,
            });

            if (!resp.ok) throw new Error('HTTP ' + resp.status);

            // ★ 从响应头解析图片名（在消费 body 之前读 headers）
            const imageName = this._parseImageName(resp);

            // 读取图片数据
            const blob = await resp.blob();
            if (!blob.size) return;

            if (imageName) {
                // 同一张图片不重复处理
                if (imageName === this.lastImageName) return;
                this.lastImageName = imageName;

                // 判断火情
                const isFire = this._isFireImage(imageName);
                const ts = this._formatTimestamp();

                // 显示图片
                this._showImage(blob);

                // 写入实时检测结果
                this._updateDetectionLog(imageName, isFire, ts);

                // 更新火灾预警等级
                this._updateAlertLevel(isFire, imageName, ts);
            } else {
                // 无图片名 → 仅显示图片
                this._showImage(blob);
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.warn('[Photo] 拉取失败:', e.message);
        } finally {
            this.abortController = null;
            if (this.running) {
                this.timer = setTimeout(() => this._poll(), PHOTO_CONFIG.pollIntervalMs);
            }
        }
    }

    // ==================== 图片名解析 ====================

    /**
     * 从 HTTP 响应头解析图片文件名。
     * 优先顺序: Content-Disposition → X-Image-Name → URL 路径
     */
    _parseImageName(resp) {
        // 1) Content-Disposition: inline; filename="FIRE_20260623_143021.jpg"
        const cd = resp.headers.get('Content-Disposition');
        if (cd) {
            const m = cd.match(/filename\*?=(?:UTF-8''|["']?)([^;"']+)/i);
            if (m) return decodeURIComponent(m[1].replace(/["']/g, ''));
        }

        // 2) 自定义头 X-Image-Name
        const xn = resp.headers.get('X-Image-Name');
        if (xn) return xn;

        // 3) 从最终 URL 路径提取
        const url = resp.url.replace(/\?.*$/, '');
        const um = url.match(/\/([^\/]+\.jpe?g)$/i);
        if (um) return um[1];

        return null;
    }

    /**
     * 判断图片名是否表示火情。
     * 含 "FIRE"（且不含 "NOFIRE"）→ true；含 "PERIOD" → false
     */
    _isFireImage(filename) {
        const upper = String(filename || '').toUpperCase();
        if (!upper || upper.includes('NOFIRE')) return false;
        if (upper.includes('FIRE')) return true;
        return false;
    }

    // ==================== 图片渲染 ====================

    _showImage(blob) {
        const objUrl = URL.createObjectURL(blob);

        // 释放上一张的 Object URL
        if (this.lastObjUrl) URL.revokeObjectURL(this.lastObjUrl);
        this.lastObjUrl = objUrl;

        // 确保 <img> 存在
        let img = document.getElementById('result-snapshot-img');
        if (!img) {
            img = document.createElement('img');
            img.id = 'result-snapshot-img';
            img.style.width = '100%';
            img.style.height = 'auto';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'cover';
            const container = document.getElementById('capture-view');
            if (container) container.appendChild(img);
        }
        img.src = objUrl;
        img.style.display = 'block';

        // 隐藏占位符
        const ph = document.getElementById('capture-placeholder');
        if (ph) ph.style.display = 'none';
    }

    // ==================== 实时检测结果 ====================

    _updateDetectionLog(imageName, isFire, timestamp) {
        // 获取地点名称
        let locationName = '监测区域';
        if (typeof ForestFireScene !== 'undefined' && ForestFireScene.currentLocation) {
            try {
                const loc = (typeof LOCATION_DATA !== 'undefined')
                    ? LOCATION_DATA[ForestFireScene.currentLocation]
                    : null;
                if (loc && loc.name) locationName = loc.name;
            } catch (_) {}
        }

        const logContainer = document.getElementById('detection-log');
        if (!logContainer) return;

        const div = document.createElement('div');

        if (isFire) {
            div.className = 'log-entry error';
            div.textContent = `[${timestamp}] ${locationName}处检测到火，请立即处理！`;
        } else {
            div.className = 'log-entry success';
            div.textContent = `[${timestamp}] ${locationName}持续监测中，未发现火情异常。`;
        }

        logContainer.appendChild(div);

        // 超过 50 条移除最旧的
        if (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.children[0]);
        }
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // ==================== 火灾预警等级 ====================

    _updateAlertLevel(isFire, imageName, timestamp) {
        if (typeof ForestFireScene === 'undefined') return;

        if (isFire) {
            // ★ 检测到火情 → 预警等级至少为"中"，保留原有框闪烁效果
            FireSimState.fireDetected = true;
            FireSimState.alertLevel = 'medium';
            FireSimState.latestFireImage = imageName;

            // 调用已有的渲染方法（含 alert-active + CSS 闪烁动画）
            if (typeof ForestFireScene.renderAlertLevel === 'function') {
                ForestFireScene.renderAlertLevel();
            }

            // 同时更新抓拍占位文字
            const phText = document.getElementById('capture-text');
            if (phText) phText.textContent = '检测到火情';
        } else {
            // ★ 无火情 → 恢复无警报状态（直接操作状态，避免 clearFire 产生额外日志）
            FireSimState.fireDetected = false;
            FireSimState.alertLevel = 'none';
            FireSimState.latestFireImage = '';
            if (typeof ForestFireScene.updateAlertLevel === 'function') {
                ForestFireScene.updateAlertLevel();
            }

            // 恢复占位文字
            const phText = document.getElementById('capture-text');
            if (phText) phText.textContent = '未检测到火情';
        }
    }

    // ==================== 工具 ====================

    _formatTimestamp() {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
               `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }
}
