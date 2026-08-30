/* Forest and ocean telemetry controller for the existing orbital dashboard. */

const DASHBOARD_REFRESH_SECONDS = 5;
const DASHBOARD_HISTORY_LIMIT = 12;
const INGEST_NOTICE_DURATION_MS = 10000;
const EMERGENCY_ALERT_STORAGE_KEY = 'leo-satellite-platform.emergency-workflows.v2';
const EMERGENCY_ALERT_HISTORY_LIMIT = 32;
const FIRE_WORKFLOW_CARD_CLASSES = Object.freeze([
    'is-normal',
    'is-alarm',
    'is-acknowledged',
    'is-cleared',
    'is-resolved',
    'has-long-status',
]);
const FIRE_WORKFLOW_PRESENTATIONS = Object.freeze({
    normal: {
        label: '当前火情',
        value: '未发现火情',
        overviewValue: '安全',
        verdict: '监测区域安全',
        verdictClass: 'is-online',
        cardClass: 'is-normal',
        icon: 'fa-shield-halved',
    },
    detected: {
        label: '火情告警',
        value: '发现火情',
        overviewValue: '告警',
        verdict: '告警 · 请核查',
        verdictClass: 'is-alarm',
        cardClass: 'is-alarm',
        icon: 'fa-fire-flame-curved',
    },
    acknowledged: {
        label: '火情处置',
        value: '火情处置中',
        overviewValue: '处置中',
        verdict: '已确认 · 处置中',
        verdictClass: 'is-acknowledged',
        cardClass: 'is-acknowledged',
        icon: 'fa-person-circle-check',
    },
    cleared: {
        label: '消除复核',
        value: '火情已消除',
        overviewValue: '已消除',
        verdict: '已消除 · 待关闭',
        verdictClass: 'is-cleared',
        cardClass: 'is-cleared',
        icon: 'fa-circle-check',
    },
    resolved: {
        label: '处置结果',
        value: '处置完成',
        overviewValue: '已关闭',
        verdict: '已关闭 · 持续监测',
        verdictClass: 'is-resolved',
        cardClass: 'is-resolved',
        icon: 'fa-check-double',
    },
});
// Production mode: only actual gateway1 F records may start a fire-alarm workflow.
// Keep the refresh-only demo disabled so a full page reload does not reopen a preview alert.
const EMERGENCY_ALERT_REFRESH_PREVIEW = false;

const SCENE_CONFIG = {
    gateway1: {
        id: 'gateway1',
        scene: 'forest',
        shortName: '溧水',
        tabName: '森林',
        title: '溧水森林防火',
        mapName: '溧水 · 森林防火',
        kicker: '森林火情 · 温湿度监测',
        payload: '火情 · 温湿度',
        metricLabel: '当前火情',
        metricUnit: '状态',
        metricColumn: '火情状态',
        historyTitle: '溧水森林 · 火情接入记录',
        trendKicker: '环境趋势',
        trendTitle: '森林温湿度历史',
        trendLegend: '温度 °C',
        secondaryTrendLegend: '湿度 %RH',
        icon: 'fa-tree',
        metricIcon: 'fa-fire-flame-curved',
        color: '#61d7ac',
        temperatureColor: '#f0a45d',
        humidityColor: '#54d2ed',
    },
    gateway2: {
        id: 'gateway2',
        scene: 'ocean',
        shortName: '海南',
        tabName: '远洋',
        title: '海南远洋远域',
        mapName: '海南 · 海口',
        kicker: '远洋风速监测',
        payload: '风速载荷',
        metricLabel: '当前风速',
        metricUnit: 'm/s',
        metricColumn: '风速',
        historyTitle: '海南远洋 · 风速接入记录',
        trendKicker: '风速趋势',
        trendTitle: '远洋风速历史',
        trendLegend: '风速 m/s',
        icon: 'fa-water',
        metricIcon: 'fa-wind',
        color: '#54d2ed',
    },
};

const state = {
    currentAccessPoint: 'gateway1',
    accessPoints: [],
    historyRows: [],
    environmentRows: [],
    latestSceneRecord: null,
    linkStatus: null,
    refreshCountdown: DASHBOARD_REFRESH_SECONDS,
    requestSequence: 0,
    emergencyIncidents: new Map(),
    emergencyAlertReturnFocus: null,
    emergencyDockPosition: null,
    emergencyDockDrag: null,
    emergencyDockSuppressClickUntil: 0,
    ingestNoticeTimer: null,
    ingestNoticeRecordKeys: new Map(),
    initializedIngestStreams: new Set(),
    timers: [],
    telemetryResizeObserver: null,
};

const dashboardElement = (id) => document.getElementById(id);

function setDashboardText(id, value, fallback = '--') {
    const element = dashboardElement(id);
    if (element) element.textContent = value == null || value === '' ? fallback : String(value);
}

function dashboardApiBase() {
    return String(window.__PROJECT20_API_BASE__ || window.__API_BASE__ || '').replace(/\/$/, '');
}

function dashboardApiUrl(path) {
    return `${dashboardApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchDashboardJson(path) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6500);
    try {
        const response = await fetch(dashboardApiUrl(path), {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        window.clearTimeout(timeout);
    }
}

function escapeDashboardHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function dashboardFrameNumber(record) {
    if (!record) return '--';
    const sequence = String(record.sequence ?? '').trim().replace(/^#+/, '');
    if (sequence) return sequence;
    const fallback = record.source_record_id ?? record.id;
    return fallback == null || fallback === ''
        ? '--'
        : String(fallback).trim().replace(/^#+/, '');
}

function dashboardRecordNumber(record) {
    const frameNumber = dashboardFrameNumber(record);
    if (/^\d{17,}$/.test(frameNumber)) return frameNumber.slice(-3);
    return frameNumber;
}

function parseDashboardDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    const compact = text.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    const normalized = compact
        ? `20${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}`
        : (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text);
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function dashboardTime(value, includeDate = false) {
    const date = parseDashboardDate(value);
    if (!date) return '--';
    const formatter = new Intl.DateTimeFormat('zh-CN', {
        ...(includeDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(date)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    );
    const time = `${parts.hour}:${parts.minute}:${parts.second}`;
    return includeDate ? `${parts.year}-${parts.month}-${parts.day} ${time}` : time;
}

function dashboardLatencyMs(record) {
    const collected = parseDashboardDate(record?.payload_time || record?.source_time);
    const received = parseDashboardDate(record?.recv_time || record?.create_time);
    if (!collected || !received) return null;
    // Keep the sign: a negative value means the receiving clock precedes the
    // sensor clock and must never be presented as ordinary transmission delay.
    return received.getTime() - collected.getTime();
}

function formatDashboardDuration(milliseconds) {
    const duration = Math.abs(milliseconds);
    if (duration < 1000) return `${Math.round(duration)} ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(duration < 10000 ? 2 : 1)} s`;
    return `${(duration / 60000).toFixed(1)} min`;
}

function formatDashboardLatency(milliseconds) {
    if (milliseconds == null || !Number.isFinite(milliseconds)) return '--';
    return milliseconds < 0
        ? `偏差 ${formatDashboardDuration(milliseconds)}`
        : formatDashboardDuration(milliseconds);
}

function dashboardLatencyLevel(milliseconds) {
    if (milliseconds == null || !Number.isFinite(milliseconds)) return 'unknown';
    if (milliseconds < 0) return 'skew';
    if (milliseconds < 1500) return 'good';
    if (milliseconds < 5000) return 'medium';
    return 'high';
}

function currentScene() {
    return SCENE_CONFIG[state.currentAccessPoint] || SCENE_CONFIG.gateway1;
}

function updateDashboardClock() {
    const now = new Date();
    const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        dateTimeFormatter.formatToParts(now)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    );
    setDashboardText('currentTime', `${parts.hour}:${parts.minute}:${parts.second}`);
    setDashboardText('currentDate', `${parts.year}-${parts.month}-${parts.day}`);
}

function setDashboardApiStatus(online) {
    const status = dashboardElement('apiStatus');
    if (!status) return;
    status.textContent = online ? '正常' : '重连中';
    status.className = online ? 'online' : 'offline';
}

function updateSceneStaticUi(scene) {
    const isForest = scene.scene === 'forest';
    const telemetry = dashboardElement('sceneTelemetry');
    if (telemetry) telemetry.dataset.scene = scene.scene;
    document.body.dataset.currentScene = scene.scene;

    document.querySelectorAll('.scene-switch').forEach((button) => {
        const active = button.dataset.gateway === scene.id;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
        button.setAttribute('tabindex', active ? '0' : '-1');
    });
    const scenePanel = dashboardElement('sceneDataPanel');
    const activeTab = document.querySelector(`.scene-switch[data-gateway="${scene.id}"]`);
    if (scenePanel && activeTab?.id) scenePanel.setAttribute('aria-labelledby', activeTab.id);

    const contextIcon = dashboardElement('sceneContextIcon');
    if (contextIcon) contextIcon.innerHTML = `<i class="fas ${scene.icon}" aria-hidden="true"></i>`;
    const metricIcon = dashboardElement('primaryMetricIcon');
    if (metricIcon) {
        metricIcon.className = `fas ${scene.metricIcon}`;
        metricIcon.setAttribute('aria-hidden', 'true');
    }
    const overviewIcon = dashboardElement('overviewMetricIcon');
    if (overviewIcon) overviewIcon.innerHTML = `<i class="fas ${scene.metricIcon}" aria-hidden="true"></i>`;

    setDashboardText('sceneContextKicker', scene.kicker);
    setDashboardText('sceneContextTitle', scene.title);
    setDashboardText('scenePayload', scene.payload);
    setDashboardText('primaryMetricLabel', scene.metricLabel);
    setDashboardText('primaryMetricUnit', scene.metricUnit);
    setDashboardText('overviewMetricLabel', scene.metricLabel);
    setDashboardText('overviewMetricUnit', scene.metricUnit);
    setDashboardText('overviewSceneName', `${scene.shortName}${scene.tabName}`);
    setDashboardText('historyPanelTitle', isForest ? '溧水森林 · 监测数据记录' : scene.historyTitle);
    setDashboardText('historyMetricColumn', scene.metricColumn);
    setDashboardText('primaryHistoryTitle', scene.scene === 'ocean' ? '风速记录' : '火情记录');
    setDashboardText('sceneTrendKicker', scene.trendKicker);
    setDashboardText('sceneTrendTitle', scene.trendTitle);
    setDashboardText('trendLegend', scene.trendLegend);
    setDashboardText('trendSecondaryLegendText', scene.secondaryTrendLegend);
    setDashboardText('currentAccessPointName', scene.mapName);
    setDashboardText('latestCollectedLabel', '采集时间');
    setDashboardText('latestReceivedLabel', '入库时间');
    setDashboardText('latestLatencyLabel', '链路时差');

    const forestEnvironment = dashboardElement('forestEnvironment');
    if (forestEnvironment) forestEnvironment.hidden = !isForest;
    const environmentHistoryPanel = dashboardElement('environmentHistoryPanel');
    if (environmentHistoryPanel) environmentHistoryPanel.hidden = !isForest;
    const primaryHistoryIcon = dashboardElement('primaryHistoryIcon');
    if (primaryHistoryIcon) {
        primaryHistoryIcon.className = `fas ${scene.scene === 'ocean' ? 'fa-wind' : 'fa-fire-flame-curved'}`;
        primaryHistoryIcon.setAttribute('aria-hidden', 'true');
    }

    const gradientStart = dashboardElement('sceneTrendGradientStart');
    if (gradientStart) gradientStart.setAttribute('stop-color', scene.color);
}

function renderSceneWaiting(message = '等待遥测') {
    setDashboardText('primaryMetricValue', '--');
    setDashboardText('overviewMetricValue', '--');
    setDashboardText('latestRecordId', '--');
    setDashboardText('latestCollectedTime', '--');
    setDashboardText('latestReceivedTime', '--');
    setDashboardText('latestLatency', '--');
    setDashboardText('forestTemperature', '--');
    setDashboardText('forestHumidity', '--');
    setDashboardText('forestCollectedTime', '--');
    setDashboardText('forestUpdatedTime', '--');
    const verdict = dashboardElement('sceneVerdict');
    if (verdict) {
        verdict.className = 'scene-verdict';
        verdict.innerHTML = `<i aria-hidden="true"></i>${escapeDashboardHtml(message)}`;
    }
    const metricCard = dashboardElement('sceneMetricCard');
    if (metricCard) {
        metricCard.classList.remove(...FIRE_WORKFLOW_CARD_CLASSES);
        delete metricCard.dataset.workflowStatus;
        metricCard.setAttribute('aria-label', '主要遥测状态：等待遥测');
    }
    updateEmergencyAlert(null, currentScene());
}

function dashboardNumericValue(value) {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function ingestRecordIdentity(record, streamKey) {
    if (!record) return null;
    const persistentId = record.message_id
        ?? record.msg_id
        ?? record.source_record_id
        ?? record.id;
    if (persistentId != null && persistentId !== '') {
        return `${streamKey}:${persistentId}`;
    }
    return [
        streamKey,
        record.recv_time ?? record.create_time ?? '',
        record.payload_time ?? record.source_time ?? '',
        record.temperature ?? '',
        record.humidity ?? '',
        record.wind_speed ?? record.sensor_value ?? '',
    ].join(':');
}

function hideIngestNotice() {
    const notice = dashboardElement('sensorIngestNotice');
    if (notice) notice.classList.remove('show');
    if (state.ingestNoticeTimer) {
        window.clearTimeout(state.ingestNoticeTimer);
        state.ingestNoticeTimer = null;
    }
}

function ensureIngestNotice() {
    let notice = dashboardElement('sensorIngestNotice');
    if (notice) return notice;
    notice = document.createElement('aside');
    notice.id = 'sensorIngestNotice';
    notice.className = 'sensor-update-toast is-ingest';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-atomic', 'true');
    document.body.appendChild(notice);
    return notice;
}

function keepIngestNoticeClearOfEmergencyDock(notice = dashboardElement('sensorIngestNotice')) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const emergency = dashboardElement('emergencyFireAlert');
        if (!notice?.classList.contains('show')
            || !emergency?.classList.contains('show')
            || !emergencyAlertIsMinimized(emergency)) return;

        const noticeStyle = window.getComputedStyle(notice);
        const noticeTop = Number.parseFloat(noticeStyle.top) || notice.getBoundingClientRect().top;
        const noticeRight = Number.parseFloat(noticeStyle.right) || 0;
        const noticeWidth = notice.offsetWidth;
        const noticeHeight = notice.offsetHeight;
        const noticeRect = {
            top: noticeTop,
            right: window.innerWidth - noticeRight,
            bottom: noticeTop + noticeHeight,
            left: window.innerWidth - noticeRight - noticeWidth,
        };
        const emergencyRect = emergency.getBoundingClientRect();
        const gap = 10;
        const overlaps = emergencyRect.left < noticeRect.right + gap
            && emergencyRect.right + gap > noticeRect.left
            && emergencyRect.top < noticeRect.bottom + gap
            && emergencyRect.bottom + gap > noticeRect.top;
        if (!overlaps) return;

        const bounds = emergencyDockBounds(emergency);
        const leftOfNotice = noticeRect.left - emergency.offsetWidth - gap;
        if (leftOfNotice >= bounds.edgeGap) {
            applyEmergencyDockPosition(emergency, { left: leftOfNotice, top: emergencyRect.top });
        } else {
            applyEmergencyDockPosition(emergency, { left: emergencyRect.left, top: noticeRect.bottom + gap });
        }
    }));
}

function showIngestNotice(record, kind, scene) {
    const notice = ensureIngestNotice();
    const isEnvironment = kind === 'environment';
    const temperature = dashboardNumericValue(record?.temperature);
    const humidity = dashboardNumericValue(record?.humidity);
    const windSpeed = dashboardNumericValue(record?.wind_speed ?? record?.sensor_value);
    const title = isEnvironment ? '温湿度数据已入库' : '风速数据已入库';
    const icon = isEnvironment ? 'fa-temperature-half' : 'fa-wind';
    const measurement = isEnvironment
        ? `<b>${temperature == null ? '--' : temperature.toFixed(1)} °C</b><i aria-hidden="true">·</i><b>${humidity == null ? '--' : humidity.toFixed(1)} %RH</b>`
        : `<b>${windSpeed == null ? '--' : windSpeed.toFixed(1)} m/s</b>`;
    const collectedTime = dashboardTime(record?.payload_time || record?.source_time, true);
    const receivedTime = dashboardTime(record?.recv_time || record?.create_time, true);

    notice.className = `sensor-update-toast is-ingest ${isEnvironment ? 'is-environment' : 'is-wind'}`;
    notice.innerHTML = `
        <button type="button" class="toast-close" aria-label="关闭入库提示" title="关闭提示">
            <i class="fas fa-xmark" aria-hidden="true"></i>
        </button>
        <span class="toast-icon" aria-hidden="true"><i class="fas ${icon}"></i></span>
        <span class="toast-copy">
            <small><i class="fas fa-database" aria-hidden="true"></i> 实时数据入库</small>
            <strong>${title}</strong>
            <span class="toast-message">${measurement}</span>
            <span class="toast-meta">
                <span><i class="fas fa-location-dot" aria-hidden="true"></i> 监测场景 <b>${escapeDashboardHtml(scene?.title || '当前场景')}</b></span>
                <span><i class="fas fa-tower-broadcast" aria-hidden="true"></i> 采集时间 <b>${escapeDashboardHtml(collectedTime)}</b></span>
                <span><i class="fas fa-database" aria-hidden="true"></i> 入库时间 <b>${escapeDashboardHtml(receivedTime)}</b></span>
            </span>
        </span>
        <span class="ingest-toast-progress" aria-hidden="true"></span>`;
    notice.querySelector('.toast-close')?.addEventListener('click', hideIngestNotice, { once: true });

    // Restart both the entrance transition and the ten-second progress indicator.
    notice.classList.remove('show');
    void notice.offsetWidth;
    notice.classList.add('show');
    keepIngestNoticeClearOfEmergencyDock(notice);
    if (state.ingestNoticeTimer) window.clearTimeout(state.ingestNoticeTimer);
    state.ingestNoticeTimer = window.setTimeout(hideIngestNotice, INGEST_NOTICE_DURATION_MS);
}

function observeIngestRecord(record, kind, scene) {
    const streamKey = `${scene?.id || state.currentAccessPoint}:${kind}`;
    const identity = ingestRecordIdentity(record, streamKey);
    if (!state.initializedIngestStreams.has(streamKey)) {
        state.initializedIngestStreams.add(streamKey);
        if (identity) state.ingestNoticeRecordKeys.set(streamKey, identity);
        return;
    }
    if (!identity) return;
    const previousIdentity = state.ingestNoticeRecordKeys.get(streamKey);
    state.ingestNoticeRecordKeys.set(streamKey, identity);
    if (previousIdentity !== identity) showIngestNotice(record, kind, scene);
}

function renderForestEnvironment(record) {
    const scene = currentScene();
    const environment = dashboardElement('forestEnvironment');
    if (environment) environment.hidden = scene.scene !== 'forest';
    if (scene.scene !== 'forest') return;
    const temperature = dashboardNumericValue(record?.temperature);
    const humidity = dashboardNumericValue(record?.humidity);
    setDashboardText('forestTemperature', temperature == null ? '--' : temperature.toFixed(1));
    setDashboardText('forestHumidity', humidity == null ? '--' : humidity.toFixed(0));
    setDashboardText('forestCollectedTime', dashboardTime(record?.payload_time || record?.source_time));
    setDashboardText('forestUpdatedTime', dashboardTime(record?.recv_time || record?.create_time));
}

function emergencyAlertKey(record, gateway = state.currentAccessPoint) {
    if (!record) return '';
    return [
        gateway,
        record.sequence || record.source_record_id || record.id || '',
        record.payload_time || record.source_time || '',
    ].join(':');
}

function normalizeEmergencyIncident(value) {
    if (!value || typeof value !== 'object' || typeof value.key !== 'string' || !value.key) return null;
    const allowedStatuses = new Set(['detected', 'acknowledged', 'cleared', 'resolved']);
    const status = allowedStatuses.has(value.status) ? value.status : 'detected';
    return {
        key: value.key,
        gateway: typeof value.gateway === 'string' && value.gateway ? value.gateway : 'gateway1',
        status,
        detectedAt: value.detectedAt || null,
        acknowledgedAt: value.acknowledgedAt || null,
        clearedAt: value.clearedAt || null,
        clearCandidateAt: value.clearCandidateAt || null,
        resolvedAt: value.resolvedAt || null,
        updatedAt: value.updatedAt || value.resolvedAt || value.clearedAt || value.acknowledgedAt || value.detectedAt || null,
        record: value.record && typeof value.record === 'object' ? value.record : {},
        clearRecord: value.clearRecord && typeof value.clearRecord === 'object' ? value.clearRecord : null,
    };
}

function loadEmergencyIncidents() {
    try {
        const storedValue = window.localStorage.getItem(EMERGENCY_ALERT_STORAGE_KEY);
        if (!storedValue) return new Map();
        const parsedValue = JSON.parse(storedValue);
        const values = Array.isArray(parsedValue?.incidents) ? parsedValue.incidents : [];
        const incidents = values
            .map(normalizeEmergencyIncident)
            .filter(Boolean)
            .slice(-EMERGENCY_ALERT_HISTORY_LIMIT);
        return new Map(incidents.map((incident) => [incident.key, incident]));
    } catch (_error) {
        try {
            window.localStorage.removeItem(EMERGENCY_ALERT_STORAGE_KEY);
        } catch (_storageError) {
            // Ignore unavailable storage and continue with an empty workflow.
        }
        return new Map();
    }
}

function saveEmergencyIncidents() {
    const orderedIncidents = Array.from(state.emergencyIncidents.values())
        .sort((left, right) => String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')));
    const activeIncidents = orderedIncidents.filter((incident) => incident.status !== 'resolved');
    const resolvedIncidents = orderedIncidents.filter((incident) => incident.status === 'resolved');
    const resolvedLimit = Math.max(0, EMERGENCY_ALERT_HISTORY_LIMIT - activeIncidents.length);
    const incidents = [
        ...resolvedIncidents.slice(-resolvedLimit),
        ...activeIncidents,
    ].slice(-EMERGENCY_ALERT_HISTORY_LIMIT);
    state.emergencyIncidents = new Map(incidents.map((incident) => [incident.key, incident]));
    try {
        window.localStorage.setItem(EMERGENCY_ALERT_STORAGE_KEY, JSON.stringify({ version: 2, incidents }));
    } catch (_error) {
        // The in-memory workflow remains usable when browser storage is unavailable.
    }
}

function resetEmergencyRefreshPreview() {
    state.emergencyIncidents = new Map();
    try {
        window.localStorage.removeItem(EMERGENCY_ALERT_STORAGE_KEY);
    } catch (_error) {
        // The in-memory reset is sufficient when browser storage is unavailable.
    }
}

async function showEmergencyRefreshPreview() {
    if (!EMERGENCY_ALERT_REFRESH_PREVIEW) return;
    let latestRecord = state.currentAccessPoint === 'gateway1'
        ? state.latestSceneRecord
        : null;
    if (!latestRecord) {
        try {
            const forestResult = await fetchDashboardJson('/api/latest?sn_code=gateway1');
            latestRecord = forestResult?.success ? forestResult.data : null;
        } catch (error) {
            console.warn('火情预览帧读取失败:', error);
        }
    }
    if (latestRecord) {
        // Reuse the actual latest frame identity and timestamps. This preserves
        // the refresh-only preview while preventing the same backend frame from
        // opening a second, contradictory incident on the next polling cycle.
        updateEmergencyAlert({ ...latestRecord, fire_detected: true }, SCENE_CONFIG.gateway1);
        refreshCurrentFireWorkflowCard();
        return;
    }
    const receivedAt = new Date();
    const collectedAt = new Date(receivedAt.getTime() - 1000);
    const latestRecordNumber = dashboardElement('latestRecordId')?.textContent
        .trim()
        .replace(/^#/, '');
    updateEmergencyAlert({
        sequence: latestRecordNumber && latestRecordNumber !== '--'
            ? latestRecordNumber
            : String(receivedAt.getTime()).slice(-3),
        payload_time: collectedAt.toISOString(),
        recv_time: receivedAt.toISOString(),
        fire_detected: true,
    }, SCENE_CONFIG.gateway1);
    refreshCurrentFireWorkflowCard();
}

function storeEmergencyIncident(incident) {
    if (!incident?.key) return;
    state.emergencyIncidents.delete(incident.key);
    state.emergencyIncidents.set(incident.key, incident);
    saveEmergencyIncidents();
}

function emergencyRecordSnapshot(record) {
    return {
        sequence: record?.sequence ?? null,
        source_record_id: record?.source_record_id ?? null,
        id: record?.id ?? null,
        payload_time: record?.payload_time ?? null,
        source_time: record?.source_time ?? null,
        recv_time: record?.recv_time ?? null,
        create_time: record?.create_time ?? null,
        fire_detected: record?.fire_detected === true || record?.fire_detected === 1,
    };
}

function createEmergencyIncident(record, key, gateway = state.currentAccessPoint) {
    const now = new Date().toISOString();
    const incident = {
        key,
        gateway,
        status: 'detected',
        detectedAt: now,
        acknowledgedAt: null,
        clearedAt: null,
        clearCandidateAt: null,
        resolvedAt: null,
        updatedAt: now,
        record: emergencyRecordSnapshot(record),
    };
    storeEmergencyIncident(incident);
    return incident;
}

function activeEmergencyIncident(gateway = state.currentAccessPoint) {
    return Array.from(state.emergencyIncidents.values())
        .filter((incident) => incident.gateway === gateway && incident.status !== 'resolved')
        .at(-1) || null;
}

function emergencyRecordIdentity(record) {
    return String(
        record?.sequence
        ?? record?.source_record_id
        ?? record?.id
        ?? '',
    );
}

function emergencyRecordsMatch(leftRecord, rightRecord) {
    if (!leftRecord || !rightRecord) return false;
    const leftIdentity = emergencyRecordIdentity(leftRecord);
    const rightIdentity = emergencyRecordIdentity(rightRecord);
    if (leftIdentity && rightIdentity) return leftIdentity === rightIdentity;
    const leftTimestamp = emergencyRecordTimestamp(leftRecord);
    const rightTimestamp = emergencyRecordTimestamp(rightRecord);
    return leftTimestamp != null && rightTimestamp != null && leftTimestamp === rightTimestamp;
}

function emergencyIncidentForDisplay(record, gateway = state.currentAccessPoint) {
    const gatewayIncidents = Array.from(state.emergencyIncidents.values())
        .filter((incident) => incident.gateway === gateway);
    if (record) {
        const exactIncident = state.emergencyIncidents.get(emergencyAlertKey(record, gateway));
        if (exactIncident?.gateway === gateway) return exactIncident;
    }

    const activeIncident = gatewayIncidents
        .filter((incident) => incident.status !== 'resolved')
        .at(-1);
    if (activeIncident) return activeIncident;
    if (!record) return null;

    return gatewayIncidents
        .filter((incident) => incident.status === 'resolved')
        .findLast((incident) => emergencyRecordsMatch(record, incident.record)
            || emergencyRecordsMatch(record, incident.clearRecord)) || null;
}

function renderFireWorkflowCard(record, incident = null) {
    const fireDetected = record?.fire_detected === true || record?.fire_detected === 1;
    const workflowStatus = incident?.status || (fireDetected ? 'detected' : 'normal');
    const presentation = FIRE_WORKFLOW_PRESENTATIONS[workflowStatus] || FIRE_WORKFLOW_PRESENTATIONS.normal;
    const metricCard = dashboardElement('sceneMetricCard');
    const verdict = dashboardElement('sceneVerdict');
    const metricIcon = dashboardElement('primaryMetricIcon');

    setDashboardText('primaryMetricLabel', presentation.label);
    setDashboardText('primaryMetricValue', presentation.value);
    setDashboardText('overviewMetricValue', presentation.overviewValue);
    if (metricIcon) {
        metricIcon.className = `fas ${presentation.icon}`;
        metricIcon.setAttribute('aria-hidden', 'true');
    }
    if (metricCard) {
        metricCard.classList.remove(...FIRE_WORKFLOW_CARD_CLASSES);
        metricCard.classList.add(presentation.cardClass);
        metricCard.classList.toggle('has-long-status', presentation.value.length > 4);
        metricCard.dataset.workflowStatus = workflowStatus;
        metricCard.setAttribute(
            'aria-label',
            `${presentation.label}：${presentation.value}。${presentation.verdict}`,
        );
    }
    if (verdict) {
        verdict.className = `scene-verdict ${presentation.verdictClass}`;
        verdict.innerHTML = `<i aria-hidden="true"></i>${escapeDashboardHtml(presentation.verdict)}`;
    }
}

function refreshCurrentFireWorkflowCard() {
    const scene = currentScene();
    if (scene.scene !== 'forest') return;
    renderFireWorkflowCard(
        state.latestSceneRecord,
        emergencyIncidentForDisplay(state.latestSceneRecord, scene.id),
    );
}

function emergencyRecordTimestamp(record) {
    const rawValue = record?.payload_time || record?.source_time || record?.recv_time || record?.create_time || '';
    const normalizedValue = String(rawValue).includes('T')
        ? String(rawValue)
        : String(rawValue).replace(' ', 'T');
    const timestamp = Date.parse(normalizedValue);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function isNewerEmergencyRecord(record, incident) {
    const alarmRecord = incident?.record || {};
    const currentTimestamp = emergencyRecordTimestamp(record);
    const alarmTimestamp = emergencyRecordTimestamp(alarmRecord);
    if (currentTimestamp != null && alarmTimestamp != null) return currentTimestamp > alarmTimestamp;
    const currentIdentity = emergencyRecordIdentity(record);
    const alarmIdentity = emergencyRecordIdentity(alarmRecord);
    return Boolean(currentIdentity && alarmIdentity && currentIdentity !== alarmIdentity);
}

function markEmergencyIncidentCleared(incident, record) {
    if (!incident || incident.status === 'cleared' || incident.status === 'resolved') return incident;
    const now = new Date().toISOString();
    const clearedIncident = {
        ...incident,
        status: 'cleared',
        clearedAt: now,
        clearCandidateAt: incident.clearCandidateAt || now,
        updatedAt: now,
        clearRecord: emergencyRecordSnapshot(record),
    };
    storeEmergencyIncident(clearedIncident);
    return clearedIncident;
}

function rememberEmergencyClearCandidate(incident, record) {
    if (!incident || incident.status !== 'detected') return incident;
    if (incident.clearRecord && !isNewerEmergencyRecord(record, { record: incident.clearRecord })) return incident;
    const now = new Date().toISOString();
    const updatedIncident = {
        ...incident,
        clearCandidateAt: now,
        updatedAt: now,
        clearRecord: emergencyRecordSnapshot(record),
    };
    storeEmergencyIncident(updatedIncident);
    return updatedIncident;
}

function setEmergencyBackgroundInert(isInert) {
    const shell = document.querySelector('.command-shell');
    if (!shell) return;
    if (isInert) {
        shell.setAttribute('inert', '');
    } else {
        shell.removeAttribute('inert');
    }
}

function emergencyAlertFocusableElements(panel) {
    return Array.from(panel.querySelectorAll('button:not([disabled])'))
        .filter((element) => !element.hidden
            && !element.closest('[aria-hidden="true"]')
            && element.getClientRects().length > 0);
}

function emergencyAlertIsMinimized(panel) {
    return Boolean(panel?.classList.contains('is-minimized'));
}

function emergencyDockBounds(panel) {
    const edgeGap = window.innerWidth <= 430 ? 8 : 10;
    const header = document.querySelector('.command-header');
    const headerBottom = header?.getBoundingClientRect().bottom || 0;
    const safeTop = Math.max(edgeGap, Math.ceil(headerBottom) + edgeGap);
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const panelWidth = panel.offsetWidth || panel.getBoundingClientRect().width;
    const panelHeight = panel.offsetHeight || panel.getBoundingClientRect().height;
    const maxLeft = Math.max(edgeGap, viewportWidth - panelWidth - edgeGap);
    const availableBottom = Math.max(edgeGap, viewportHeight - panelHeight - edgeGap);
    const minTop = Math.min(safeTop, availableBottom);
    return { edgeGap, minTop, maxLeft, maxTop: Math.max(minTop, availableBottom) };
}

function applyEmergencyDockPosition(panel, position) {
    if (!panel || !emergencyAlertIsMinimized(panel) || !position) return;
    const bounds = emergencyDockBounds(panel);
    const left = Math.min(bounds.maxLeft, Math.max(bounds.edgeGap, Number(position.left) || 0));
    const top = Math.min(bounds.maxTop, Math.max(bounds.minTop, Number(position.top) || 0));
    state.emergencyDockPosition = { left, top };
    panel.style.left = `${Math.round(left)}px`;
    panel.style.right = 'auto';
    panel.style.top = `${Math.round(top)}px`;
    panel.style.removeProperty('--emergency-dock-top');
}

function clearEmergencyDockInlinePosition(panel) {
    if (!panel) return;
    panel.style.removeProperty('left');
    panel.style.removeProperty('right');
    panel.style.removeProperty('top');
}

function syncEmergencyDockPosition(panel = dashboardElement('emergencyFireAlert')) {
    if (!panel || !emergencyAlertIsMinimized(panel)) return;
    if (state.emergencyDockPosition) {
        applyEmergencyDockPosition(panel, state.emergencyDockPosition);
        return;
    }
    clearEmergencyDockInlinePosition(panel);
    const header = document.querySelector('.command-header');
    const edgeGap = window.innerWidth <= 430 ? 8 : 10;
    const headerBottom = header?.getBoundingClientRect().bottom || 0;
    const safeTop = Math.max(edgeGap, Math.ceil(headerBottom) + edgeGap);
    panel.style.setProperty('--emergency-dock-top', `${safeTop}px`);
}

function resetEmergencyDockPosition(panel = dashboardElement('emergencyFireAlert')) {
    state.emergencyDockPosition = null;
    clearEmergencyDockInlinePosition(panel);
    syncEmergencyDockPosition(panel);
}

function handleEmergencyDockPointerDown(event) {
    const panel = event.currentTarget;
    const dock = event.target.closest('.emergency-alert-dock');
    if (!dock || !panel.contains(dock) || !emergencyAlertIsMinimized(panel)) return;
    if (event.target.closest('.emergency-alert-restore')) return;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;

    panel.classList.add('is-dragging');
    const rect = panel.getBoundingClientRect();
    state.emergencyDockDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        moved: false,
        resetOnTap: Boolean(event.target.closest('[data-emergency-drag-handle]')),
    };
    applyEmergencyDockPosition(panel, { left: rect.left, top: rect.top });
    panel.setPointerCapture?.(event.pointerId);
}

function handleEmergencyDockPointerMove(event) {
    const panel = event.currentTarget;
    const drag = state.emergencyDockDrag;
    if (!drag || drag.pointerId !== event.pointerId || !emergencyAlertIsMinimized(panel)) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) >= 4) drag.moved = true;
    applyEmergencyDockPosition(panel, {
        left: drag.originLeft + deltaX,
        top: drag.originTop + deltaY,
    });
    event.preventDefault();
}

function finishEmergencyDockDrag(event) {
    const panel = event.currentTarget;
    const drag = state.emergencyDockDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.emergencyDockDrag = null;
    panel.classList.remove('is-dragging');
    if (drag.moved) {
        state.emergencyDockSuppressClickUntil = performance.now() + 300;
    } else if (drag.resetOnTap) {
        resetEmergencyDockPosition(panel);
    }
    if (event.type !== 'lostpointercapture' && panel.hasPointerCapture?.(event.pointerId)) {
        panel.releasePointerCapture(event.pointerId);
    }
}

function handleEmergencyDockKeydown(event, panel) {
    const dragHandle = event.target.closest('[data-emergency-drag-handle]');
    if (!dragHandle || !panel.contains(dragHandle)) return;
    if (event.key === 'Home') {
        event.preventDefault();
        resetEmergencyDockPosition(panel);
        return;
    }
    const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const step = event.shiftKey ? 32 : 12;
    applyEmergencyDockPosition(panel, {
        left: rect.left + direction[0] * step,
        top: rect.top + direction[1] * step,
    });
}

function setEmergencyAlertPresentationMode(panel, minimized) {
    if (!panel) return;
    const isVisible = panel.classList.contains('show');
    const expandedContent = panel.querySelector('.emergency-alert-expanded');
    const dockContent = panel.querySelector('.emergency-alert-dock');
    panel.classList.toggle('is-minimized', minimized);
    panel.dataset.presentation = minimized ? 'docked' : 'modal';
    expandedContent?.setAttribute('aria-hidden', String(minimized));
    dockContent?.setAttribute('aria-hidden', String(!minimized));
    if (expandedContent) expandedContent.hidden = minimized;
    if (dockContent) dockContent.hidden = !minimized;

    if (minimized) {
        panel.setAttribute('role', 'status');
        panel.removeAttribute('aria-modal');
        panel.setAttribute('aria-live', 'polite');
        panel.setAttribute('aria-atomic', 'true');
        panel.setAttribute('aria-labelledby', 'emergencyFireAlertDockTitle');
        panel.setAttribute('aria-describedby', 'emergencyFireAlertDockStatus emergencyFireAlertDockMeta');
    } else {
        panel.setAttribute('role', 'alertdialog');
        panel.setAttribute('aria-modal', 'true');
        panel.removeAttribute('aria-live');
        panel.removeAttribute('aria-atomic');
        panel.setAttribute('aria-labelledby', 'emergencyFireAlertTitle');
        panel.setAttribute('aria-describedby', 'emergencyFireAlertDescription emergencyFireAlertWorkflow emergencyFireAlertDetails');
    }

    const modalActive = isVisible && !minimized;
    document.body.classList.toggle('emergency-modal-open', modalActive);
    document.body.classList.toggle('emergency-alert-docked', isVisible && minimized);
    setEmergencyBackgroundInert(modalActive);
    if (isVisible && minimized) {
        syncEmergencyDockPosition(panel);
    } else {
        state.emergencyDockDrag = null;
        panel.classList.remove('is-dragging');
        clearEmergencyDockInlinePosition(panel);
        panel.style.removeProperty('--emergency-dock-top');
    }
}

function focusEmergencyPrimaryAction(panel) {
    if (!panel || emergencyAlertIsMinimized(panel)) return;
    panel.querySelector('.emergency-alert-action.is-primary')?.focus({ preventScroll: true });
}

function minimizeEmergencyAlert(panel) {
    if (!panel?.classList.contains('show') || emergencyAlertIsMinimized(panel)) return;
    const returnFocus = state.emergencyAlertReturnFocus;
    setEmergencyAlertPresentationMode(panel, true);
    keepIngestNoticeClearOfEmergencyDock();
    const focusTarget = returnFocus?.isConnected ? returnFocus : dashboardElement('dashboardMain');
    requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
}

function restoreEmergencyAlert(panel) {
    if (!panel?.classList.contains('show') || !emergencyAlertIsMinimized(panel)) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !panel.contains(activeElement) && activeElement !== document.body) {
        state.emergencyAlertReturnFocus = activeElement;
    }
    setEmergencyAlertPresentationMode(panel, false);
    requestAnimationFrame(() => requestAnimationFrame(() => focusEmergencyPrimaryAction(panel)));
}

function closeEmergencyAlert(panel, options = {}) {
    if (!panel) return;
    const { restoreFocus = true } = options;
    const wasOpen = panel.classList.contains('show');

    const wasMinimized = emergencyAlertIsMinimized(panel);
    panel.classList.remove('show');
    panel.classList.remove('is-acknowledged', 'is-cleared', 'is-close-blocked', 'is-minimized');
    panel.setAttribute('aria-hidden', 'true');
    panel.dataset.alertKey = '';
    panel.dataset.alertStatus = '';
    panel.dataset.presentation = '';
    document.body.classList.remove('emergency-modal-open');
    document.body.classList.remove('emergency-alert-docked');
    setEmergencyBackgroundInert(false);

    const returnFocus = state.emergencyAlertReturnFocus;
    state.emergencyAlertReturnFocus = null;
    if (wasOpen && !wasMinimized && restoreFocus) {
        const focusTarget = returnFocus?.isConnected ? returnFocus : dashboardElement('dashboardMain');
        requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
    }
}

function updateEmergencyIncidentStatus(panel, status) {
    const key = panel?.dataset.alertKey || '';
    const incident = state.emergencyIncidents.get(key);
    if (!incident) return;
    const now = new Date().toISOString();
    const nextStatus = status === 'acknowledged' && incident.clearRecord ? 'cleared' : status;
    const updatedIncident = {
        ...incident,
        status: nextStatus,
        acknowledgedAt: status === 'acknowledged' ? (incident.acknowledgedAt || now) : incident.acknowledgedAt,
        clearedAt: nextStatus === 'cleared'
            ? (incident.clearedAt || incident.clearCandidateAt || now)
            : (incident.clearedAt || null),
        resolvedAt: status === 'resolved' ? now : null,
        updatedAt: now,
    };
    storeEmergencyIncident(updatedIncident);
    refreshCurrentFireWorkflowCard();

    if (status === 'resolved') {
        closeEmergencyAlert(panel, { restoreFocus: true });
        return;
    }
    showEmergencyAlert(updatedIncident, SCENE_CONFIG[updatedIncident.gateway] || currentScene());
}

function handleEmergencyAlertClick(event) {
    const panel = event.currentTarget;
    const actionButton = event.target.closest('[data-emergency-action]');
    if (!actionButton || !panel.contains(actionButton)) return;
    const action = actionButton.dataset.emergencyAction;
    if (action === 'minimize') {
        minimizeEmergencyAlert(panel);
    } else if (action === 'restore') {
        restoreEmergencyAlert(panel);
    } else if (action === 'dock-reset') {
        if (performance.now() >= state.emergencyDockSuppressClickUntil) {
            resetEmergencyDockPosition(panel);
        }
    } else if (action === 'confirm') {
        updateEmergencyIncidentStatus(panel, 'acknowledged');
    } else if (action === 'resolve') {
        updateEmergencyIncidentStatus(panel, 'resolved');
    }
}

function handleEmergencyAlertKeydown(event) {
    const panel = event.currentTarget;
    if (!panel.classList.contains('show')) return;
    if (emergencyAlertIsMinimized(panel)) {
        handleEmergencyDockKeydown(event, panel);
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        panel.classList.remove('is-close-blocked');
        void panel.offsetWidth;
        panel.classList.add('is-close-blocked');
        const primaryAction = panel.querySelector('.emergency-alert-action.is-primary');
        primaryAction?.focus({ preventScroll: true });
        window.setTimeout(() => panel.classList.remove('is-close-blocked'), 420);
        return;
    }
    if (event.key !== 'Tab') return;

    const focusableElements = emergencyAlertFocusableElements(panel);
    if (!focusableElements.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
    }
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    if (event.shiftKey && (document.activeElement === firstElement || !panel.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
    } else if (!event.shiftKey && (document.activeElement === lastElement || !panel.contains(document.activeElement))) {
        event.preventDefault();
        firstElement.focus();
    }
}

function ensureEmergencyAlert() {
    let alert = dashboardElement('emergencyFireAlert');
    if (alert) return alert;
    alert = document.createElement('section');
    alert.id = 'emergencyFireAlert';
    alert.className = 'sensor-update-toast is-emergency';
    alert.setAttribute('role', 'alertdialog');
    alert.setAttribute('aria-modal', 'true');
    alert.setAttribute('aria-labelledby', 'emergencyFireAlertTitle');
    alert.setAttribute('aria-describedby', 'emergencyFireAlertDescription emergencyFireAlertWorkflow emergencyFireAlertDetails');
    alert.setAttribute('aria-hidden', 'true');
    alert.setAttribute('tabindex', '-1');
    alert.addEventListener('click', handleEmergencyAlertClick);
    alert.addEventListener('keydown', handleEmergencyAlertKeydown);
    alert.addEventListener('pointerdown', handleEmergencyDockPointerDown);
    alert.addEventListener('pointermove', handleEmergencyDockPointerMove);
    alert.addEventListener('pointerup', finishEmergencyDockDrag);
    alert.addEventListener('pointercancel', finishEmergencyDockDrag);
    alert.addEventListener('lostpointercapture', finishEmergencyDockDrag);
    document.body.appendChild(alert);
    return alert;
}

function showEmergencyAlert(incident, scene) {
    if (!incident || incident.status === 'resolved') return;
    const panel = dashboardElement('emergencyFireAlert') || ensureEmergencyAlert();
    const key = incident.key;
    const acknowledged = incident.status === 'acknowledged';
    const cleared = incident.status === 'cleared';
    const sameIncident = panel.dataset.alertKey === key;
    const keepMinimized = sameIncident && emergencyAlertIsMinimized(panel);
    if (panel.dataset.alertKey === key
        && panel.dataset.alertStatus === incident.status
        && panel.classList.contains('show')) return;
    if (!panel.classList.contains('show') || !sameIncident) {
        const activeElement = document.activeElement;
        state.emergencyAlertReturnFocus = activeElement instanceof HTMLElement
            && activeElement !== document.body
            && !panel.contains(activeElement)
            ? activeElement
            : null;
    }

    const record = incident.record || {};
    const recordNumber = dashboardRecordNumber(record);
    const collectedTime = dashboardTime(record.payload_time || record.source_time, true);
    const receivedTime = dashboardTime(record.recv_time || record.create_time, true);
    const alertTitle = cleared ? '已自动检测到火灾已消除' : acknowledged ? '火情处置中' : '发现火情';
    const dockTitle = cleared ? '火情已消除' : acknowledged ? '火情处置中' : '发现火情';
    const dockStatus = cleared ? '已消除 · 待确认关闭' : acknowledged ? '已确认 · 现场处置中' : '火情告警 · 待人工确认';
    const alertIcon = cleared ? 'fa-circle-check' : acknowledged ? 'fa-person-circle-check' : 'fa-triangle-exclamation';
    panel.dataset.alertKey = key;
    panel.dataset.alertStatus = incident.status;
    panel.classList.toggle('is-acknowledged', acknowledged);
    panel.classList.toggle('is-cleared', cleared);
    panel.innerHTML = `
        <span class="emergency-alert-expanded" aria-hidden="${keepMinimized}" ${keepMinimized ? 'hidden' : ''}>
            <button type="button" class="emergency-alert-minimize" data-emergency-action="minimize" aria-label="缩小告警并继续操作页面" title="缩小到页面侧边">
                <i class="fas fa-window-minimize" aria-hidden="true"></i>
            </button>
            <span class="toast-icon" aria-hidden="true"><i class="fas ${alertIcon}"></i></span>
            <span class="toast-copy">
                <small><i class="fas ${cleared ? 'fa-satellite-dish' : acknowledged ? 'fa-shield-halved' : 'fa-bell'}" aria-hidden="true"></i> ${cleared ? '后续遥测正常 · 系统自动复核' : acknowledged ? '告警已确认 · 现场处置中' : '一级险情 · 等待人工确认'}</small>
                <strong id="emergencyFireAlertTitle">${alertTitle}</strong>
                <span class="toast-message" id="emergencyFireAlertDescription">${cleared
                    ? '系统收到时间更新且状态正常的下一条遥测消息，已自动检测到本次火灾信号消除。请人工确认后关闭告警。'
                    : acknowledged
                        ? '火警已经人工确认。请继续核查和处置现场，确认火情完全解决后再关闭本告警。'
                        : '卫星遥测检测到明确火警信号，请人工确认告警并立即启动现场核查。'}</span>
                <span class="emergency-location"><i class="fas fa-location-dot" aria-hidden="true"></i>${escapeDashboardHtml(scene?.title || '当前监测区域')}</span>
                <span class="emergency-workflow" aria-label="火情处置流程">
                    <span class="emergency-workflow-step ${acknowledged || cleared ? 'is-complete' : 'is-active'}"><i aria-hidden="true">${acknowledged || cleared ? '<span class="fas fa-check"></span>' : '1'}</i><b>人工确认</b></span>
                    <span class="emergency-workflow-line ${acknowledged || cleared ? 'is-complete' : ''}" aria-hidden="true"></span>
                    <span class="emergency-workflow-step ${cleared ? 'is-complete' : acknowledged ? 'is-active' : ''}"><i aria-hidden="true">${cleared ? '<span class="fas fa-check"></span>' : '2'}</i><b>${cleared ? '火情已消除' : '解决并关闭'}</b></span>
                </span>
                <span class="emergency-workflow-note" id="emergencyFireAlertWorkflow">
                    <i class="fas ${cleared ? 'fa-circle-info' : acknowledged ? 'fa-fire-extinguisher' : 'fa-lock'}" aria-hidden="true"></i>
                    ${cleared ? '正常遥测已自动判定火灾信号消除，请人工确认关闭' : acknowledged ? '仅在确认现场火情已经解决后关闭' : '告警必须人工确认，未确认前无法关闭'}
                </span>
                <span class="toast-meta" id="emergencyFireAlertDetails">
                    <span><i class="fas fa-satellite" aria-hidden="true"></i> 卫星帧编号 <b>#${escapeDashboardHtml(recordNumber)}</b></span>
                    <span><i class="far fa-clock" aria-hidden="true"></i> 火情采集时间 <b>${escapeDashboardHtml(collectedTime)}</b></span>
                    <span><i class="fas fa-database" aria-hidden="true"></i> 火情入库时间 <b>${escapeDashboardHtml(receivedTime)}</b></span>
                </span>
                <span class="emergency-alert-actions">
                    <button type="button" class="emergency-alert-action is-primary ${acknowledged || cleared ? 'is-resolve' : ''}" data-emergency-action="${acknowledged || cleared ? 'resolve' : 'confirm'}">
                        <i class="fas ${cleared ? 'fa-check-double' : acknowledged ? 'fa-fire-extinguisher' : 'fa-user-check'}" aria-hidden="true"></i><span>${cleared ? '确认消除并关闭' : acknowledged ? '火情已解决并关闭' : '人工确认火警'}</span>
                    </button>
                </span>
            </span>
        </span>
        <span class="emergency-alert-dock" aria-hidden="${!keepMinimized}" title="按住窗口拖动；方向键精确移动" ${keepMinimized ? '' : 'hidden'}>
            <button type="button" class="emergency-dock-signal" data-emergency-action="dock-reset" data-emergency-drag-handle aria-label="移动火情告警窗口。拖动可自由移动，方向键可精确移动，Home 键或点击可复位到右上角" title="拖动窗口 · 方向键移动 · 点击复位">
                <i class="fas ${alertIcon}" aria-hidden="true"></i><span class="emergency-dock-grip" aria-hidden="true"><i class="fas fa-grip-lines"></i></span>
            </button>
            <span class="emergency-dock-copy">
                <small id="emergencyFireAlertDockStatus"><i aria-hidden="true"></i>${dockStatus}</small>
                <strong id="emergencyFireAlertDockTitle">${dockTitle}</strong>
                <span class="emergency-dock-meta" id="emergencyFireAlertDockMeta">
                    <span><i class="fas fa-location-dot" aria-hidden="true"></i>${escapeDashboardHtml(scene?.title || '当前监测区域')}</span>
                    <b>#${escapeDashboardHtml(recordNumber)}</b>
                </span>
            </span>
            <button type="button" class="emergency-alert-restore" data-emergency-action="restore" aria-label="展开火情告警详情" title="展开告警详情">
                <i class="fas fa-up-right-and-down-left-from-center" aria-hidden="true"></i><span>展开</span>
            </button>
        </span>`;

    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('show');
    setEmergencyAlertPresentationMode(panel, keepMinimized);
    if (!keepMinimized) {
        const focusPrimaryAction = () => {
            if (panel.dataset.alertKey === key) focusEmergencyPrimaryAction(panel);
        };
        requestAnimationFrame(() => requestAnimationFrame(focusPrimaryAction));
        if (document.readyState !== 'complete') {
            window.addEventListener('load', () => window.setTimeout(focusPrimaryAction, 0), { once: true });
        }
    }
}

function updateEmergencyAlert(record, scene) {
    const gateway = scene?.id || state.currentAccessPoint;
    const fireDetected = scene?.scene !== 'ocean'
        && (record?.fire_detected === true || record?.fire_detected === 1);
    const normalDetected = scene?.scene !== 'ocean'
        && record != null
        && (record.fire_detected === false || record.fire_detected === 0);
    let incident = null;

    if (fireDetected) {
        const key = emergencyAlertKey(record, gateway);
        incident = state.emergencyIncidents.get(key) || createEmergencyIncident(record, key, gateway);
        if (incident.status === 'resolved') incident = activeEmergencyIncident(gateway);
    } else {
        incident = activeEmergencyIncident(gateway);
        if (normalDetected && incident && isNewerEmergencyRecord(record, incident)) {
            incident = incident.status === 'acknowledged'
                ? markEmergencyIncidentCleared(incident, record)
                : rememberEmergencyClearCandidate(incident, record);
        }
    }

    if (!incident) {
        const alert = dashboardElement('emergencyFireAlert');
        const dockedIncident = alert && emergencyAlertIsMinimized(alert)
            ? state.emergencyIncidents.get(alert.dataset.alertKey || '')
            : null;
        if (dockedIncident && dockedIncident.status !== 'resolved') return dockedIncident;
        if (alert) closeEmergencyAlert(alert, { restoreFocus: true });
        return null;
    }
    showEmergencyAlert(incident, SCENE_CONFIG[incident.gateway] || scene || currentScene());
    return incident;
}

function renderLatestSceneRecord(record, environmentRecord = null, options = {}) {
    const scene = currentScene();
    state.latestSceneRecord = record || null;
    renderForestEnvironment(environmentRecord);
    if (!record) {
        renderSceneWaiting('接收端在线 · 等待首帧');
        return;
    }

    const isOcean = scene.scene === 'ocean';
    const windSpeed = Number(record.wind_speed ?? record.sensor_value);
    const latency = dashboardLatencyMs(record);
    const metricCard = dashboardElement('sceneMetricCard');
    const verdict = dashboardElement('sceneVerdict');

    if (isOcean) {
        const value = Number.isFinite(windSpeed) ? windSpeed.toFixed(1) : '--';
        setDashboardText('primaryMetricValue', value);
        setDashboardText('overviewMetricValue', value);
        if (metricCard) {
            metricCard.classList.remove(...FIRE_WORKFLOW_CARD_CLASSES);
            delete metricCard.dataset.workflowStatus;
            metricCard.setAttribute('aria-label', `当前风速：${value} m/s。风速遥测正常`);
        }
        if (verdict) {
            verdict.className = 'scene-verdict is-online';
            verdict.innerHTML = '<i aria-hidden="true"></i>风速遥测正常';
        }
    } else {
        if (!options.deferEmergency) updateEmergencyAlert(record, scene);
        renderFireWorkflowCard(record, emergencyIncidentForDisplay(record, scene.id));
    }

    setDashboardText('latestRecordId', `#${dashboardRecordNumber(record)}`);
    setDashboardText('latestCollectedTime', dashboardTime(record.payload_time || record.source_time));
    setDashboardText('latestReceivedTime', dashboardTime(record.recv_time || record.create_time));
    setDashboardText('latestLatency', formatDashboardLatency(latency));
    setDashboardText('overviewLatency', formatDashboardLatency(latency));
    const latencyElement = dashboardElement('latestLatency');
    if (latencyElement) latencyElement.dataset.level = dashboardLatencyLevel(latency);

    setDashboardText(
        'linkProofEvidence',
        `终端 ${record.terminal_id || '--'} · 卫星帧 ${dashboardRecordNumber(record)} · ${dashboardTime(record.recv_time)}`,
    );
}

function sceneMetricValue(record, scene) {
    if (scene.scene === 'ocean') {
        const value = Number(record.wind_speed ?? record.sensor_value);
        return Number.isFinite(value) ? value : null;
    }
    return record.fire_detected === true || record.fire_detected === 1 ? 1 : 0;
}

const DUAL_TREND_PLOT = Object.freeze({ left: 30, right: 290, top: 10, bottom: 82, width: 320, height: 110 });

function trendScale(values, tickCount = 5) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
        const padding = Math.max(1, Math.abs(min) * .04);
        min -= padding;
        max += padding;
    }
    const range = Math.max(.001, max - min);
    const ticks = Array.from({ length: tickCount }, (_, index) => max - (index / (tickCount - 1)) * range);
    return { min, max, ticks };
}

function trendSeriesPoints(values, left, right, top, bottom, min, max) {
    const range = Math.max(.001, max - min);
    return values.map((value, index) => ({
        x: values.length === 1 ? (left + right) / 2 : left + (index / (values.length - 1)) * (right - left),
        y: bottom - ((value - min) / range) * (bottom - top),
    }));
}

function clearDetailedTrendCoordinates() {
    ['trendTemperatureTicks', 'trendHumidityTicks', 'trendTimeTicks'].forEach((id) => {
        const element = dashboardElement(id);
        if (element) element.innerHTML = '';
    });
}

function renderDetailedTimeCoordinates(rows, timeTicks) {
    if (!timeTicks) return;
    const plot = DUAL_TREND_PLOT;
    const tickCount = Math.min(5, rows.length);
    const lastIndex = rows.length - 1;
    const indexes = Array.from({ length: tickCount }, (_, tickIndex) =>
        tickCount === 1 ? 0 : Math.round((tickIndex / (tickCount - 1)) * lastIndex),
    ).filter((index, position, list) => list.indexOf(index) === position);
    timeTicks.innerHTML = indexes.map((index) => {
        const record = rows[index].record;
        const time = dashboardTime(record?.payload_time || record?.source_time);
        const label = time === '--' ? '--' : time.slice(0, 5);
        const x = rows.length === 1 ? (plot.left + plot.right) / 2 : plot.left + (index / lastIndex) * (plot.right - plot.left);
        return `<span class="trend-time-tick" style="left:${((x / plot.width) * 100).toFixed(2)}%">${escapeDashboardHtml(label)}</span>`;
    }).join('');
}

function renderDetailedForestCoordinates(rows, temperatureScale, humidityScale) {
    const temperatureTicks = dashboardElement('trendTemperatureTicks');
    const humidityTicks = dashboardElement('trendHumidityTicks');
    const timeTicks = dashboardElement('trendTimeTicks');
    const plot = DUAL_TREND_PLOT;
    const yPosition = (index, count) => ((plot.top + (index / (count - 1)) * (plot.bottom - plot.top)) / plot.height) * 100;

    if (temperatureTicks) {
        temperatureTicks.innerHTML = temperatureScale.ticks.map((value, index, ticks) =>
            `<span class="trend-coordinate-tick" style="top:${yPosition(index, ticks.length).toFixed(2)}%">${value.toFixed(1)}°</span>`,
        ).join('');
    }
    if (humidityTicks) {
        humidityTicks.innerHTML = humidityScale.ticks.map((value, index, ticks) =>
            `<span class="trend-coordinate-tick" style="top:${yPosition(index, ticks.length).toFixed(2)}%">${value.toFixed(0)}%</span>`,
        ).join('');
    }
    renderDetailedTimeCoordinates(rows, timeTicks);
}

function renderDetailedSingleCoordinates(rows, scale, unit = '') {
    const primaryTicks = dashboardElement('trendTemperatureTicks');
    const secondaryTicks = dashboardElement('trendHumidityTicks');
    const timeTicks = dashboardElement('trendTimeTicks');
    const plot = DUAL_TREND_PLOT;
    const yPosition = (index, count) => ((plot.top + (index / (count - 1)) * (plot.bottom - plot.top)) / plot.height) * 100;
    if (primaryTicks) {
        primaryTicks.innerHTML = scale.ticks.map((value, index, ticks) =>
            `<span class="trend-coordinate-tick" style="top:${yPosition(index, ticks.length).toFixed(2)}%">${value.toFixed(1)}</span>`,
        ).join('');
        primaryTicks.setAttribute('aria-label', `${unit || '数值'}纵坐标刻度`);
    }
    if (secondaryTicks) secondaryTicks.innerHTML = '';
    renderDetailedTimeCoordinates(rows, timeTicks);
}

function trendPath(points) {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function setTrendPoint(pointElement, point, color) {
    if (!pointElement || !point) return;
    pointElement.setAttribute('cx', point.x.toFixed(1));
    pointElement.setAttribute('cy', point.y.toFixed(1));
    pointElement.setAttribute('r', '3');
    pointElement.style.stroke = color;
}

function renderSceneTrend(records, environmentRecords = []) {
    const scene = currentScene();
    const line = dashboardElement('sceneTrendLine');
    const secondaryLine = dashboardElement('sceneTrendSecondaryLine');
    const area = dashboardElement('sceneTrendArea');
    const point = dashboardElement('sceneTrendPoint');
    const secondaryPoint = dashboardElement('sceneTrendSecondaryPoint');
    const secondaryLegend = dashboardElement('trendSecondaryLegend');
    const secondaryMax = dashboardElement('trendSecondaryMax');
    const secondaryMin = dashboardElement('trendSecondaryMin');
    const chart = dashboardElement('sceneTrendChart');
    const primaryAxisTitle = dashboardElement('trendPrimaryAxisTitle');
    const secondaryAxisTitle = dashboardElement('trendSecondaryAxisTitle');
    setDashboardText('trendHorizontalAxisTitle', '采样时间（HH:mm）');

    if (scene.scene === 'forest') {
        setDashboardText('trendPrimaryAxisTitle', '温度（°C）');
        setDashboardText('trendSecondaryAxisTitle', '相对湿度（%RH）');
        if (primaryAxisTitle) primaryAxisTitle.hidden = false;
        if (secondaryAxisTitle) secondaryAxisTitle.hidden = false;
        const rows = (Array.isArray(environmentRecords) ? environmentRecords : [])
            .map((record) => ({
                record,
                temperature: dashboardNumericValue(record.temperature),
                humidity: dashboardNumericValue(record.humidity),
            }))
            .filter((item) => item.temperature != null && item.humidity != null);
        setDashboardText('trendSampleCount', rows.length);
        if (chart) chart.dataset.mode = 'dual';
        if (secondaryLegend) secondaryLegend.hidden = false;
        if (secondaryMax) secondaryMax.hidden = false;
        if (secondaryMin) secondaryMin.hidden = false;
        if (area) area.setAttribute('d', '');

        if (!rows.length || !line || !secondaryLine || !point || !secondaryPoint) {
            clearDetailedTrendCoordinates();
            if (line) line.setAttribute('d', '');
            if (secondaryLine) secondaryLine.setAttribute('d', '');
            if (point) point.setAttribute('r', '0');
            if (secondaryPoint) secondaryPoint.setAttribute('r', '0');
            setDashboardText('trendMax', '--');
            setDashboardText('trendMin', '--');
            setDashboardText('trendSecondaryMax', '--');
            setDashboardText('trendSecondaryMin', '--');
            setDashboardText('trendDelta', '--');
            return;
        }

        const temperatures = rows.map((item) => item.temperature);
        const humidities = rows.map((item) => item.humidity);
        const temperatureScale = trendScale(temperatures);
        const humidityScale = trendScale(humidities);
        const plot = DUAL_TREND_PLOT;
        const temperaturePoints = trendSeriesPoints(
            temperatures,
            plot.left,
            plot.right,
            plot.top,
            plot.bottom,
            temperatureScale.min,
            temperatureScale.max,
        );
        const humidityPoints = trendSeriesPoints(
            humidities,
            plot.left,
            plot.right,
            plot.top,
            plot.bottom,
            humidityScale.min,
            humidityScale.max,
        );
        line.setAttribute('d', trendPath(temperaturePoints));
        line.style.stroke = scene.temperatureColor;
        secondaryLine.setAttribute('d', trendPath(humidityPoints));
        secondaryLine.style.stroke = scene.humidityColor;
        setTrendPoint(point, temperaturePoints.at(-1), scene.temperatureColor);
        setTrendPoint(secondaryPoint, humidityPoints.at(-1), scene.humidityColor);
        renderDetailedForestCoordinates(rows, temperatureScale, humidityScale);
        setDashboardText('trendMax', `${Math.max(...temperatures).toFixed(1)}°`);
        setDashboardText('trendMin', `${Math.min(...temperatures).toFixed(1)}°`);
        setDashboardText('trendSecondaryMax', `${Math.max(...humidities).toFixed(0)}%`);
        setDashboardText('trendSecondaryMin', `${Math.min(...humidities).toFixed(0)}%`);
        setDashboardText('trendDelta', `${temperatures.at(-1).toFixed(1)}° · ${humidities.at(-1).toFixed(0)}%`);
        const deltaElement = dashboardElement('trendDelta');
        if (deltaElement) deltaElement.className = 'trend-delta stable';
        return;
    }

    const rows = (Array.isArray(records) ? records : [])
        .map((record) => ({ record, value: sceneMetricValue(record, scene) }))
        .filter((item) => item.value != null && Number.isFinite(item.value));
    if (chart) chart.dataset.mode = 'single';
    setDashboardText('trendPrimaryAxisTitle', scene.scene === 'ocean' ? '风速（m/s）' : '状态值');
    if (primaryAxisTitle) primaryAxisTitle.hidden = false;
    if (secondaryAxisTitle) secondaryAxisTitle.hidden = true;
    clearDetailedTrendCoordinates();
    if (secondaryLegend) secondaryLegend.hidden = true;
    if (secondaryMax) secondaryMax.hidden = true;
    if (secondaryMin) secondaryMin.hidden = true;
    if (secondaryLine) secondaryLine.setAttribute('d', '');
    if (secondaryPoint) secondaryPoint.setAttribute('r', '0');

    setDashboardText('trendSampleCount', rows.length);
    if (!rows.length || !line || !area || !point) {
        if (line) line.setAttribute('d', '');
        if (area) area.setAttribute('d', '');
        if (point) point.setAttribute('r', '0');
        setDashboardText('trendMax', '--');
        setDashboardText('trendMin', '--');
        setDashboardText('trendDelta', '--');
        return;
    }

    const values = rows.map((item) => item.value);
    let scale = trendScale(values);
    if (scene.scene !== 'ocean') {
        scale = { min: 0, max: 1, ticks: [1, .75, .5, .25, 0] };
    }

    const plot = DUAL_TREND_PLOT;
    const points = trendSeriesPoints(values, plot.left, plot.right, plot.top, plot.bottom, scale.min, scale.max);
    const path = trendPath(points);
    line.setAttribute('d', path);
    line.style.stroke = scene.color;
    area.setAttribute('d', `${path} L ${points.at(-1).x.toFixed(1)} ${plot.bottom} L ${points[0].x.toFixed(1)} ${plot.bottom} Z`);
    area.style.fill = 'url(#sceneTrendAreaGradient)';
    point.setAttribute('cx', points.at(-1).x.toFixed(1));
    point.setAttribute('cy', points.at(-1).y.toFixed(1));
    point.setAttribute('r', '3');
    point.style.stroke = scene.color;
    renderDetailedSingleCoordinates(rows, scale, scene.scene === 'ocean' ? '风速（m/s）' : '状态值');

    setDashboardText('trendMax', scene.scene === 'ocean' ? `${Math.max(...values).toFixed(1)}` : '告警');
    setDashboardText('trendMin', scene.scene === 'ocean' ? `${Math.min(...values).toFixed(1)}` : '安全');
    const hasPreviousSample = values.length > 1;
    const delta = hasPreviousSample ? values.at(-1) - values.at(-2) : 0;
    const deltaDirection = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    const oceanDeltaText = hasPreviousSample
        ? `较上次 ${deltaDirection}${Math.abs(delta).toFixed(1)} m/s`
        : '暂无变化';
    setDashboardText('trendDelta', scene.scene === 'ocean' ? oceanDeltaText : values.at(-1) ? '告警' : '正常');
    const deltaElement = dashboardElement('trendDelta');
    if (deltaElement) {
        deltaElement.className = `trend-delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'stable'}`;
        if (scene.scene === 'ocean') {
            const accessibleDelta = hasPreviousSample
                ? `相较上一条样本${delta > 0 ? '上升' : delta < 0 ? '下降' : '无变化'} ${Math.abs(delta).toFixed(1)} 米每秒`
                : '暂无上一条样本可供比较';
            deltaElement.title = accessibleDelta;
            deltaElement.setAttribute('aria-label', accessibleDelta);
        } else {
            deltaElement.removeAttribute('title');
            deltaElement.removeAttribute('aria-label');
        }
    }
}

function historyMetricMarkup(record, scene) {
    if (scene.scene === 'ocean') {
        const value = Number(record.wind_speed ?? record.sensor_value);
        return `<span class="history-scene-metric wind"><i class="fas fa-wind" aria-hidden="true"></i>${Number.isFinite(value) ? value.toFixed(1) : '--'} <small>m/s</small></span>`;
    }
    const alarm = record.fire_detected === true || record.fire_detected === 1;
    return `<span class="history-scene-metric ${alarm ? 'alarm' : 'normal'}"><i class="fas fa-fire-flame-curved" aria-hidden="true"></i>${alarm ? '发现火情' : '安全'}</span>`;
}

function historyTimeMarkup(value, iconClass) {
    const formatted = dashboardTime(value, true);
    if (!formatted || formatted === '--') {
        return `<span class="history-time"><i class="${iconClass}" aria-hidden="true"></i><span class="history-time-copy"><b>--</b></span></span>`;
    }

    const parts = String(formatted).trim().split(/\s+/);
    const time = parts.pop() || '--';
    const date = parts.join(' ');
    return `<span class="history-time"><i class="${iconClass}" aria-hidden="true"></i><span class="history-time-copy">${date ? `<small>${escapeDashboardHtml(date)}</small>` : ''}<b>${escapeDashboardHtml(time)}</b></span></span>`;
}

function renderSceneHistory(records) {
    const scene = currentScene();
    const rows = Array.isArray(records) ? [...records].reverse().slice(0, DASHBOARD_HISTORY_LIMIT) : [];
    const body = dashboardElement('historyTableBody');
    state.historyRows = rows;
    setDashboardText('historyCount', rows.length);
    setDashboardText('primaryHistoryCount', rows.length);
    setDashboardText('overviewRecordCount', rows.length);
    updateHistoryExpandControl('primary', rows.length);
    if (!body) return;

    if (!rows.length) {
        body.innerHTML = '<tr class="history-empty-row"><td colspan="6">当前场景暂无卫星遥测记录</td></tr>';
        return;
    }

    body.innerHTML = rows.map((record) => {
        const latency = dashboardLatencyMs(record);
        const level = dashboardLatencyLevel(latency);
        const latencyLabel = latency < 0
            ? `入库时间早于采集时间，检测到设备时钟偏差 ${formatDashboardDuration(latency)}`
            : `链路时延 ${formatDashboardLatency(latency)}`;
        return `<tr>
            <td><span class="history-record-id">#${escapeDashboardHtml(dashboardRecordNumber(record))}</span></td>
            <td>${historyMetricMarkup(record, scene)}</td>
            <td>${historyTimeMarkup(record.payload_time || record.source_time, 'far fa-clock')}</td>
            <td>${historyTimeMarkup(record.recv_time || record.create_time, 'fas fa-database')}</td>
            <td><span class="latency-badge ${level}" title="${escapeDashboardHtml(latencyLabel)}" aria-label="${escapeDashboardHtml(latencyLabel)}"><i class="fas fa-wave-square" aria-hidden="true"></i>${escapeDashboardHtml(formatDashboardLatency(latency))}</span></td>
            <td><span class="history-link-online"><i aria-hidden="true"></i>在线帧</span></td>
        </tr>`;
    }).join('');
}

function environmentRecordNumber(record) {
    return dashboardRecordNumber(record);
}

function renderEnvironmentHistory(records) {
    const scene = currentScene();
    const panel = dashboardElement('environmentHistoryPanel');
    const body = dashboardElement('environmentHistoryTableBody');
    const rows = scene.scene === 'forest' && Array.isArray(records)
        ? [...records].reverse().slice(0, DASHBOARD_HISTORY_LIMIT)
        : [];

    if (panel) panel.hidden = scene.scene !== 'forest';
    setDashboardText('environmentHistoryCount', rows.length);
    updateHistoryExpandControl('environment', rows.length);
    if (scene.scene === 'forest') {
        setDashboardText('historyCount', state.historyRows.length + rows.length);
    }
    if (!body) return;

    if (!rows.length) {
        body.innerHTML = '<tr class="history-empty-row"><td colspan="5">当前暂无温湿度记录</td></tr>';
        return;
    }

    body.innerHTML = rows.map((record) => {
        const temperature = dashboardNumericValue(record.temperature);
        const humidity = dashboardNumericValue(record.humidity);
        const recordId = environmentRecordNumber(record);
        return `<tr>
            <td><span class="history-record-id">#${escapeDashboardHtml(recordId)}</span></td>
            <td><span class="environment-reading temperature">${temperature == null ? '--' : temperature.toFixed(1)} <small>°C</small></span></td>
            <td><span class="environment-reading humidity">${humidity == null ? '--' : humidity.toFixed(0)} <small>%RH</small></span></td>
            <td>${historyTimeMarkup(record.payload_time || record.source_time, 'far fa-clock')}</td>
            <td>${historyTimeMarkup(record.recv_time || record.create_time, 'fas fa-database')}</td>
        </tr>`;
    }).join('');
}

function updateLinkProof(link) {
    state.linkStatus = link || null;
    const gateway = link?.gateways?.find((item) => item.sn_code === state.currentAccessPoint);
    const sourceOnline = Boolean(link?.source_online);
    const hasTelemetry = Boolean(gateway?.has_telemetry);
    const headerStatus = dashboardElement('connectionStatus');
    const statusDot = headerStatus?.querySelector('.status-dot');
    if (headerStatus) {
        headerStatus.classList.toggle('offline', !sourceOnline && !hasTelemetry);
        headerStatus.classList.toggle('degraded', !sourceOnline && hasTelemetry);
    }
    if (statusDot) statusDot.classList.toggle('online', sourceOnline || hasTelemetry);
    setDashboardText('connectionStatusText', sourceOnline ? '在线' : hasTelemetry ? '链路中断 · 本地缓存' : '自动重连');
    setDashboardText('linkProofStatus', sourceOnline ? '四段链路在线' : hasTelemetry ? '上游离线 · 展示本地末次入库数据' : '卫星链路重连中');

    const proof = dashboardElement('sceneLinkProof');
    if (proof) {
        proof.classList.toggle('is-online', sourceOnline);
        proof.classList.toggle('is-cached', !sourceOnline && hasTelemetry);
    }
    document.querySelectorAll('.scene-switch').forEach((button) => {
        const item = link?.gateways?.find((gatewayItem) => gatewayItem.sn_code === button.dataset.gateway);
        button.dataset.link = sourceOnline || item?.has_telemetry ? 'online' : 'reconnecting';
    });
}

async function fetchLinkProof() {
    try {
        const result = await fetchDashboardJson('/api/link-status');
        if (result?.success) updateLinkProof(result.data);
    } catch (error) {
        updateLinkProof(null);
        console.warn('链路状态读取失败:', error);
    }
}

async function fetchAccessPoints() {
    try {
        const result = await fetchDashboardJson('/api/access_points');
        if (!result?.success) return;
        state.accessPoints = result.data || [];
        setDashboardText('overviewNodeCount', state.accessPoints.length);
        setDashboardText('mapNodeCount', state.accessPoints.length);
    } catch (error) {
        console.warn('接入点读取失败:', error);
    }
}

async function fetchInactiveIngestRecord() {
    const inactiveScene = state.currentAccessPoint === SCENE_CONFIG.gateway1.id
        ? SCENE_CONFIG.gateway2
        : SCENE_CONFIG.gateway1;
    try {
        if (inactiveScene.scene === 'forest') {
            const result = await fetchDashboardJson(
                `/api/environment?limit=2&sn_code=${encodeURIComponent(inactiveScene.id)}`,
            );
            if (!result?.success) return;
            const rows = result.data || [];
            observeIngestRecord(rows.at(-1) || null, 'environment', inactiveScene);
            return;
        }
        const result = await fetchDashboardJson(`/api/latest?sn_code=${encodeURIComponent(inactiveScene.id)}`);
        if (result) observeIngestRecord(result.success ? result.data : null, 'wind', inactiveScene);
    } catch (error) {
        console.warn('后台入库提示监听失败:', error);
    }
}

async function fetchCurrentSceneData(options = {}) {
    const gateway = state.currentAccessPoint;
    const scene = SCENE_CONFIG[gateway];
    const sequence = ++state.requestSequence;
    if (!options.silent) renderSceneWaiting('正在读取卫星帧');
    try {
        const [latestResult, chartResult, environmentResult] = await Promise.all([
            fetchDashboardJson(`/api/latest?sn_code=${encodeURIComponent(gateway)}`),
            fetchDashboardJson(`/api/chart?limit=${DASHBOARD_HISTORY_LIMIT}&sn_code=${encodeURIComponent(gateway)}`),
            scene.scene === 'forest'
                ? fetchDashboardJson(`/api/environment?limit=${DASHBOARD_HISTORY_LIMIT}&sn_code=${encodeURIComponent(gateway)}`)
                    .catch((error) => {
                        console.warn('森林温湿度读取失败:', error);
                        return { success: false, data: [] };
                    })
                : Promise.resolve({ success: true, data: [] }),
        ]);
        if (sequence !== state.requestSequence || gateway !== state.currentAccessPoint) return;
        const rows = chartResult?.success ? chartResult.data || [] : [];
        const environmentRows = environmentResult?.success ? environmentResult.data || [] : [];
        state.environmentRows = environmentRows;
        const latestRecord = latestResult?.success ? latestResult.data : null;
        if (scene.scene === 'forest' && environmentResult?.success) {
            observeIngestRecord(environmentRows.at(-1) || null, 'environment', scene);
        } else if (scene.scene === 'ocean' && latestResult) {
            observeIngestRecord(latestResult.success ? latestRecord : null, 'wind', scene);
        }
        const shouldDeferInitialPreview = EMERGENCY_ALERT_REFRESH_PREVIEW && !state.latestSceneRecord;
        renderLatestSceneRecord(latestRecord, environmentRows.at(-1), {
            deferEmergency: shouldDeferInitialPreview,
        });
        renderSceneHistory(rows);
        renderEnvironmentHistory(environmentRows);
        renderSceneTrend(rows, environmentRows);
        setDashboardApiStatus(true);
        setDashboardText('lastRefresh', new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        state.refreshCountdown = DASHBOARD_REFRESH_SECONDS;
    } catch (error) {
        if (sequence !== state.requestSequence) return;
        renderSceneWaiting('数据服务重连中');
        renderForestEnvironment(null);
        renderSceneHistory([]);
        renderEnvironmentHistory([]);
        renderSceneTrend([], []);
        setDashboardApiStatus(false);
        console.warn('场景遥测读取失败:', error);
    }
}

function switchAccessPoint(snCode, options = {}) {
    if (!SCENE_CONFIG[snCode]) return;
    state.currentAccessPoint = snCode;
    state.refreshCountdown = DASHBOARD_REFRESH_SECONDS;
    updateSceneStaticUi(currentScene());
    if (!options.skipUrl) syncDashboardSceneUrl(snCode);
    if (state.linkStatus) updateLinkProof(state.linkStatus);
    fetchCurrentSceneData();
    if (!options.skipMap && typeof highlightCurrentMapMarker === 'function') {
        highlightCurrentMapMarker();
    }
}

window.switchAccessPoint = switchAccessPoint;

function initSceneSwitching() {
    const buttons = Array.from(document.querySelectorAll('.scene-switch'));
    buttons.forEach((button, index) => {
        button.addEventListener('click', () => switchAccessPoint(button.dataset.gateway));
        button.addEventListener('keydown', (event) => {
            let targetIndex = null;
            if (event.key === 'ArrowRight') targetIndex = (index + 1) % buttons.length;
            if (event.key === 'ArrowLeft') targetIndex = (index - 1 + buttons.length) % buttons.length;
            if (event.key === 'Home') targetIndex = 0;
            if (event.key === 'End') targetIndex = buttons.length - 1;
            if (targetIndex == null) return;
            event.preventDefault();
            const target = buttons[targetIndex];
            switchAccessPoint(target.dataset.gateway);
            target.focus({ preventScroll: true });
        });
    });
}

function dashboardAccessPointFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('gateway') || params.get('scene') || '';
    if (SCENE_CONFIG[value]) return value;
    return Object.values(SCENE_CONFIG).find((scene) => scene.scene === value)?.id || null;
}

function syncDashboardSceneUrl(snCode) {
    if (!window.history?.replaceState || !SCENE_CONFIG[snCode]) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('gateway') === snCode) return;
    url.searchParams.set('gateway', snCode);
    window.history.replaceState(window.history.state, '', url);
}

function updateHistoryExpandControl(target, count) {
    const button = document.querySelector(`.history-expand-toggle[data-history-target="${target}"]`);
    if (!button) return;
    const card = button.closest('.history-dataset-card');
    const expanded = card?.classList.contains('is-expanded') || false;
    button.hidden = count <= 4;
    button.setAttribute('aria-expanded', String(expanded));
    const label = button.querySelector('span');
    if (label) label.textContent = expanded ? '收起记录' : `查看全部 ${count} 条`;
}

function initHistoryExpansion() {
    document.querySelectorAll('.history-expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const card = button.closest('.history-dataset-card');
            if (!card) return;
            const expanded = card.classList.toggle('is-expanded');
            button.setAttribute('aria-expanded', String(expanded));
            const countId = button.dataset.historyTarget === 'environment'
                ? 'environmentHistoryCount'
                : 'primaryHistoryCount';
            const count = Number(dashboardElement(countId)?.textContent) || 0;
            const label = button.querySelector('span');
            if (label) label.textContent = expanded ? '收起记录' : `查看全部 ${count} 条`;
        });
    });
}

function clampTelemetryScale(value, min = 0.82, max = 1.16) {
    return Math.min(max, Math.max(min, value));
}

function applyTelemetryComposition(width, height) {
    const telemetry = dashboardElement('sceneTelemetry');
    if (!telemetry || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    const aspectRatio = width / Math.max(1, height);
    let layout = 'standard';
    if (width < 540) {
        layout = 'narrow';
    } else if ((width < 720 && aspectRatio < 0.92) || aspectRatio < 0.68) {
        layout = 'portrait';
    } else if (height >= 560 && aspectRatio <= 1.22) {
        layout = 'tall';
    } else if (height < 420 && width >= 820 && aspectRatio > 1.9) {
        layout = 'shallow';
    }

    let density = 'compact';
    if (height >= 720 && layout !== 'shallow') {
        density = 'spacious';
    } else if (height >= 500) {
        density = 'comfortable';
    }

    // Scale spacing and controls within a safe readable range. The layout itself
    // reflows separately, so text is never shrunk to fit an unsuitable shape.
    const widthScale = width / 700;
    const heightScale = height / 520;
    const scale = clampTelemetryScale(Math.min(widthScale, heightScale));

    telemetry.dataset.layout = layout;
    telemetry.dataset.density = density;
    telemetry.style.setProperty('--telemetry-scale', scale.toFixed(3));
}

function initTelemetryCompositionObserver() {
    const telemetry = dashboardElement('sceneTelemetry');
    if (!telemetry) return;

    const syncFromRect = (rect) => applyTelemetryComposition(rect.width, rect.height);
    syncFromRect(telemetry.getBoundingClientRect());

    if (typeof ResizeObserver === 'function') {
        state.telemetryResizeObserver?.disconnect();
        state.telemetryResizeObserver = new ResizeObserver((entries) => {
            const entry = entries.find((item) => item.target === telemetry) || entries[0];
            if (entry) syncFromRect(entry.contentRect);
        });
        state.telemetryResizeObserver.observe(telemetry);
        return;
    }

    window.addEventListener('resize', () => syncFromRect(telemetry.getBoundingClientRect()), { passive: true });
}

function initDashboardBackButton() {
    const button = dashboardElement('pageBackButton');
    if (!button) return;
    button.addEventListener('click', () => {
        const params = new URLSearchParams(window.location.search);
        const returnUrl = params.get('returnUrl') || params.get('from');
        const safeReturnUrl = resolveDashboardReturnUrl(returnUrl);
        if (safeReturnUrl) {
            window.location.assign(safeReturnUrl);
        } else if (window.history.length > 1) {
            window.history.back();
        }
    });
}

window.addEventListener('resize', () => {
    const panel = dashboardElement('emergencyFireAlert');
    if (panel?.classList.contains('show') && emergencyAlertIsMinimized(panel)) {
        syncEmergencyDockPosition(panel);
    }
}, { passive: true });

function resolveDashboardReturnUrl(rawValue) {
    if (!rawValue) return null;
    try {
        const target = new URL(rawValue, window.location.href);
        if (window.location.protocol === 'file:') {
            const localDirectory = new URL('./', window.location.href).href;
            return target.protocol === 'file:' && target.href.startsWith(localDirectory)
                ? target.href
                : null;
        }
        if (!['http:', 'https:'].includes(target.protocol)) return null;
        const configuredOrigins = Array.isArray(window.__DASHBOARD_TRUSTED_RETURN_ORIGINS__)
            ? window.__DASHBOARD_TRUSTED_RETURN_ORIGINS__
            : [];
        const trustedOrigins = new Set([window.location.origin, ...configuredOrigins.map(String)]);
        return trustedOrigins.has(target.origin) ? target.href : null;
    } catch (_error) {
        return null;
    }
}

function startDashboardTimers() {
    state.timers.forEach(window.clearInterval);
    state.timers = [
        window.setInterval(updateDashboardClock, 1000),
        window.setInterval(() => {
            state.refreshCountdown = state.refreshCountdown <= 1
                ? DASHBOARD_REFRESH_SECONDS
                : state.refreshCountdown - 1;
        setDashboardText('refreshCountdown', `${state.refreshCountdown}秒`);
        }, 1000),
        window.setInterval(() => {
            if (document.hidden) return;
            fetchCurrentSceneData({ silent: true });
            fetchInactiveIngestRecord();
            fetchLinkProof();
        }, DASHBOARD_REFRESH_SECONDS * 1000),
    ];
}

async function initSceneDashboard() {
    document.body.classList.add('scene-dashboard-mode');
    document.body.classList.toggle('embedded-view', window.self !== window.top);
    if (EMERGENCY_ALERT_REFRESH_PREVIEW) {
        resetEmergencyRefreshPreview();
    } else {
        state.emergencyIncidents = loadEmergencyIncidents();
    }
    state.currentAccessPoint = dashboardAccessPointFromUrl() || state.currentAccessPoint;
    initDashboardBackButton();
    initSceneSwitching();
    initHistoryExpansion();
    initTelemetryCompositionObserver();
    updateDashboardClock();
    updateSceneStaticUi(currentScene());
    renderSceneWaiting();
    await fetchAccessPoints();
    if (typeof initMap === 'function') initMap();
    await Promise.all([fetchLinkProof(), fetchCurrentSceneData(), fetchInactiveIngestRecord()]);
    await showEmergencyRefreshPreview();
    startDashboardTimers();
    window.setTimeout(() => {
        if (typeof window.invalidateDashboardMapSize === 'function') {
            window.invalidateDashboardMapSize();
        }
    }, 250);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSceneDashboard, { once: true });
} else {
    initSceneDashboard();
}
