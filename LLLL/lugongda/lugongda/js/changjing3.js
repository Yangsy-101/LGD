/**
 * 智慧门禁演示 - 场景一：人员-设备分级通行管控
 */

// ==================== 状态管理 ====================
const DemoState = {
    currentScene: 'scene1',
    
    // 场景一状态
    scene1: {
        isDetecting: false,
        detectTimer: null,
        currentPerson: null,
        currentDevice: null,
        verdict: null,
        totals: {
            totalPass: 0,
            totalBlock: 0,
            totalAlert: 0
        }
    }
};

function initScene1TotalsFromStorage() {
    try {
        const raw = localStorage.getItem('smart_factory_snapshot') || '';
        const snap = raw ? JSON.parse(raw) : null;
        if (snap && snap.totals) {
            DemoState.scene1.totals.totalPass = Number(snap.totals.totalPass) || 0;
            DemoState.scene1.totals.totalBlock = Number(snap.totals.totalBlock) || 0;
            DemoState.scene1.totals.totalAlert = Number(snap.totals.totalAlert) || 0;
        }
    } catch (e) {
        // ignore
    }
}

function writeSmartFactorySnapshot(person, device, verdict) {
    try {
        const totals = DemoState.scene1.totals;

        if (verdict && typeof verdict.pass === 'boolean') {
            if (verdict.pass) {
                totals.totalPass += 1;
            } else {
                // 简单告警规则：拦截中，如果设备等级为高则记为“告警”，否则记为“拦截”
                if (device && device.level === 'high') totals.totalAlert += 1;
                else totals.totalBlock += 1;
            }
        }

        const denom = totals.totalPass + totals.totalBlock + totals.totalAlert;
        const passRate = denom <= 0 ? 0 : Math.round((totals.totalPass / denom) * 100);

        const snap = {
            ts: Date.now(),
            totals: {
                totalPass: totals.totalPass,
                totalBlock: totals.totalBlock,
                totalAlert: totals.totalAlert,
                passRate
            },
            current: {
                person: person || null,
                device: device || null,
                verdict: verdict || null
            }
        };

        localStorage.setItem('smart_factory_snapshot', JSON.stringify(snap));
    } catch (e) {
        // ignore
    }
}

// 模拟数据库
const PersonDB = [
    { name: '张三', id: 'EMP-001', level: 'high', levelText: '高' },
    { name: '李四', id: 'EMP-002', level: 'mid', levelText: '中' },
    { name: '王五', id: 'EMP-003', level: 'low', levelText: '低' },
    { name: '赵六', id: 'EMP-004', level: 'high', levelText: '高' },
    { name: '钱七', id: 'EMP-005', level: 'low', levelText: '低' },
    { name: '孙八', id: 'EMP-006', level: 'mid', levelText: '中' },
    { name: '周九', id: 'EMP-007', level: 'high', levelText: '高' },
    { name: '吴十', id: 'EMP-008', level: 'low', levelText: '低' },
    { name: '郑明', id: 'EMP-009', level: 'mid', levelText: '中' },
    { name: '陈华', id: 'EMP-010', level: 'high', levelText: '高' }
];

const DeviceDB = [
    { id: 'DEV-A01', type: '精密仪器', level: 'high', levelText: '高' },
    { id: 'DEV-B02', type: '普通设备', level: 'mid', levelText: '中' },
    { id: 'DEV-C03', type: '办公用品', level: 'low', levelText: '低' },
    { id: 'DEV-D04', type: '机密文件', level: 'high', levelText: '高' },
    { id: 'DEV-E05', type: '工具箱', level: 'low', levelText: '低' },
    { id: 'DEV-F06', type: '检测设备', level: 'mid', levelText: '中' },
    { id: 'DEV-G07', type: '实验器材', level: 'high', levelText: '高' },
    { id: 'DEV-H08', type: '维修工具', level: 'low', levelText: '低' },
    { id: 'DEV-I09', type: '通信设备', level: 'mid', levelText: '中' },
    { id: 'DEV-J10', type: '核心组件', level: 'high', levelText: '高' }
];

// ==================== 工具函数 ====================
function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomConfidence() {
    return (85 + Math.random() * 14).toFixed(1);
}

// 规则判定：人员等级是否可携带设备等级
function checkAccessRule(personLevel, deviceLevel) {
    const levelOrder = { high: 3, mid: 2, low: 1 };
    const pLevel = levelOrder[personLevel] || 0;
    const dLevel = levelOrder[deviceLevel] || 0;
    
    // 高等级人员可携带任意设备
    if (pLevel === 3) return { pass: true, rule: '高等级人员 → 可携带任意设备' };
    // 中等级人员可携带中/低设备
    if (pLevel === 2 && dLevel <= 2) return { pass: true, rule: '中等级人员 → 可携带中/低设备' };
    // 低等级人员只能携带低等级设备
    if (pLevel === 1 && dLevel === 1) return { pass: true, rule: '低等级人员 → 可携带低等级设备' };
    
    return { pass: false, rule: '低等级人员 → 禁止携带中/高设备' };
}

// ==================== 时间显示 ====================
function updateCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeText = `${hours}:${minutes}:${seconds}`;
    
    const timeEl = document.querySelector('#sf-current-time .sf-time-text');
    if (timeEl) timeEl.textContent = timeText;
}

// ==================== 场景切换 ====================
function switchScene(sceneId) {
    DemoState.currentScene = sceneId;
    
    // 切换标签页激活状态
    document.querySelectorAll('.sf-scene-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.scene === sceneId);
    });
    
    // 切换场景容器显示
    document.querySelectorAll('.sf-scene-container').forEach(container => {
        container.classList.toggle('active', container.id === sceneId);
    });
    
    // 重置场景状态
    if (sceneId === 'scene1') {
        resetScene1();
        startScene1Detection();
    } else if (typeof resetScene2 === 'function') {
        resetScene2();
    }
}

// ==================== 场景一：分级通行管控 ====================
function resetScene1() {
    DemoState.scene1.isDetecting = false;
    if (DemoState.scene1.detectTimer) {
        clearInterval(DemoState.scene1.detectTimer);
        DemoState.scene1.detectTimer = null;
    }
    updateScene1UI(null, null, null);
}

function startScene1Detection() {
    if (DemoState.scene1.isDetecting) return;
    DemoState.scene1.isDetecting = true;
    
    // 模拟检测过程
    simulateDetection();
    
    // 定时模拟新的检测
    DemoState.scene1.detectTimer = setInterval(simulateDetection, 5000);
}

function stopScene1Detection() {
    DemoState.scene1.isDetecting = false;
    if (DemoState.scene1.detectTimer) {
        clearInterval(DemoState.scene1.detectTimer);
        DemoState.scene1.detectTimer = null;
    }
}

function simulateDetection() {
    // 随机选择人员和设备
    const person = getRandomItem(PersonDB);
    const device = getRandomItem(DeviceDB);
    const confidence = getRandomConfidence();
    
    DemoState.scene1.currentPerson = { ...person, confidence };
    DemoState.scene1.currentDevice = { ...device, status: '读取成功' };
    
    // 判定规则
    const result = checkAccessRule(person.level, device.level);
    DemoState.scene1.verdict = result;
    
    // 更新UI
    updateScene1UI(DemoState.scene1.currentPerson, DemoState.scene1.currentDevice, result);

    // 写入主页面联动快照（用于 main.html 概览面板）
    writeSmartFactorySnapshot(DemoState.scene1.currentPerson, DemoState.scene1.currentDevice, result);

    // 高亮数据库中匹配的人员和设备
    highlightCurrentMatch(person.name, device.id);

    // 写入检测日志
    appendScene1Log(DemoState.scene1.currentPerson, DemoState.scene1.currentDevice, result);
}

function appendScene1Log(person, device, verdict) {
    const container = document.getElementById('s1-log-container');
    if (!container) return;

    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const timeText = `${h}:${m}:${s}`;

    const personText = person ? `${person.name}(${person.levelText})` : '--';
    const deviceText = device ? `${device.type}(${device.levelText})` : '--';
    const verdictText = verdict ? (verdict.pass ? '通过' : '拦截') : '等待';

    const log = document.createElement('div');
    log.className = 'sf-log-item' + (verdict ? (verdict.pass ? ' log-success' : ' log-error') : '');
    log.textContent = `[${timeText}] 人员：${personText} | 设备：${deviceText} | 结果：${verdictText}`;

    container.insertBefore(log, container.firstChild);

    const maxItems = 5;
    while (container.children.length > maxItems) {
        container.removeChild(container.lastChild);
    }
}

function showScene1Result() {
    if (!DemoState.scene1.currentPerson) {
        simulateDetection();
    }
}

function updateScene1UI(person, device, verdict) {
    // 人脸识别结果
    const nameEl = document.getElementById('s1-person-name');
    const idEl = document.getElementById('s1-person-id');
    const levelEl = document.getElementById('s1-person-level');
    const confEl = document.getElementById('s1-person-conf');
    
    if (nameEl) nameEl.textContent = person ? person.name : '--';
    if (idEl) idEl.textContent = person ? person.id : '--';
    if (levelEl) {
        levelEl.textContent = person ? person.levelText : '--';
        levelEl.className = 'sf-result-value sf-level-badge' + (person ? ` level-${person.level}` : '');
    }
    if (confEl) confEl.textContent = person ? `${person.confidence}%` : '--%';
    
    // RFID设备结果
    const devIdEl = document.getElementById('s1-device-id');
    const devTypeEl = document.getElementById('s1-device-type');
    const devLevelEl = document.getElementById('s1-device-level');
    const devStatusEl = document.getElementById('s1-device-status');
    
    if (devIdEl) devIdEl.textContent = device ? device.id : '--';
    if (devTypeEl) devTypeEl.textContent = device ? device.type : '--';
    if (devLevelEl) {
        devLevelEl.textContent = device ? device.levelText : '--';
        devLevelEl.className = 'sf-result-value sf-level-badge' + (device ? ` level-${device.level}` : '');
    }
    if (devStatusEl) {
        devStatusEl.textContent = device ? device.status : '--';
        devStatusEl.className = 'sf-result-value sf-read-status' + (device ? ' status-ok' : '');
    }
    
    // 规则匹配
    const ruleMatchEl = document.getElementById('s1-rule-match');
    if (ruleMatchEl) {
        const spanEl = ruleMatchEl.querySelector('span');
        if (spanEl) spanEl.textContent = verdict ? verdict.rule : '--';
    }
    
    // 最终判定
    const verdictEl = document.getElementById('s1-verdict');
    const reasonEl = document.getElementById('s1-verdict-reason');
    
    if (verdictEl) {
        if (!verdict) {
            verdictEl.className = 'sf-verdict-result';
            verdictEl.innerHTML = '<span class="sf-verdict-icon">—</span><span class="sf-verdict-text">等待检测</span>';
        } else if (verdict.pass) {
            verdictEl.className = 'sf-verdict-result verdict-pass';
            verdictEl.innerHTML = '<span class="sf-verdict-icon">✓</span><span class="sf-verdict-text">允许通行</span>';
        } else {
            verdictEl.className = 'sf-verdict-result verdict-deny';
            verdictEl.innerHTML = '<span class="sf-verdict-icon">✕</span><span class="sf-verdict-text">拦截报警</span>';
        }
    }
    
    if (reasonEl) {
        if (!verdict) {
            reasonEl.textContent = '--';
        } else if (verdict.pass) {
            reasonEl.textContent = '人员与设备等级匹配，允许通行';
        } else {
            reasonEl.textContent = `${person?.levelText || '低'}等级人员携带${device?.levelText || '高'}等级设备`;
        }
    }
}

// ==================== 数据库滚动列表 ====================
let dbScrollIndex = { person: 0, device: 0 };

function renderDatabaseLists() {
    const personContainer = document.getElementById('person-db-scroll');
    const deviceContainer = document.getElementById('device-db-scroll');
    
    if (personContainer) {
        personContainer.innerHTML = PersonDB.map((p, i) => `
            <div class="sf-db-item" data-index="${i}">
                <span class="sf-db-name">${p.name}</span>
                <span class="sf-db-id">${p.id}</span>
                <span class="sf-db-level level-${p.level}">${p.levelText}</span>
            </div>
        `).join('');
    }
    
    if (deviceContainer) {
        deviceContainer.innerHTML = DeviceDB.map((d, i) => `
            <div class="sf-db-item" data-index="${i}">
                <span class="sf-db-name">${d.type}</span>
                <span class="sf-db-id">${d.id}</span>
                <span class="sf-db-level level-${d.level}">${d.levelText}</span>
            </div>
        `).join('');
    }
}

function highlightCurrentMatch(personName, deviceId) {
    const personScroll = document.getElementById('person-db-scroll');
    const deviceScroll = document.getElementById('device-db-scroll');
    
    // 高亮当前匹配的人员并滚动到可见位置
    document.querySelectorAll('#person-db-scroll .sf-db-item').forEach(item => {
        const name = item.querySelector('.sf-db-name')?.textContent;
        const isMatch = name === personName;
        item.classList.toggle('active', isMatch);
        if (isMatch && personScroll) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
    
    // 高亮当前匹配的设备并滚动到可见位置
    document.querySelectorAll('#device-db-scroll .sf-db-item').forEach(item => {
        const id = item.querySelector('.sf-db-id')?.textContent;
        const isMatch = id === deviceId;
        item.classList.toggle('active', isMatch);
        if (isMatch && deviceScroll) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}

// ==================== 初始化 ====================
function initSmartFactoryDemo() {
    initScene1TotalsFromStorage();

    // 启动时间显示
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    // 渲染数据库列表
    renderDatabaseLists();
    
    // 场景切换
    document.querySelectorAll('.sf-scene-tab').forEach(tab => {
        tab.addEventListener('click', () => switchScene(tab.dataset.scene));
    });
    
    // 场景一按钮
    document.getElementById('s1-btn-start')?.addEventListener('click', startScene1Detection);
    document.getElementById('s1-btn-result')?.addEventListener('click', showScene1Result);
    document.getElementById('s1-btn-stop')?.addEventListener('click', stopScene1Detection);

    startScene1Detection();
}

// 页面加载后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSmartFactoryDemo);
} else {
    initSmartFactoryDemo();
}
