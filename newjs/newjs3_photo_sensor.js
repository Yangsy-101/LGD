/**
 * 应急救援场景 — 火灾检测截图接收器（端口 10005）
 *
 * 由 yingjijiuyuan2.html 引入。
 *   - "开始显示"：轮询 /latest.jpg 渲染到 #yjy-capture-image
 *   - "显示火灾数据"：切换为数据模式，展示火情检测日志
 *
 * 完整链路：
 *   计算板 → SNAP帧 → server.py:11500 → :11404 → zhuanfa.py → HTTP :10005/latest.jpg
 */

const YJY_CONFIG = {
    host: '192.168.0.233',
    port: 10006,               // gateway_3 → server:11402 → zhuanfa SNAP HTTP
    snapshotEndpoint: '/latest.jpg',
    pollIntervalMs: 1500,
};

// ★ 火灾检测日志缓存（供数据模式展示）
var YJY_FIRE_LOG = [];

class YJYSnapshotReceiver {
    constructor(config) {
        this.url = `http://${config.host}:${config.port}${config.snapshotEndpoint}`;
        this.running = false;
        this.timer = null;
        this.lastBlobUrl = null;
        this.lastImageName = '';       // ★ X-Image-Name 去重
    }

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[YJY-Snapshot] 开始轮询: ' + this.url);
        this._poll();
    }

    stop() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.lastBlobUrl) { URL.revokeObjectURL(this.lastBlobUrl); this.lastBlobUrl = null; }
        this.lastImageName = '';
        console.log('[YJY-Snapshot] 停止');
    }

    async _poll() {
        if (!this.running) return;
        try {
            const resp = await fetch(this.url + '?t=' + Date.now(), { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);

            const imageName = resp.headers.get('X-Image-Name') || '';
            const blob = await resp.blob();

            console.log('[YJY-Snapshot] poll: status=' + resp.status +
                ' imageName="' + imageName + '" blobSize=' + (blob ? blob.size : 0) +
                ' lastName="' + this.lastImageName + '"');

            if (!blob.size) return;

            const changed = !imageName || imageName !== this.lastImageName;
            console.log('[YJY-Snapshot] changed=' + changed);

            if (changed) {
                this.lastImageName = imageName;

                const objUrl = URL.createObjectURL(blob);
                if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
                this.lastBlobUrl = objUrl;

                console.log('[YJY-Snapshot] UPDATING image + log');
                this._show(objUrl, imageName);

                if (imageName) this._logDetection(imageName);
            }
        } catch (e) {
            console.warn('[YJY-Snapshot] 拉取失败:', e.message);
        } finally {
            if (this.running) {
                this.timer = setTimeout(() => this._poll(), YJY_CONFIG.pollIntervalMs);
            }
        }
    }

    _show(src, imageName) {
        const scene = window.YingJiJiuYuanScene;

        // 渲染截图
        if (scene) {
            const img = scene.els?.capture?.image;
            const ph = scene.els?.capture?.placeholder;
            const dl = scene.els?.capture?.dataList;

            if (img) { img.src = src; img.style.display = 'block'; }
            if (ph) ph.style.display = 'none';
            if (dl) dl.style.display = 'none';

            if (scene.displayMode !== 'snapshot') {
                scene.displayMode = 'snapshot';
                if (typeof scene.syncCaptureToggleBtnText === 'function') {
                    scene.syncCaptureToggleBtnText();
                }
            }
        } else {
            // 降级：直接操作 DOM
            const img = document.getElementById('yjy-capture-image');
            const ph = document.getElementById('yjy-capture-placeholder');
            if (img) { img.src = src; img.style.display = 'block'; }
            if (ph) ph.style.display = 'none';
        }

        // ★ 判断火情并写入检测日志
        if (imageName) {
            this._logDetection(imageName);
        }
    }

    // ==================== 火灾检测日志 ====================

    _logDetection(imageName) {
        const ts = YJYSnapshotReceiver._formatTS();
        const isFire = this._isFire(imageName);

        const entry = {
            time: ts,
            isFire: isFire,
            text: isFire
                ? `[${ts}] 检测到火情，请立即处理！`
                : `[${ts}] 持续监测中，未发现火情异常。`,
            imageName: imageName
        };

        YJY_FIRE_LOG.unshift(entry);
        if (YJY_FIRE_LOG.length > 50) YJY_FIRE_LOG.length = 50;

        // 同步写入 YingJiJiuYuanScene（如果存在）
        if (typeof YingJiJiuYuanScene !== 'undefined') {
            try {
                if (typeof YingJiJiuYuanScene.addFireInfo === 'function') {
                    YingJiJiuYuanScene.addFireInfo(entry.text);
                }
                if (isFire && typeof YingJiJiuYuanScene.handleFireEmergency === 'function') {
                    YingJiJiuYuanScene.handleFireEmergency({
                        filename: imageName,
                        timeStr: ts,
                        fireCount: YJY_FIRE_LOG.filter(e => e.isFire).length
                    });
                }
            } catch (_) {}
        }
    }

    _isFire(filename) {
        const upper = String(filename || '').toUpperCase();
        if (!upper || upper.includes('NOFIRE')) return false;
        return upper.includes('FIRE');
    }

    static _formatTS() {
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
               `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    }
}

// ==================== 火灾数据展示 ====================

/**
 * 渲染火灾检测日志到 dataList 面板。
 * 由"显示火灾数据"按钮触发。
 */
function YJY_renderFireDataList() {
    const dataList = document.getElementById('yjy-capture-data-list');
    const image = document.getElementById('yjy-capture-image');
    const placeholder = document.getElementById('yjy-capture-placeholder');

    if (!dataList) return;

    // 隐藏图片 / 占位符
    if (image) image.style.display = 'none';
    if (placeholder) placeholder.style.display = 'none';

    // 渲染日志
    if (YJY_FIRE_LOG.length === 0) {
        dataList.innerHTML = `<div style="padding:16px;color:#8ab4d6;text-align:center;">暂无火灾检测数据</div>`;
    } else {
        dataList.innerHTML = YJY_FIRE_LOG.map(e => {
            const cls = e.isFire ? 'fire-alert' : 'fire-normal';
            const icon = e.isFire ? '🔥' : '✓';
            return `<div class="yjy-data-row ${cls}" style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="color:${e.isFire ? '#ff6b6b' : '#4ecdc4'};margin-right:6px;">${icon}</span>
                <span style="color:#d6eaff;">${e.text}</span>
            </div>`;
        }).join('');
    }
    dataList.style.display = 'flex';
}

/**
 * 切换回截图模式。
 */
function YJY_renderSnapshotMode() {
    const dataList = document.getElementById('yjy-capture-data-list');
    if (dataList) dataList.style.display = 'none';
}
