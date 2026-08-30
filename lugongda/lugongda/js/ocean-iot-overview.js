/**
 * 远海远域物联通信场景 - 主页面概览模块
 * 数据与 ocean-iot2.html 保持一致的数值口径
 */

var OCEAN_OVERVIEW_UPDATE_MS = 3500;

var oceanOverviewState = {
    light: 7200,
    loudness: 56,
    temp: 26.5,
    humidity: 68,
    windSpeed: 12.5,
    windDir: 'NW',
    windDeg: 315,
    rfidWhitelistCount: 70,
    rfidRunning: true,
    comm5g: true,
    commShortwave: false,
    commTianqi: false
};

function jitterNumber(v, step, min, max, decimals) {
    decimals = decimals || 0;
    var sign = Math.random() > 0.5 ? 1 : -1;
    var next = Math.min(max, Math.max(min, v + sign * (Math.random() * step)));
    return parseFloat(next.toFixed(decimals));
}

function formatNow() {
    var d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map(function(v) { return String(v).padStart(2, '0'); }).join(':');
}

function tickOceanRealtimeData() {
    // --- 光照 6500~9100 Lux（与 ocean-iot.js updateLightSoundData 一致）---
    oceanOverviewState.light = Math.round(6500 + Math.random() * 2600);

    // --- 响度 45~69 dB ---
    oceanOverviewState.loudness = Math.round(45 + Math.random() * 24);

    // --- 温度 26.0~32.0°C（与 ocean-iot.js updateSensorData 一致）---
    oceanOverviewState.temp = jitterNumber(oceanOverviewState.temp, 0.8, 26.0, 32.0, 1);

    // --- 湿度 65~77% ---
    oceanOverviewState.humidity = Math.round(jitterNumber(oceanOverviewState.humidity, 2.5, 65, 77));

    // --- 风速 0.2~38 m/s（与 generateRealisticWind 一致）---
    oceanOverviewState.windSpeed = jitterNumber(oceanOverviewState.windSpeed, 2.0, 2.0, 30.0, 1);

    // --- 风向平滑抖动 ---
    var dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    if (Math.random() < 0.12) {
        oceanOverviewState.windDir = dirs[Math.floor(Math.random() * dirs.length)];
        oceanOverviewState.windDeg = Math.round(Math.random() * 360);
    }

    // --- RFID 始终运行中 ---
    oceanOverviewState.rfidRunning = true;

    // --- 通信链路固定：5G=在线, 短波=离线, 天启卫星=离线 ---
    oceanOverviewState.comm5g = true;
    oceanOverviewState.commShortwave = false;
    oceanOverviewState.commTianqi = false;

    return oceanOverviewState;
}

function initOceanIoTOverview() {
    var container = document.getElementById('ocean-iot-box');
    if (!container) return;

    container.innerHTML =
        '<div class="ocean-overview">' +

            '<!-- 地点 -->' +
            '<div class="ocean-location-row">' +
                '<span class="ocean-loc-label">地点</span>' +
                '<span class="ocean-loc-value">海口环海公路</span>' +
            '</div>' +

            '<!-- 核心网关 -->' +
            '<div class="ocean-gw-row">' +
                '<span class="ocean-gw-label">核心网关</span>' +
                '<span class="ocean-gw-status" id="ocean-gw-status">运行中</span>' +
            '</div>' +

            '<!-- 关键传感器 — 2×2 网格 -->' +
            '<div class="ocean-sensor-section">' +
                '<div class="ocean-section-title">关键传感器</div>' +
                '<div class="ocean-sensor-grid">' +

                    '<div class="os-cell">' +
                        '<span class="os-icon">☀️</span>' +
                        '<span class="os-name">光照</span>' +
                        '<span class="os-value" id="ocean-s-light">--</span>' +
                        '<span class="os-unit">Lux</span>' +
                    '</div>' +

                    '<div class="os-cell">' +
                        '<span class="os-icon">🔊</span>' +
                        '<span class="os-name">响度</span>' +
                        '<span class="os-value" id="ocean-s-loudness">--</span>' +
                        '<span class="os-unit">dB</span>' +
                    '</div>' +

                    '<div class="os-cell">' +
                        '<span class="os-icon">🌡️</span>' +
                        '<span class="os-name">温湿度</span>' +
                        '<span class="os-value" id="ocean-s-temp">--</span>' +
                        '<span class="os-unit">°C</span>' +
                        '<span class="os-sub" id="ocean-s-hum">--</span>' +
                    '</div>' +

                    '<div class="os-cell">' +
                        '<span class="os-icon">🌬️</span>' +
                        '<span class="os-name">风力</span>' +
                        '<span class="os-value" id="ocean-s-wind">--</span>' +
                        '<span class="os-unit">m/s</span>' +
                        '<span class="os-sub" id="ocean-s-winddir">--</span>' +
                    '</div>' +

                '</div>' +
            '</div>' +

            '<!-- RFID核验 -->' +
            '<div class="ocean-rfid-section">' +
                '<div class="ocean-section-title">RFID核验</div>' +
                '<div class="ocean-rfid-content">' +
                    '<div class="rfid-main-stat">' +
                        '<span class="rfid-big-icon">✅</span>' +
                        '<span class="rfid-big-label">白名单</span>' +
                        '<span class="rfid-big-value" id="ocean-rfid-wl">70</span>' +
                        '<span class="rfid-big-suffix">设备</span>' +
                    '</div>' +
                    '<div class="rfid-run-badge" id="ocean-rfid-badge">' +
                        '<span class="rfid-run-dot"></span>' +
                        '<span class="rfid-run-text">实时运行</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            '<!-- 通信链路 -->' +
            '<div class="ocean-comm-row">' +
                '<span class="ocean-comm-label">通信链路</span>' +
                '<span class="ocean-comm-tag is-online" id="ocean-comm-5g">' +
                    '<span class="ocean-comm-dot"></span>5G' +
                '</span>' +
                '<span class="ocean-comm-tag is-offline" id="ocean-comm-shortwave">' +
                    '<span class="ocean-comm-dot"></span>短波' +
                '</span>' +
                '<span class="ocean-comm-tag is-offline" id="ocean-comm-tianqi">' +
                    '<span class="ocean-comm-dot"></span>天启卫星' +
                '</span>' +
            '</div>' +

        '</div>';

    updateOceanData();
    setInterval(updateOceanData, OCEAN_OVERVIEW_UPDATE_MS);
}

function updateOceanData() {
    var data = tickOceanRealtimeData();

    document.getElementById('ocean-s-light') && (document.getElementById('ocean-s-light').textContent = String(data.light));
    document.getElementById('ocean-s-loudness') && (document.getElementById('ocean-s-loudness').textContent = String(data.loudness));
    document.getElementById('ocean-s-temp') && (document.getElementById('ocean-s-temp').textContent = data.temp.toFixed(1));
    document.getElementById('ocean-s-hum') && (document.getElementById('ocean-s-hum').textContent = data.humidity + '%');
    document.getElementById('ocean-s-wind') && (document.getElementById('ocean-s-wind').textContent = data.windSpeed.toFixed(1));
    document.getElementById('ocean-s-winddir') && (document.getElementById('ocean-s-winddir').textContent = data.windDir + ' ' + data.windDeg + '°');
    document.getElementById('ocean-rfid-wl') && (document.getElementById('ocean-rfid-wl').textContent = String(data.rfidWhitelistCount));

    updateCommTag('ocean-comm-5g', data.comm5g);
    updateCommTag('ocean-comm-shortwave', data.commShortwave);
    updateCommTag('ocean-comm-tianqi', data.commTianqi);
}

function updateCommTag(id, isOnline) {
    var el = document.getElementById(id);
    if (!el) return;
    if (isOnline) {
        el.classList.add('is-online');
        el.classList.remove('is-offline');
    } else {
        el.classList.add('is-offline');
        el.classList.remove('is-online');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOceanIoTOverview);
} else {
    initOceanIoTOverview();
}
