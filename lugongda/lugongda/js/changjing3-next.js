/**
 * 智慧门禁演示 - 场景二：应急联动疏散
 * 3路视频联动 + 联动状态总览 + 应急撤离记录
 */

// ==================== 场景二状态管理 ====================
const Scene2State = {
    isRunning: false,
    stepTimers: [],
    evacuateTimer: null,
    evacuateIndex: 0
};

// 模拟撤离人员数据
const EvacuateData = [
    { person: '张伟', device: '笔记本电脑' },
    { person: '李明', device: '平板设备' },
    { person: '王芳', device: '检测仪器' },
    { person: '刘洋', device: '便携工具箱' },
    { person: '陈静', device: '测量设备' },
    { person: '赵强', device: '数据采集器' },
    { person: '周琳', device: '通讯设备' },
    { person: '吴磊', device: '安全检测仪' }
];

// ==================== 工具函数 ====================
function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 8);
}

function formatShortTime() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

// ==================== 联动状态卡片更新 ====================
// 切换状态卡片：activateSecond=true时激活第二个选项，否则激活第一个
function updateStatusCard(cardId, activateSecond = false, time = '') {
    const opt1 = document.getElementById(cardId + '-opt1');
    const opt2 = document.getElementById(cardId + '-opt2');
    const timeEl = document.getElementById(cardId + '-time');
    
    if (opt1 && opt2) {
        if (activateSecond) {
            opt1.classList.remove('active');
            opt2.classList.remove('active');
            opt2.classList.add('triggered');
        } else {
            opt1.classList.add('active');
            opt1.classList.remove('triggered');
            opt2.classList.remove('active', 'triggered');
        }
    }
    if (timeEl) timeEl.textContent = time;
}

function resetAllStatusCards() {
    // 重置所有状态卡片到默认状态（第一个选项激活）
    ['status-fire', 'status-gate', 'status-barrier', 'status-perimeter'].forEach(cardId => {
        const opt1 = document.getElementById(cardId + '-opt1');
        const opt2 = document.getElementById(cardId + '-opt2');
        const timeEl = document.getElementById(cardId + '-time');
        
        if (opt1) {
            opt1.classList.add('active');
            opt1.classList.remove('triggered');
        }
        if (opt2) {
            opt2.classList.remove('active', 'triggered');
        }
        if (timeEl) timeEl.textContent = '';
    });
}

// ==================== 撤离记录管理 ====================
function clearEvacuateList() {
    const list = document.getElementById('s2-evacuate-list');
    if (list) {
        list.innerHTML = '<div class="sf-evacuate-empty">暂无撤离记录</div>';
    }
}

function addEvacuateRecord(person, device) {
    const list = document.getElementById('s2-evacuate-list');
    if (!list) return;
    
    // 移除空状态提示
    const empty = list.querySelector('.sf-evacuate-empty');
    if (empty) empty.remove();
    
    const item = document.createElement('div');
    item.className = 'sf-evacuate-item';
    item.innerHTML = `
        <span class="sf-col-time">${formatShortTime()}</span>
        <span class="sf-col-person">${person}</span>
        <span class="sf-col-device">${device}</span>
        <span class="sf-col-result">应急放行</span>
    `;
    
    // 插入到列表顶部
    list.insertBefore(item, list.firstChild);
    
    // 滚动到顶部
    list.scrollTop = 0;
}


// ==================== 场景二主流程 ====================
function resetScene2() {
    Scene2State.isRunning = false;
    Scene2State.evacuateIndex = 0;
    
    // 清除所有定时器
    Scene2State.stepTimers.forEach(t => clearTimeout(t));
    Scene2State.stepTimers = [];
    if (Scene2State.evacuateTimer) {
        clearInterval(Scene2State.evacuateTimer);
        Scene2State.evacuateTimer = null;
    }
    
    // 重置UI
    resetScene2UI();
}

function resetScene2UI() {
    // 重置联动状态卡片
    resetAllStatusCards();
    
    // 清空撤离记录
    clearEvacuateList();
}

function startScene2Demo() {
    if (Scene2State.isRunning) return;
    Scene2State.isRunning = true;
    Scene2State.evacuateIndex = 0;
    resetScene2UI();
    
    const triggerTime = getCurrentTime();
    
    // 阶段1: 火灾检测触发 (1.5秒后)
    Scene2State.stepTimers.push(setTimeout(() => {
        // 火灾检测：切换到"运行中"
        updateStatusCard('status-fire', true, `触发: ${triggerTime}`);
        
        // 阶段2: 门禁系统切换到应急放行 (再1秒后)
        Scene2State.stepTimers.push(setTimeout(() => {
            updateStatusCard('status-gate', true, getCurrentTime());
            
            // 阶段3: 闸机打开 (再1秒后)
            Scene2State.stepTimers.push(setTimeout(() => {
                updateStatusCard('status-barrier', true, getCurrentTime());
                
                // 阶段4: 周界预警启动 (再1秒后)
                Scene2State.stepTimers.push(setTimeout(() => {
                    updateStatusCard('status-perimeter', true, getCurrentTime());
                    
                    // 开始模拟人员撤离记录 (持续添加)
                    startEvacuateSimulation();
                    
                }, 1000));
            }, 1000));
        }, 1000));
    }, 1500));
}

function startEvacuateSimulation() {
    // 立即添加第一条记录
    if (Scene2State.evacuateIndex < EvacuateData.length) {
        const data = EvacuateData[Scene2State.evacuateIndex++];
        addEvacuateRecord(data.person, data.device);
    }
    
    // 每隔2秒添加一条记录
    Scene2State.evacuateTimer = setInterval(() => {
        if (Scene2State.evacuateIndex < EvacuateData.length) {
            const data = EvacuateData[Scene2State.evacuateIndex++];
            addEvacuateRecord(data.person, data.device);
        } else {
            // 数据用完后停止
            clearInterval(Scene2State.evacuateTimer);
            Scene2State.evacuateTimer = null;
        }
    }, 2000);
}

// ==================== 初始化场景二 ====================
function initScene2() {
    // 统一控制按钮
    document.getElementById('s2-btn-start')?.addEventListener('click', startScene2Demo);
    document.getElementById('s2-btn-stop')?.addEventListener('click', resetScene2);
    
    // 初始化撤离列表为空状态
    clearEvacuateList();
}

// 页面加载后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScene2);
} else {
    initScene2();
}
