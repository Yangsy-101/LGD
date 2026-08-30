/**
 * 设备管控场景 — 周界预警截图接收器（端口 10007）
 *
 * 由 shebeiguanong2.html 引入，点击"显示检测结果"后：
 *   1. 轮询 192.168.0.233:10007/latest.jpg 渲染截图
 *   2. 从响应头 X-Image-Name 解析文件名，同步写入"周界预警信息"面板
 *
 * 完整链路：
 *   计算板(周界算法) → SNAP帧 → server.py:11500 → :11405 → zhuanfa.py → HTTP :10007/latest.jpg
 */

const SBG_CONFIG = {
    host: '192.168.0.233',
    port: 10007,
    endpoint: '/latest.jpg',
    pollIntervalMs: 1500,
};

class SBGPhotoReceiver {
    constructor(config) {
        this.url = `http://${config.host}:${config.port}${config.endpoint}`;
        this.running = false;
        this.timer = null;
        this.lastBlobUrl = null;
        this.lastImageName = '';       // ★ 用响应头去重，替代永远不等的 Object URL 比较
    }

    // ==================== 公开 API ====================

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[SBG-Photo] 开始轮询: ' + this.url);
        this._poll();
    }

    stop() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.lastBlobUrl) { URL.revokeObjectURL(this.lastBlobUrl); this.lastBlobUrl = null; }
        this.lastImageName = '';
        console.log('[SBG-Photo] 停止');
    }

    // ==================== 轮询核心 ====================

    async _poll() {
        if (!this.running) return;
        try {
            const resp = await fetch(this.url + '?t=' + Date.now(), { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);

            // ★ 从响应头读取文件名（zhuanfa.py SnapshotHandler 的 X-Image-Name 头）
            const imageName = resp.headers.get('X-Image-Name') || '';

            const blob = await resp.blob();
            if (!blob.size) return;

            // ★ 用文件名去重，同一张图不重复刷新（消除闪烁）
            if (imageName && imageName === this.lastImageName) return;
            this.lastImageName = imageName;

            // 渲染截图
            const objUrl = URL.createObjectURL(blob);
            if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
            this.lastBlobUrl = objUrl;
            this._show(objUrl);

            // ★ 同步写入"周界预警信息"面板
            if (imageName) {
                this._syncPerimeterWarning(imageName);
            }
        } catch (e) {
            console.warn('[SBG-Photo] 拉取失败:', e.message);
        } finally {
            if (this.running) {
                this.timer = setTimeout(() => this._poll(), SBG_CONFIG.pollIntervalMs);
            }
        }
    }

    // ==================== 截图渲染 ====================

    _show(src) {
        const img = document.getElementById('sbg-shot-image');
        const ph = document.getElementById('sbg-shot-placeholder');

        if (img) { img.src = src; img.style.display = 'block'; }
        if (ph) ph.style.display = 'none';
    }

    // ==================== 周界预警同步 ====================

    /**
     * 将截图文件名解析后推入 SheBeiGuanKongScene 的周界预警列表。
     * 文件名格式示例: SNAP_ch4_gateway_5_20250624_143021_001.jpg
     */
    _syncPerimeterWarning(imageName) {
        var S = typeof SheBeiGuanKongScene !== 'undefined' ? SheBeiGuanKongScene : null;
        if (!S) return;

        // ★ 必须设置 running=true，否则 pushPerimeterWarning 只存 data 不渲染 DOM
        if (S.display) S.display.running = true;

        if (typeof S.pushPerimeterWarning === 'function') {
            S.pushPerimeterWarning(imageName, Date.now());
        }
    }
}
