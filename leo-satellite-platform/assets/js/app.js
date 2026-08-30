/* Frontend logic for sensor dashboard */

const PROJECT20_APP_BACKEND_PORT = '8090';
const normalizeProject20AppApiBase = (value) => String(value || '').replace(/\/$/, '');

const isProject20AppLocalPreviewHost = (hostname) =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

const buildProject20AppOrigin = (protocol, hostname, port) =>
    `${protocol}//${hostname}${port ? `:${port}` : ''}`;

const resolveApiBase = () => {
    if (typeof window === 'undefined' || !window.location) {
        return '';
    }
    if (window.__PROJECT20_API_BASE__) {
        return normalizeProject20AppApiBase(window.__PROJECT20_API_BASE__);
    }
    if (window.__API_BASE__) {
        return normalizeProject20AppApiBase(window.__API_BASE__);
    }

    const { protocol, hostname, port, pathname } = window.location;
    if (protocol === 'file:') {
        return 'http://127.0.0.1:8090';
    }
    if (isProject20AppLocalPreviewHost(hostname) && port && port !== PROJECT20_APP_BACKEND_PORT) {
        return `${protocol}//${hostname}:${PROJECT20_APP_BACKEND_PORT}`;
    }
    if (pathname.startsWith('/project2-0/')) {
        return `${buildProject20AppOrigin(protocol, hostname, port)}/project2-0`;
    }
    return '';
};

const CONFIG = {
    API_BASE: resolveApiBase(),
    REFRESH_INTERVAL: 5000,
    HISTORY_ROWS: 30
};

const buildApiUrl = (path) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizeProject20AppApiBase(CONFIG.API_BASE)}${normalizedPath}`;
};

const parseProject20AppJsonResponse = async (response, requestLabel) => {
    if (!response.ok) {
        const fallbackText = await response.text().catch(() => '');
        const preview = fallbackText ? fallbackText.slice(0, 120).replace(/\s+/g, ' ') : '';
        throw new Error(`${requestLabel} HTTP ${response.status}${preview ? ` | ${preview}` : ''}`);
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
        const fallbackText = await response.text().catch(() => '');
        const preview = fallbackText ? fallbackText.slice(0, 120).replace(/\s+/g, ' ') : 'empty response';
        throw new Error(`${requestLabel} returned non-JSON | ${preview}`);
    }
    return response.json();
};

const MAX_DATA_POINTS = 30;

const state = {
    currentAccessPoint: 'gateway1',
    accessPoints: [],
    lastSeenId: 0,
    lastSeenIdBySn: {},
    lastData: null,
    clockTimer: null,
    refreshTimer: null,
    countdownTimer: null,
    noticeTimer: null,
    countdown: 5,
    isPageActive: true,
    isInitialized: false,
    historyRows: []
};

const getLastSeenId = (snCode) => {
    if (!snCode) return 0;
    const value = state.lastSeenIdBySn[snCode];
    return typeof value === 'number' ? value : 0;
};

const setLastSeenId = (snCode, nextId) => {
    if (!snCode) return;
    const safeId = Math.max(0, Number(nextId) || 0);
    const prev = getLastSeenId(snCode);
    const finalId = Math.max(prev, safeId);
    state.lastSeenIdBySn[snCode] = finalId;
    if (snCode === state.currentAccessPoint) {
        state.lastSeenId = finalId;
    }
};

const COLORS = {
    temperature: {
        primary: '#ff6b6b',
        bg: 'rgba(255, 107, 107, 0.1)',
        border: 'rgba(255, 107, 107, 0.8)'
    },
    humidity: {
        primary: '#4ecdc4',
        bg: 'rgba(78, 205, 196, 0.1)',
        border: 'rgba(78, 205, 196, 0.8)'
    },
    pressure: {
        primary: '#ffd93d',
        bg: 'rgba(255, 217, 61, 0.1)',
        border: 'rgba(255, 217, 61, 0.8)'
    },
    noise: {
        primary: '#a855f7',
        bg: 'rgba(168, 85, 247, 0.1)',
        border: 'rgba(168, 85, 247, 0.8)'
    }
};

const charts = {
    temp: null,
    humidity: null,
    pressure: null,
    noise: null
};

function formatDateTime(dateString) {
    if (!dateString) return '--';
    const value = String(dateString).trim().replace('T', ' ');
    return value.length === 16 ? `${value}:00` : value;
}

function parseSensorDateTime(value) {
    if (!value) return null;
    const original = String(value).trim();
    const isoDate = new Date(original);
    if (!Number.isNaN(isoDate.getTime())) return isoDate;
    const legacyDate = new Date(original.replace('T', ' ').replace(/-/g, '/'));
    return Number.isNaN(legacyDate.getTime()) ? null : legacyDate;
}

function calculateLinkLatency(data) {
    const collected = parseSensorDateTime(data?.payload_time || data?.source_time);
    const ingested = parseSensorDateTime(data?.recv_time || data?.create_time);
    if (!collected || !ingested) return null;
    return Math.max(0, Math.round((ingested.getTime() - collected.getTime()) / 1000));
}

function formatLatency(seconds) {
    if (!Number.isFinite(seconds)) return '--';
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

function getLatencyLevel(seconds) {
    if (!Number.isFinite(seconds)) return 'unknown';
    if (seconds <= 120) return 'good';
    if (seconds <= 300) return 'medium';
    return 'high';
}

function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { hour12: false });
}

function updateClock() {
    const el = document.getElementById('currentTime');
    const dateEl = document.getElementById('currentDate');
    const now = new Date();
    if (el) {
        el.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    }
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).replaceAll('/', '-');
    }
}

function updateCountdown() {
    const countdownEl = document.getElementById('refreshCountdown');
    if (countdownEl) {
        countdownEl.textContent = `${state.countdown}s`;
    }
    state.countdown--;
    if (state.countdown < 0) {
        state.countdown = 5;
    }
}

function setApiStatus(isOnline) {
    const apiStatus = document.getElementById('apiStatus');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionLabel = connectionStatus?.querySelector('.status-copy strong');

    if (apiStatus) {
        apiStatus.textContent = isOnline ? '正常' : '异常';
        apiStatus.classList.toggle('online', isOnline);
        apiStatus.classList.toggle('offline', !isOnline);
    }

    if (connectionStatus) {
        connectionStatus.classList.toggle('online', isOnline);
        connectionStatus.classList.toggle('offline', !isOnline);
    }
    if (connectionLabel) {
        connectionLabel.textContent = isOnline ? '在线运行' : '链路异常';
    }
}

function ensureUpdateNotice() {
    let notice = document.getElementById('sensorUpdateNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'sensorUpdateNotice';
        notice.className = 'sensor-update-toast';
        document.body.appendChild(notice);
    }
    return notice;
}

function showUpdateNotice(snCode, count, latestRecord = null) {
    const notice = ensureUpdateNotice();
    if (!notice) return;
    const ap = state.accessPoints.find(a => a.sn_code === snCode);
    const name = ap ? ap.name : snCode;
    const collectedTime = formatDateTime(latestRecord?.payload_time || latestRecord?.source_time);
    const latency = formatLatency(calculateLinkLatency(latestRecord));
    const alertTime = getCurrentTime();
    notice.innerHTML = `
        <button type="button" class="toast-close" aria-label="关闭告警" title="关闭告警">
            <i class="fas fa-xmark"></i>
        </button>
        <span class="toast-icon"><i class="fas fa-circle-check"></i></span>
        <span class="toast-copy">
            <small><i class="fas fa-satellite-dish"></i> 数据链路更新</small>
            <strong>${name}</strong>
            <span class="toast-message">已接收 <b>${count}</b> 条新数据，链路状态已同步</span>
            <span class="toast-meta">
                <span><i class="far fa-clock"></i> 告警时间 <b>${alertTime}</b></span>
                <span><i class="fas fa-tower-broadcast"></i> 采集时间 <b>${collectedTime}</b></span>
                <span><i class="fas fa-gauge-high"></i> 链路时延 <b>${latency}</b></span>
            </span>
        </span>`;
    const closeButton = notice.querySelector('.toast-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            notice.classList.remove('show');
            if (state.noticeTimer) {
                clearTimeout(state.noticeTimer);
                state.noticeTimer = null;
            }
        }, { once: true });
    }
    notice.classList.add('show');
    if (state.noticeTimer) {
        clearTimeout(state.noticeTimer);
    }
    state.noticeTimer = setTimeout(() => {
        notice.classList.remove('show');
    }, 12000);
}

function initCharts() {
    const createConfig = (label, colorConfig) => ({
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label,
                data: [],
                borderColor: colorConfig.border,
                backgroundColor: colorConfig.bg,
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 26, 0.9)',
                    titleColor: '#00d4ff',
                    bodyColor: 'rgba(255, 255, 255, 0.8)',
                    borderColor: 'rgba(0, 212, 255, 0.3)',
                    borderWidth: 1,
                    displayColors: false
                }
            },
            scales: {
                x: { display: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { display: false } },
                y: { display: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: colorConfig.primary } }
            }
        }
    });

    const ctxTemp = document.getElementById('tempChart');
    const ctxHumidity = document.getElementById('humidityChart');
    const ctxPressure = document.getElementById('pressureChart');
    const ctxNoise = document.getElementById('noiseChart');

    if (ctxTemp) charts.temp = new Chart(ctxTemp.getContext('2d'), createConfig('Temperature (C)', COLORS.temperature));
    if (ctxHumidity) charts.humidity = new Chart(ctxHumidity.getContext('2d'), createConfig('Humidity (%RH)', COLORS.humidity));
    if (ctxPressure) charts.pressure = new Chart(ctxPressure.getContext('2d'), createConfig('Pressure (kPa)', COLORS.pressure));
    if (ctxNoise) charts.noise = new Chart(ctxNoise.getContext('2d'), createConfig('Noise (dB)', COLORS.noise));

    // Charts may initialize before scaled layout settles; re-fit once more.
    const syncChartLayout = () => resizeDashboardCharts();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(syncChartLayout);
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(syncChartLayout);
        });
    }
    setTimeout(syncChartLayout, 120);
}

function clearCharts() {
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update('none');
        }
    });
}

function updateChart(label, temperature, humidity, pressure, noise) {
    const updateSingleChart = (chart, value) => {
        if (!chart) return;
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);
        if (chart.data.labels.length > MAX_DATA_POINTS) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update('none');
    };

    updateSingleChart(charts.temp, temperature);
    updateSingleChart(charts.humidity, humidity);
    updateSingleChart(charts.pressure, pressure);
    updateSingleChart(charts.noise, noise);
}

function updateTrends(latest, previous) {
    if (!latest || !previous) return;
    const setTrend = (id, currentValue, previousValue) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('up', 'down', 'stable');
        if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
            el.classList.add('stable');
            el.innerHTML = '<i class="fas fa-minus"></i>';
            return;
        }
        const delta = currentValue - previousValue;
        if (delta > 0) {
            el.classList.add('up');
            el.innerHTML = '<i class="fas fa-arrow-up"></i>';
        } else if (delta < 0) {
            el.classList.add('down');
            el.innerHTML = '<i class="fas fa-arrow-down"></i>';
        } else {
            el.classList.add('stable');
            el.innerHTML = '<i class="fas fa-minus"></i>';
        }
    };

    setTrend('trendTemperature', latest.temperature, previous.temperature);
    setTrend('trendHumidity', latest.humidity, previous.humidity);
    setTrend('trendPressure', latest.pressure, previous.pressure);
    setTrend('trendNoise', latest.noise, previous.noise);
}

function isSameSample(a, b) {
    if (!a || !b) return false;
    if (a.id != null && b.id != null) return a.id === b.id;
    if (a.payload_time && b.payload_time) return a.payload_time === b.payload_time;
    if (a.msg_id && b.msg_id) return a.msg_id === b.msg_id;
    return false;
}

function formatMetricValue(value, digits) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toFixed(digits) : '--';
}

function formatRawValue(value) {
    return value == null || value === '' ? '--' : String(value);
}

function renderSensorMeta(data) {
    const sensorMeta = document.querySelector('.sensor-controls .sensor-meta');
    if (!sensorMeta) return;
    if (!data) {
        sensorMeta.innerHTML = '';
        return;
    }

    sensorMeta.innerHTML = `<span class="sensor-source-badge"><i class="fas fa-check-circle"></i> 数据链路已接入</span>`;
}

function updateLatestDataDisplay(data, previous) {
    if (!data) return;

    const lastRefresh = document.getElementById('lastRefresh');
    if (lastRefresh) {
        lastRefresh.textContent = getCurrentTime();
    }

    renderSensorMeta(data);

    const valueTemperature = document.getElementById('valueTemperature');
    const formattedTemperature = formatMetricValue(data.temperature, 2);
    if (valueTemperature) valueTemperature.textContent = formattedTemperature;
    const overviewTemperature = document.getElementById('overviewTemperature');
    if (overviewTemperature) overviewTemperature.textContent = formattedTemperature;

    const collectedTime = data.payload_time || data.source_time;
    const ingestedTime = data.recv_time || data.create_time;
    const latency = calculateLinkLatency(data);
    const latestRecordId = document.getElementById('latestRecordId');
    const latestCollectedTime = document.getElementById('latestCollectedTime');
    const latestIngestedTime = document.getElementById('latestIngestedTime');
    const latestLatency = document.getElementById('latestLatency');
    if (latestRecordId) latestRecordId.textContent = data.id != null ? `#${data.id}` : '--';
    if (latestCollectedTime) latestCollectedTime.textContent = formatDateTime(collectedTime);
    if (latestIngestedTime) latestIngestedTime.textContent = formatDateTime(ingestedTime);
    if (latestLatency) {
        latestLatency.textContent = formatLatency(latency);
        latestLatency.dataset.level = getLatencyLevel(latency);
    }
    const overviewLatency = document.getElementById('overviewLatency');
    if (overviewLatency) overviewLatency.textContent = formatLatency(latency);

    const prevData = previous || state.lastData;
    if (prevData && !isSameSample(data, prevData)) {
        updateTrends(data, prevData);
    }
    state.lastData = data;
}

function renderTemperatureTrend(rows) {
    const line = document.getElementById('temperatureTrendLine');
    const area = document.getElementById('temperatureTrendArea');
    const point = document.getElementById('temperatureTrendPoint');
    const minLabel = document.getElementById('trendMin');
    const maxLabel = document.getElementById('trendMax');
    const deltaLabel = document.getElementById('trendDelta');
    const sampleCount = document.getElementById('trendSampleCount');

    if (!line || !area || !point) return;

    const samples = [...(rows || [])]
        .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
        .map(row => Number(row.temperature))
        .filter(Number.isFinite)
        .slice(-24);

    if (sampleCount) sampleCount.textContent = String(samples.length);
    if (samples.length === 0) {
        line.setAttribute('d', '');
        area.setAttribute('d', '');
        point.setAttribute('r', '0');
        if (minLabel) minLabel.textContent = '--';
        if (maxLabel) maxLabel.textContent = '--';
        if (deltaLabel) {
            deltaLabel.textContent = '--';
            deltaLabel.className = 'trend-delta stable';
        }
        return;
    }

    const chartWidth = 320;
    const chartTop = 10;
    const chartBottom = 98;
    const rawMin = Math.min(...samples);
    const rawMax = Math.max(...samples);
    const visualPadding = Math.max((rawMax - rawMin) * 0.16, 0.3);
    const min = rawMin - visualPadding;
    const max = rawMax + visualPadding;
    const range = Math.max(max - min, 0.1);
    const xStep = samples.length > 1 ? chartWidth / (samples.length - 1) : chartWidth;
    const points = samples.map((value, index) => ({
        x: samples.length > 1 ? index * xStep : chartWidth / 2,
        y: chartBottom - ((value - min) / range) * (chartBottom - chartTop)
    }));

    const linePath = points.map((item, index) => `${index === 0 ? 'M' : 'L'} ${item.x.toFixed(2)} ${item.y.toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${chartBottom} L ${points[0].x.toFixed(2)} ${chartBottom} Z`;
    const lastPoint = points[points.length - 1];

    line.setAttribute('d', linePath);
    area.setAttribute('d', areaPath);
    point.setAttribute('cx', lastPoint.x.toFixed(2));
    point.setAttribute('cy', lastPoint.y.toFixed(2));
    point.setAttribute('r', '3');

    if (minLabel) minLabel.textContent = `${rawMin.toFixed(1)}°`;
    if (maxLabel) maxLabel.textContent = `${rawMax.toFixed(1)}°`;
    if (deltaLabel) {
        const delta = samples[samples.length - 1] - samples[0];
        const direction = delta > 0.005 ? 'positive' : delta < -0.005 ? 'negative' : 'stable';
        deltaLabel.className = `trend-delta ${direction}`;
        deltaLabel.textContent = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}℃`;
    }
}

function renderHistoryTable(rows) {
    const body = document.getElementById('historyTableBody');
    const count = document.getElementById('historyCount');
    const overviewCount = document.getElementById('overviewRecordCount');
    if (!body) return;

    const records = [...(rows || [])].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    if (count) count.textContent = String(records.length);
    if (overviewCount) overviewCount.textContent = String(records.length);
    renderTemperatureTrend(records);
    if (records.length === 0) {
        body.innerHTML = '<tr class="history-empty-row"><td colspan="5">当前接入点暂无历史数据</td></tr>';
        return;
    }

    body.innerHTML = records.map((row, index) => {
        const latency = calculateLinkLatency(row);
        const level = getLatencyLevel(latency);
        const recordId = row.id != null ? `#${row.id}` : String(index + 1).padStart(2, '0');
        return `
            <tr>
                <td><span class="history-record-id">${recordId}</span></td>
                <td><span class="history-temperature"><i class="fas fa-temperature-half"></i>${formatMetricValue(row.temperature, 2)}<small>℃</small></span></td>
                <td><span class="history-time"><i class="far fa-clock"></i>${formatDateTime(row.payload_time || row.source_time)}</span></td>
                <td><span class="history-time"><i class="fas fa-database"></i>${formatDateTime(row.recv_time || row.create_time)}</span></td>
                <td><span class="latency-badge ${level}"><i class="fas fa-signal"></i>${formatLatency(latency)}</span></td>
            </tr>`;
    }).join('');
}

async function fetchAccessPoints() {
    try {
        const response = await fetch(buildApiUrl('/api/access_points'));
        const result = await parseProject20AppJsonResponse(response, 'GET /api/access_points');
        if (result.success) {
            state.accessPoints = result.data || [];
            const overviewNodeCount = document.getElementById('overviewNodeCount');
            const mapNodeCount = document.getElementById('mapNodeCount');
            if (overviewNodeCount) overviewNodeCount.textContent = String(state.accessPoints.length);
            if (mapNodeCount) mapNodeCount.textContent = String(state.accessPoints.length);
            populateAccessPointSelector();
        }
    } catch (error) {
        console.error('Failed to load access points:', error);
    }
}

async function initAccessPointLastSeen() {
    if (!state.accessPoints || state.accessPoints.length === 0) {
        return;
    }
    const tasks = state.accessPoints.map(async (ap) => {
        try {
            const response = await fetch(buildApiUrl(`/api/latest?sn_code=${ap.sn_code}`));
            const result = await parseProject20AppJsonResponse(response, `GET /api/latest?sn_code=${ap.sn_code}`);
            if (result.success && result.data) {
                setLastSeenId(ap.sn_code, result.data.id || 0);
            } else {
                setLastSeenId(ap.sn_code, 0);
            }
        } catch (error) {
            console.error(`Failed to init latest for ${ap.sn_code}:`, error);
        }
    });
    await Promise.all(tasks);
}

function populateAccessPointSelector() {
    const select = document.getElementById('accessPointSelect');
    if (!select) return;
    select.innerHTML = '';

    state.accessPoints.forEach(ap => {
        const option = document.createElement('option');
        option.value = ap.sn_code;
        const locationText = ap.location ? ` (${ap.location})` : '';
        option.textContent = `${ap.name}${locationText}`;
        select.appendChild(option);
    });

    select.value = state.currentAccessPoint;
    if (select.selectedIndex < 0 && select.options.length > 0) {
        select.selectedIndex = 0;
        state.currentAccessPoint = select.options[0].value;
        state.lastSeenId = getLastSeenId(state.currentAccessPoint);
    }
    updateCurrentAccessPointCopy();
}

function updateCurrentAccessPointCopy() {
    const label = document.getElementById('currentAccessPointName');
    if (!label) return;
    const current = state.accessPoints.find(ap => ap.sn_code === state.currentAccessPoint);
    label.textContent = current?.name || state.currentAccessPoint || '等待节点数据';
    label.title = current?.location ? `${current.name} · ${current.location}` : label.textContent;
}

async function fetchLatestData() {
    try {
        const response = await fetch(buildApiUrl(`/api/latest?sn_code=${state.currentAccessPoint}`));
        const result = await parseProject20AppJsonResponse(response, `GET /api/latest?sn_code=${state.currentAccessPoint}`);
        if (result.success && result.data) {
            updateLatestDataDisplay(result.data, result.previous_data || state.lastData);
            setLastSeenId(state.currentAccessPoint, result.data.id || 0);
            setApiStatus(true);
        } else {
            setApiStatus(false);
        }
    } catch (error) {
        console.error('API request failed:', error);
        setApiStatus(false);
    }
}

async function fetchHistoryData() {
    try {
        const response = await fetch(buildApiUrl(`/api/chart?limit=${CONFIG.HISTORY_ROWS}&sn_code=${state.currentAccessPoint}`));
        const result = await parseProject20AppJsonResponse(response, `GET /api/chart?sn_code=${state.currentAccessPoint}`);
        if (result.success) {
            state.historyRows = result.data || [];
            renderHistoryTable(state.historyRows);
            state.historyRows.forEach(row => {
                setLastSeenId(state.currentAccessPoint, row.id || 0);
            });
        }
    } catch (error) {
        console.error('Failed to load history data:', error);
        renderHistoryTable([]);
    }
}

async function fetchIncrementalForAccessPoint(snCode, updateCharts) {
    try {
        const sinceId = getLastSeenId(snCode);
        const response = await fetch(buildApiUrl(`/api/incremental?since_id=${sinceId}&sn_code=${snCode}`));
        const result = await parseProject20AppJsonResponse(response, `GET /api/incremental?sn_code=${snCode}`);
        if (result.success) {
            const newData = result.data || [];
            if (newData.length > 0) {
                const latestNewRecord = newData.reduce((latest, row) =>
                    !latest || Number(row.id) > Number(latest.id) ? row : latest, null);
                showUpdateNotice(snCode, newData.length, latestNewRecord);
                if (updateCharts) {
                    await fetchHistoryData();
                }
                const maxId = Math.max(...newData.map(d => d.id));
                setLastSeenId(snCode, maxId);
            }
            if (updateCharts && result.latest) {
                updateLatestDataDisplay(result.latest, state.lastData);
            }
            if (updateCharts) {
                setApiStatus(true);
            }
        } else if (updateCharts) {
            setApiStatus(false);
        }
    } catch (error) {
        console.error('API request failed:', error);
        if (updateCharts) {
            setApiStatus(false);
        }
    }
}

async function fetchIncrementalData() {
    if (!state.accessPoints || state.accessPoints.length === 0) {
        return;
    }
    const currentSn = state.currentAccessPoint;
    const tasks = state.accessPoints.map(ap => fetchIncrementalForAccessPoint(ap.sn_code, ap.sn_code === currentSn));
    await Promise.all(tasks);
}

function switchAccessPoint(snCode) {
    state.currentAccessPoint = snCode;
    state.lastSeenId = getLastSeenId(snCode);
    state.lastData = null;
    state.countdown = 5;

    const select = document.getElementById('accessPointSelect');
    if (select) {
        select.value = snCode;
    }
    updateCurrentAccessPointCopy();

    state.historyRows = [];
    renderHistoryTable([]);
    fetchHistoryData();
    fetchLatestData();
}

async function initialLoad() {
    await fetchAccessPoints();
    await initAccessPointLastSeen();
    await Promise.all([
        fetchLatestData(),
        fetchHistoryData()
    ]);
}

function stopAutoRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }
    if (state.countdownTimer) {
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    if (!state.isPageActive) {
        return;
    }

    // 1s countdown tick
    state.countdownTimer = setInterval(() => {
        updateCountdown();
    }, 1000);

    // data refresh interval
    state.refreshTimer = setInterval(() => {
        fetchIncrementalData();
    }, CONFIG.REFRESH_INTERVAL);
}

function stopClock() {
    if (state.clockTimer) {
        clearInterval(state.clockTimer);
        state.clockTimer = null;
    }
}

function startClock() {
    stopClock();
    if (!state.isPageActive) {
        return;
    }
    updateClock();
    state.clockTimer = setInterval(updateClock, 1000);
}

function init() {
    if (state.isInitialized) {
        return;
    }
    state.isInitialized = true;

    startClock();
    initBackButton();

    if (typeof initMap === 'function') {
        initMap();
    }

    const accessPointSelect = document.getElementById('accessPointSelect');
    if (accessPointSelect) {
        accessPointSelect.addEventListener('change', (e) => {
            switchAccessPoint(e.target.value);
        });
    }

    initialLoad();
    startAutoRefresh();

    // 初始化响应式布局同步
    initPageScaling();
}

function handleControlPlatformVisibility(event) {
    const payload = event?.data;
    if (!payload || payload.type !== 'controlplatform:page-visibility') {
        return;
    }

    const nextActive = Boolean(payload.active);
    if (nextActive === state.isPageActive) {
        return;
    }

    state.isPageActive = nextActive;
    if (nextActive) {
        startClock();
        startAutoRefresh();
        updatePageScaling();
        if (typeof window.refreshMapLayout === 'function') {
            window.refreshMapLayout();
        }
        return;
    }

    stopClock();
    stopAutoRefresh();
}

/**
 * 响应式布局同步
 * 旧版本在 iframe 内按设计稿对整页做 transform: scale()，容易出现二次缩放和错位。
 * 这里改为清理遗留缩放，仅同步图表与地图尺寸，让页面按真实视口自适应。
 */
function clampResponsiveValue(min, value, max) {
    return Math.min(max, Math.max(min, value));
}

function applyResponsiveViewportState(container) {
    if (!document.body) {
        return 'default';
    }

    const viewportWidth = container?.clientWidth || document.documentElement.clientWidth || window.innerWidth || 0;
    const viewportHeight = container?.clientHeight || document.documentElement.clientHeight || window.innerHeight || 0;
    const viewportArea = viewportWidth * viewportHeight;
    const shortEdge = Math.min(viewportWidth || 0, viewportHeight || 0);

    let tier = 'default';
    if (viewportWidth <= 1320 || viewportHeight <= 780 || viewportArea <= 860000 || shortEdge <= 720) {
        tier = 'ultra';
    } else if (viewportWidth <= 1480 || viewportHeight <= 860 || viewportArea <= 1100000 || shortEdge <= 820) {
        tier = 'tight';
    } else if (viewportWidth <= 1660 || viewportHeight <= 960 || viewportArea <= 1420000 || shortEdge <= 920) {
        tier = 'compact';
    }

    const body = document.body;
    body.classList.add('responsive-dashboard');
    body.classList.toggle('viewport-compact', tier === 'compact' || tier === 'tight' || tier === 'ultra');
    body.classList.toggle('viewport-tight', tier === 'tight' || tier === 'ultra');
    body.classList.toggle('viewport-ultra', tier === 'ultra');
    body.dataset.viewportTier = tier;
    body.style.setProperty('--viewport-width', `${viewportWidth}px`);
    body.style.setProperty('--viewport-height', `${viewportHeight}px`);
    body.style.setProperty('--viewport-scale', clampResponsiveValue(0.84, Math.min(viewportWidth / 1680, viewportHeight / 980), 1).toFixed(4));

    return tier;
}

function applyResponsiveChartStyle(chart, tier) {
    if (!chart) {
        return;
    }

    const presets = {
        default: { tickSize: 11, pointRadius: 2, hoverRadius: 4, borderWidth: 2, tooltipBody: 11, tooltipTitle: 12, maxTicks: 6 },
        compact: { tickSize: 10, pointRadius: 1.8, hoverRadius: 3.6, borderWidth: 1.9, tooltipBody: 10, tooltipTitle: 11, maxTicks: 5 },
        tight: { tickSize: 9, pointRadius: 1.6, hoverRadius: 3.2, borderWidth: 1.7, tooltipBody: 9, tooltipTitle: 10, maxTicks: 5 },
        ultra: { tickSize: 8, pointRadius: 1.4, hoverRadius: 3, borderWidth: 1.6, tooltipBody: 8, tooltipTitle: 9, maxTicks: 4 }
    };
    const preset = presets[tier] || presets.default;

    const dataset = chart.data?.datasets?.[0];
    if (dataset) {
        dataset.pointRadius = preset.pointRadius;
        dataset.pointHoverRadius = preset.hoverRadius;
        dataset.borderWidth = preset.borderWidth;
    }

    const scales = chart.options?.scales || {};
    Object.values(scales).forEach((scale) => {
        if (!scale || !scale.ticks) {
            return;
        }
        scale.ticks.font = {
            ...(scale.ticks.font || {}),
            size: preset.tickSize
        };
        if (scale.ticks.display !== false) {
            scale.ticks.maxTicksLimit = preset.maxTicks;
        }
    });

    const tooltip = chart.options?.plugins?.tooltip;
    if (tooltip) {
        tooltip.bodyFont = { ...(tooltip.bodyFont || {}), size: preset.tooltipBody };
        tooltip.titleFont = { ...(tooltip.titleFont || {}), size: preset.tooltipTitle };
        tooltip.padding = preset.tickSize;
    }
}

function resizeDashboardCharts(tier = document.body?.dataset.viewportTier || 'default') {
    Object.values(charts).forEach(chart => {
        if (!chart || typeof chart.resize !== 'function') {
            return;
        }
        const parent = chart.canvas ? chart.canvas.parentElement : null;
        const targetWidth = parent ? parent.clientWidth : 0;
        const targetHeight = parent ? parent.clientHeight : 0;
        if (targetWidth <= 0 || targetHeight <= 0) {
            return;
        }
        applyResponsiveChartStyle(chart, tier);
        chart.resize();
        if (typeof chart.update === 'function') {
            chart.update('none');
        }
    });
}

function invalidateDashboardMap() {
    if (typeof window.invalidateDashboardMapSize === 'function') {
        window.invalidateDashboardMapSize();
    }
}

function clearLegacyPageScaling(container) {
    container.style.removeProperty('transform');
    container.style.removeProperty('transform-origin');
    container.style.removeProperty('width');
    container.style.removeProperty('height');
    container.style.removeProperty('max-width');
    container.style.removeProperty('max-height');
}

function updatePageScaling() {
    const container = document.querySelector('.container');
    if (container) {
        clearLegacyPageScaling(container);
    }
    const viewportTier = applyResponsiveViewportState(container);

    const syncResponsiveLayout = () => {
        resizeDashboardCharts(viewportTier);
        invalidateDashboardMap();
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
            syncResponsiveLayout();
            setTimeout(syncResponsiveLayout, 120);
        });
    } else {
        syncResponsiveLayout();
    }
}

function initPageScaling() {
    if (document.body) {
        document.body.classList.toggle('embedded-view', window.self !== window.top);
    }

    updatePageScaling();

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(updatePageScaling, 50);
    });

    const container = document.querySelector('.container');
    if (container && typeof ResizeObserver !== 'undefined') {
        let observerTimer;
        const resizeObserver = new ResizeObserver(() => {
            clearTimeout(observerTimer);
            observerTimer = setTimeout(updatePageScaling, 30);
        });
        resizeObserver.observe(container);
    }

    window.addEventListener('load', () => {
        setTimeout(updatePageScaling, 120);
    });
}

function resolveReturnTarget() {
    if (typeof window === 'undefined' || !window.location) {
        return '';
    }

    const params = new URLSearchParams(window.location.search);
    const explicitTarget = params.get('returnUrl') || params.get('from');
    if (explicitTarget) {
        return explicitTarget;
    }

    if (document.referrer) {
        try {
            const referrerUrl = new URL(document.referrer);
            if (referrerUrl.href !== window.location.href) {
                return referrerUrl.href;
            }
        } catch (error) {
            return document.referrer;
        }
    }

    return '';
}

function initBackButton() {
    const backButton = document.getElementById('pageBackButton');
    if (!backButton) {
        return;
    }

    const returnTarget = resolveReturnTarget();
    backButton.addEventListener('click', () => {
        if (window.opener && !window.opener.closed) {
            try {
                window.opener.focus();
                window.close();
                return;
            } catch (error) {
                console.warn('Failed to focus and close satellite detail window:', error);
            }
        }

        if (returnTarget) {
            window.location.href = returnTarget;
            return;
        }

        if (window.history.length > 1) {
            window.history.back();
        }
    });
}

window.addEventListener('message', handleControlPlatformVisibility);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
