/**
 * 智慧工厂设备管控及周界预警 - 主页面概览模块
 * 在主大屏上显示简洁的监控概览
 */

// 模拟数据生成
function generateFactoryData() {
    return {
        deviceOnline: Math.floor(12 + Math.random() * 3),
        deviceTotal: 15,
        todayAlerts: Math.floor(Math.random() * 5),
        personnelCount: Math.floor(20 + Math.random() * 15),
        perimeterStatus: Math.random() > 0.9 ? 'alert' : 'normal',
        faceRecognition: Math.random() > 0.85 ? 'fail' : 'pass'
    };
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
}

function clearSvg(svg) {
    while (svg && svg.firstChild) svg.removeChild(svg.firstChild);
}

function polar(cx, cy, r, angleDeg) {
    const a = (angleDeg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
    const s = polar(cx, cy, r, endAngle);
    const e = polar(cx, cy, r, startAngle);
    const large = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y} Z`;
}

function shadeColor(rgba, factor = 0.8) {
    const m = rgba.match(/rgba\((\s*\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/i);
    if (!m) return rgba;
    const r = Math.max(0, Math.min(255, Math.round(Number(m[1]) * factor)));
    const g = Math.max(0, Math.min(255, Math.round(Number(m[2]) * factor)));
    const b = Math.max(0, Math.min(255, Math.round(Number(m[3]) * factor)));
    const a = m[4];
    return `rgba(${r},${g},${b},${a})`;
}

let foFallbackState = { pass: 12, block: 2, alert: 0 };

function bumpFallbackState() {
    // 轻量波动：保证看起来“在更新”，但不会跳太大
    const r = Math.random();
    if (r < 0.70) foFallbackState.pass += 1;
    else if (r < 0.88) foFallbackState.block += 1;
    else foFallbackState.alert += 1;

    // 防止无上限增长导致饼图看起来越来越“满”
    const sum = foFallbackState.pass + foFallbackState.block + foFallbackState.alert;
    if (sum > 80) {
        foFallbackState.pass = Math.max(8, Math.round(foFallbackState.pass * 0.55));
        foFallbackState.block = Math.max(1, Math.round(foFallbackState.block * 0.55));
        foFallbackState.alert = Math.max(0, Math.round(foFallbackState.alert * 0.55));
    }
}

function render3DPie(svg, values, colors, thickness = 12) {
    if (!svg) return;
    clearSvg(svg);

    const rect = svg.getBoundingClientRect();
    const w = Math.max(10, rect.width || 0);
    const h = Math.max(10, rect.height || 0);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const uid = `foPie_${Math.random().toString(36).slice(2, 9)}`;

    const parseRgba = (rgba) => {
        const m = String(rgba).match(/rgba\((\s*\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/i);
        if (!m) return { r: 148, g: 163, b: 184, a: 0.85 };
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) };
    };

    const rgbaStr = ({ r: rr, g: gg, b: bb, a: aa }) => {
        const r0 = Math.max(0, Math.min(255, Math.round(rr)));
        const g0 = Math.max(0, Math.min(255, Math.round(gg)));
        const b0 = Math.max(0, Math.min(255, Math.round(bb)));
        const a0 = Math.max(0, Math.min(1, Number(aa)));
        return `rgba(${r0},${g0},${b0},${a0})`;
    };

    const mulRgb = (rgba, f) => {
        const c = parseRgba(rgba);
        return rgbaStr({ r: c.r * f, g: c.g * f, b: c.b * f, a: c.a });
    };

    const mixToWhite = (rgba, t) => {
        const c = parseRgba(rgba);
        const tt = Math.max(0, Math.min(1, t));
        return rgbaStr({
            r: c.r + (255 - c.r) * tt,
            g: c.g + (255 - c.g) * tt,
            b: c.b + (255 - c.b) * tt,
            a: c.a
        });
    };

    const total = values.reduce((s, v) => s + (Number(v) || 0), 0);
    const cx = w * 0.44;
    const cy = h * 0.52;
    const r = Math.max(22, Math.min(w, h) * 0.33);
    const tilt = 0.86;

    const defs = svgEl('defs', {});

    // 更自然的软阴影（更大、更淡、更柔，偏移到右下）
    const softShadowId = `${uid}_softShadow`;
    const softShadow = svgEl('filter', { id: softShadowId, x: '-40%', y: '-40%', width: '200%', height: '200%' });
    softShadow.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '10', result: 'blur' }));
    defs.appendChild(softShadow);

    // 顶面扫光（方向性高光）
    const sweepId = `${uid}_sweep`;
    const sweep = svgEl('linearGradient', { id: sweepId, x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
    sweep.appendChild(svgEl('stop', { offset: '0%', 'stop-color': 'rgba(255,255,255,0.00)' }));
    sweep.appendChild(svgEl('stop', { offset: '35%', 'stop-color': 'rgba(255,255,255,0.14)' }));
    sweep.appendChild(svgEl('stop', { offset: '55%', 'stop-color': 'rgba(255,255,255,0.00)' }));
    defs.appendChild(sweep);

    // 顶面裁剪（保证高光只出现在顶面范围内）
    const topClipId = `${uid}_topClip`;
    const clip = svgEl('clipPath', { id: topClipId, clipPathUnits: 'userSpaceOnUse' });
    clip.appendChild(svgEl('circle', { cx, cy, r }));
    defs.appendChild(clip);

    svg.appendChild(defs);

    if (!total) {
        const g = svgEl('g', {});
        g.appendChild(svgEl('circle', {
            cx,
            cy,
            r,
            fill: 'rgba(0,0,0,0.15)',
            stroke: 'rgba(0,234,255,0.22)',
            'stroke-width': 2
        }));
        svg.appendChild(g);
        return;
    }

    // 底部阴影（在倾斜之前画，模拟环境投影）
    svg.appendChild(svgEl('ellipse', {
        cx: cx + r * 0.18,
        cy: cy + thickness + r * 0.46,
        rx: r * 1.05,
        ry: r * 0.34,
        fill: 'rgba(0,0,0,0.18)',
        filter: `url(#${softShadowId})`
    }));

    // 角度切片
    let angle = 0;
    const slices = values.map((v, i) => {
        const pct = (Number(v) || 0) / total;
        const a0 = angle;
        const a1 = angle + pct * 360;
        angle = a1;
        return { i, v: Number(v) || 0, a0, a1, mid: (a0 + a1) / 2 };
    });

    // 倾斜透视
    const baseTransform = `translate(0 ${(cy * (1 - tilt)).toFixed(2)}) scale(1 ${tilt})`;
    const sideG = svgEl('g', { transform: baseTransform });
    const topG = svgEl('g', { transform: baseTransform });

    // 仅渲染“可见前半圈”的侧壁：角度落在 [90,270]（下半圈）
    const VIS_LO = 90;
    const VIS_HI = 270;
    const clipVisible = (a0, a1) => {
        const s = Math.max(a0, VIS_LO);
        const e = Math.min(a1, VIS_HI);
        return s < e ? { s, e } : null;
    };

    const arcBandPath = (cx0, cy0, r0, t0, sAng, eAng) => {
        const p1 = polar(cx0, cy0, r0, sAng);
        const p2 = polar(cx0, cy0, r0, eAng);
        const p1b = polar(cx0, cy0 + t0, r0, sAng);
        const p2b = polar(cx0, cy0 + t0, r0, eAng);
        const large = (eAng - sAng) > 180 ? 1 : 0;

        // 底边：顺时针 sweep=1；顶边：逆时针 sweep=0
        return [
            `M ${p1b.x} ${p1b.y}`,
            `A ${r0} ${r0} 0 ${large} 1 ${p2b.x} ${p2b.y}`,
            `L ${p2.x} ${p2.y}`,
            `A ${r0} ${r0} 0 ${large} 0 ${p1.x} ${p1.y}`,
            'Z'
        ].join(' ');
    };

    // 侧壁：渐变（上下更暗）+ 受光方向（左上更亮、右下更暗）
    slices.forEach((s) => {
        if (s.v <= 0) return;
        const vis = clipVisible(s.a0, s.a1);
        if (!vis) return;

        const base = colors[s.i] || 'rgba(148,163,184,0.85)';

        // 光源方向：左上（在本角度系统里约等于 315deg）
        const lightAng = 315;
        const k = Math.cos(((s.mid - lightAng) * Math.PI) / 180);
        const face = 0.72 + 0.28 * Math.max(-1, Math.min(1, k));

        const gId = `${uid}_side_${s.i}`;
        const g = svgEl('linearGradient', {
            id: gId,
            gradientUnits: 'userSpaceOnUse',
            x1: cx,
            y1: cy,
            x2: cx,
            y2: cy + thickness + r * 0.20
        });
        g.appendChild(svgEl('stop', { offset: '0%', 'stop-color': mulRgb(base, 0.80 * face) }));
        g.appendChild(svgEl('stop', { offset: '55%', 'stop-color': mulRgb(base, 0.66 * face) }));
        g.appendChild(svgEl('stop', { offset: '100%', 'stop-color': mulRgb(base, 0.50 * face) }));
        defs.appendChild(g);

        sideG.appendChild(svgEl('path', {
            d: arcBandPath(cx, cy, r, thickness, vis.s, vis.e),
            fill: `url(#${gId})`,
            stroke: 'rgba(0,0,0,0.10)',
            'stroke-width': 0.6
        }));
    });

    // 顶面：每扇区径向渐变 + 轻微暗角（中心更亮、边缘略暗；光源左上）
    slices.forEach((s) => {
        if (s.v <= 0) return;
        const base = colors[s.i] || 'rgba(148,163,184,0.85)';

        const gradId = `${uid}_top_${s.i}`;
        const rg = svgEl('radialGradient', {
            id: gradId,
            gradientUnits: 'userSpaceOnUse',
            cx: cx - r * 0.22,
            cy: cy - r * 0.22,
            r: r * 1.10,
            fx: cx - r * 0.30,
            fy: cy - r * 0.30
        });
        rg.appendChild(svgEl('stop', { offset: '0%', 'stop-color': mixToWhite(base, 0.22) }));
        rg.appendChild(svgEl('stop', { offset: '62%', 'stop-color': mulRgb(base, 0.98) }));
        rg.appendChild(svgEl('stop', { offset: '100%', 'stop-color': mulRgb(base, 0.86) }));
        defs.appendChild(rg);

        topG.appendChild(svgEl('path', {
            d: arcPath(cx, cy, r, s.a0, s.a1),
            fill: `url(#${gradId})`,
            stroke: 'rgba(255,255,255,0.10)',
            'stroke-width': 1.1
        }));
    });

    svg.appendChild(sideG);
    svg.appendChild(topG);

    // 环境遮蔽 AO：顶面与侧面交界处的轻微压边暗环
    const ao = svgEl('g', { transform: baseTransform });
    ao.appendChild(svgEl('circle', {
        cx,
        cy,
        r: r * 0.985,
        fill: 'none',
        stroke: 'rgba(0,0,0,0.16)',
        'stroke-width': 2.6
    }));
    svg.appendChild(ao);

    // Rim light：一圈极细的轮廓光
    const rim = svgEl('g', { transform: baseTransform });
    rim.appendChild(svgEl('circle', {
        cx,
        cy,
        r: r * 0.992,
        fill: 'none',
        stroke: 'rgba(255,255,255,0.10)',
        'stroke-width': 1
    }));
    svg.appendChild(rim);

    // 高光：方向性扫光（clip到顶面范围内）
    const hl = svgEl('g', { transform: baseTransform, 'clip-path': `url(#${topClipId})` });
    hl.appendChild(svgEl('rect', {
        x: cx - r * 1.25,
        y: cy - r * 1.25,
        width: r * 2.6,
        height: r * 2.6,
        fill: `url(#${sweepId})`
    }));
    svg.appendChild(hl);
}

// 初始化智慧工厂概览面板
function initSmartFactoryOverview() {
    const container = document.getElementById('smart-factory-box');
    if (!container) return;

    // 创建概览HTML结构
    container.innerHTML = `
        <div class="factory-overview">
            <!-- 顶部状态栏 -->
            <div class="fo-status-bar">
                <div class="fo-status-item">
                    <span class="fo-status-label">系统状态</span>
                    <span class="fo-status-value fo-online">运行中</span>
                </div>
                <div class="fo-status-item">
                    <span class="fo-status-label">地点</span>
                    <span class="fo-status-value fo-location">南京邮电大学</span>
                </div>
            </div>

            <div class="fo-traffic">
                <div class="fo-traffic-title">通行态势（通过/拦截/告警）</div>
                <div class="fo-traffic-body">
                    <div class="fo-pie-wrap">
                        <svg class="fo-pie" id="fo-traffic-pie"></svg>
                    </div>
                    <div class="fo-traffic-legend">
                        <div class="fo-legend-row">
                            <span class="fo-legend-dot fo-dot-pass"></span>
                            <span class="fo-legend-name">通过</span>
                            <span class="fo-legend-val" id="fo-pass">0</span>
                        </div>
                        <div class="fo-legend-row">
                            <span class="fo-legend-dot fo-dot-block"></span>
                            <span class="fo-legend-name">拦截</span>
                            <span class="fo-legend-val" id="fo-block">0</span>
                        </div>
                        <div class="fo-legend-row">
                            <span class="fo-legend-dot fo-dot-alert"></span>
                            <span class="fo-legend-name">告警</span>
                            <span class="fo-legend-val" id="fo-alert">0</span>
                        </div>
                        <div class="fo-legend-row fo-legend-kpi">
                            <span class="fo-legend-name">通过率</span>
                            <span class="fo-legend-val" id="fo-passrate">0%</span>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    `;

    // 添加样式
    addFactoryOverviewStyles();

    // 启动数据更新
    updateFactoryData();
    setInterval(updateFactoryData, 800);

    if (!initSmartFactoryOverview.boundStorage) {
        initSmartFactoryOverview.boundStorage = true;
        window.addEventListener('storage', (e) => {
            if (!e || e.key !== 'smart_factory_snapshot') return;
            updateFactoryData();
        });
    }
}

initSmartFactoryOverview.boundStorage = false;

// 更新工厂数据
function updateFactoryData() {
    const now = Date.now();
    const snap = safeJsonParse(localStorage.getItem('smart_factory_snapshot') || '');

    const passEl = document.getElementById('fo-pass');
    const blockEl = document.getElementById('fo-block');
    const alertEl = document.getElementById('fo-alert');
    const passRateEl = document.getElementById('fo-passrate');
    const pie = document.getElementById('fo-traffic-pie');

    let pass = 0;
    let block = 0;
    let alert = 0;
    let passRate = 0;

    const snapFresh = !!(snap && typeof snap.ts === 'number' && (now - snap.ts) <= 6000);
    if (snapFresh && snap && snap.totals) {
        pass = Number(snap.totals.totalPass) || 0;
        block = Number(snap.totals.totalBlock) || 0;
        alert = Number(snap.totals.totalAlert) || 0;
        passRate = Number(snap.totals.passRate) || 0;

        // 用真实数据“校准”回退状态，避免从真实切到模拟时突然跳变
        foFallbackState = { pass, block, alert };
    } else {
        bumpFallbackState();
        pass = foFallbackState.pass;
        block = foFallbackState.block;
        alert = foFallbackState.alert;
        const denom = pass + block + alert;
        passRate = denom <= 0 ? 0 : Math.round((pass / denom) * 100);
    }

    if (passEl) passEl.textContent = String(Math.round(pass));
    if (blockEl) blockEl.textContent = String(Math.round(block));
    if (alertEl) alertEl.textContent = String(Math.round(alert));
    if (passRateEl) passRateEl.textContent = `${Math.round(passRate)}%`;

    render3DPie(
        pie,
        [pass, block, alert],
        ['rgba(34,211,153,0.92)', 'rgba(248,113,113,0.88)', 'rgba(251,191,36,0.88)'],
        12
    );
}

// 添加样式
function addFactoryOverviewStyles() {
    if (document.getElementById('factory-overview-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'factory-overview-styles';
    styles.textContent = `
        .factory-overview {
            height: 100%;
            display: flex;
            flex-direction: column;
            padding: 12px;
            gap: 12px;
            justify-content: space-between;
        }

        .fo-status-bar {
            display: flex;
            justify-content: space-between;
            padding: 6px 10px;
            background: rgba(0, 234, 255, 0.08);
            border-radius: 6px;
            border: 1px solid rgba(0, 234, 255, 0.15);
        }

        .fo-status-item {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 14px;
        }

        .fo-status-icon {
            font-size: 14px;
        }

        .fo-status-label {
            color: #94a3b8;
            font-size: 13px;
        }

        .fo-status-value {
            color: #e2e8f0;
            font-weight: bold;
            font-size: 15px;
        }

        .fo-online {
            color: #10b981;
        }

        .fo-location {
            color: rgba(0,234,255,0.9);
        }

        .fo-traffic {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: rgba(0, 0, 0, 0.18);
            border: 1px solid rgba(0, 234, 255, 0.16);
            border-radius: 10px;
            padding: 10px 12px;
            gap: 8px;
            overflow: hidden;
        }

        .fo-traffic-title {
            font-size: 16px;
            color: rgba(226,232,240,0.96);
            letter-spacing: 0.3px;
        }

        .fo-traffic-body {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 0;
        }

        .fo-pie-wrap {
            flex: 0 0 46%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 120px;
            position: relative;
            overflow: hidden;
            border-radius: 14px;
        }

        .fo-pie-wrap::before {
            content: '';
            position: absolute;
            inset: 8px;
            border-radius: 14px;
            background:
                radial-gradient(circle at 38% 32%, rgba(0,234,255,0.14), rgba(0,234,255,0.00) 62%),
                radial-gradient(circle at 55% 65%, rgba(34,211,153,0.10), rgba(34,211,153,0.00) 58%),
                radial-gradient(circle at 50% 85%, rgba(0,0,0,0.22), rgba(0,0,0,0.00) 60%);
            filter: blur(0.2px);
        }

        .fo-pie-wrap::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 14px;
            background: radial-gradient(circle at 50% 55%, rgba(0,0,0,0.00) 40%, rgba(0,0,0,0.20) 100%);
            opacity: 0.55;
            pointer-events: none;
        }

        .fo-pie {
            width: 100%;
            height: 100%;
            position: relative;
            z-index: 1;
        }

        .fo-traffic-legend {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-right: 4px;
        }

        .fo-legend-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            border-radius: 8px;
            background: rgba(2, 10, 23, 0.24);
            border: 1px solid rgba(0, 234, 255, 0.12);
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
        }

        .fo-legend-row.fo-legend-kpi {
            background: rgba(168, 85, 247, 0.06);
            border-color: rgba(168, 85, 247, 0.18);
        }

        .fo-legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 999px;
            box-shadow: 0 0 10px rgba(0,0,0,0.12);
        }

        .fo-dot-pass {
            background: rgba(34,211,153,0.92);
            box-shadow: 0 0 12px rgba(34,211,153,0.32);
        }

        .fo-dot-block {
            background: rgba(248,113,113,0.90);
            box-shadow: 0 0 12px rgba(248,113,113,0.26);
        }

        .fo-dot-alert {
            background: rgba(251,191,36,0.92);
            box-shadow: 0 0 12px rgba(251,191,36,0.22);
        }

        .fo-legend-name {
            flex: 1;
            color: rgba(148,163,184,0.95);
            font-size: 14px;
        }

        .fo-legend-val {
            color: rgba(226,232,240,0.95);
            font-weight: 700;
            font-size: 18px;
            font-family: 'Consolas', monospace;
        }

        .fo-metrics {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }

        .fo-metric-card {
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(0, 234, 255, 0.2);
            border-radius: 8px;
            padding: 12px 10px;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: all 0.3s;
        }

        .fo-metric-card:hover {
            border-color: rgba(0, 234, 255, 0.5);
            background: rgba(0, 234, 255, 0.05);
        }

        .fo-metric-icon {
            font-size: 24px;
            opacity: 0.8;
        }

        .fo-metric-value {
            font-size: 22px;
            font-weight: bold;
            color: #00eaff;
            font-family: 'Consolas', monospace;
            transition: transform 0.2s;
        }

        .fo-metric-total {
            font-size: 14px;
            color: #64748b;
        }

        .fo-metric-label {
            font-size: 12px;
            color: #94a3b8;
            margin-top: 2px;
        }

        .fo-metric-alert .fo-metric-value {
            color: #fbbf24;
        }

        .fo-metric-alert.fo-has-alert {
            border-color: rgba(239, 68, 68, 0.5);
            animation: fo-alert-pulse 1.5s infinite;
        }

        .fo-metric-alert.fo-has-alert .fo-metric-value {
            color: #ef4444;
        }

        @keyframes fo-alert-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
            50% { box-shadow: 0 0 10px 2px rgba(239, 68, 68, 0.2); }
        }

        .fo-algo-section {
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .fo-algo-title {
            font-size: 13px;
            color: #94a3b8;
            margin-bottom: 8px;
            padding-left: 4px;
        }

        .fo-algo-list {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
            justify-content: center;
        }

        .fo-algo-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 6px;
            border: 1px solid rgba(0, 234, 255, 0.1);
        }

        .fo-algo-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }

        .fo-dot-normal {
            background: #10b981;
            box-shadow: 0 0 6px #10b981;
        }

        .fo-dot-alert {
            background: #ef4444;
            box-shadow: 0 0 6px #ef4444;
            animation: fo-blink 0.5s infinite;
        }

        @keyframes fo-blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        .fo-algo-name {
            flex: 1;
            font-size: 14px;
            color: #e2e8f0;
        }

        .fo-algo-status {
            font-size: 13px;
            color: #10b981;
            font-weight: bold;
        }
    `;
    document.head.appendChild(styles);
}

// 页面加载后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSmartFactoryOverview);
} else {
    initSmartFactoryOverview();
}
