/**
 * 森林火灾及气象场景 - 主页面概览模块
 * 在主大屏上显示简洁的监控概览
 */

// 当前状态管理
const ForestOverviewState = {
    currentRegion: 'nanjing',
    alertLevel: 'low',
    commStatus: {
        g5: true,
        shortwave: false,
        tianqi: false
    }
};

// 模拟传感器数据生成
function generateRealtimeData() {
    const isHaikou = ForestOverviewState.currentRegion === 'haikou';
    return {
        temperature: isHaikou ? (28 + Math.random() * 6).toFixed(1) : (12 + Math.random() * 5).toFixed(1),
        humidity: isHaikou ? (70 + Math.random() * 15).toFixed(1) : (55 + Math.random() * 15).toFixed(1),
        smoke: (20 + Math.random() * 15).toFixed(1),
        windSpeed: (1.5 + Math.random() * 4).toFixed(1),
        light: isHaikou ? Math.floor(7000 + Math.random() * 4000) : Math.floor(5000 + Math.random() * 3000),
        region: isHaikou ? '海口' : '南京溧水'
    };
}

// 初始化森林火灾概览面板
function initForestFireOverview() {
    const container = document.getElementById('forest-fire-box');
    if (!container) return;

    // 创建概览HTML结构
    container.innerHTML = `
        <div class="forest-overview">
            <!-- 顶部状态栏 -->
            <div class="overview-status-bar">
                <div class="status-item">
                    <span class="status-label">监控区域</span>
                    <div class="region-toggle" id="region-toggle">
                        <button class="region-btn active" id="btn-region-nanjing">南京溧水</button>
                    </div>
                </div>
                <div class="status-item">
                    <span class="status-label">系统状态</span>
                    <span class="status-value status-online">运行中</span>
                </div>
            </div>

            <!-- 火情告警指示器与等级 -->
            <div class="fire-alert-section">
                <div class="alert-circle" id="alert-circle">
                    <div class="alert-ring"></div>
                    <div class="alert-center">
                        <span class="alert-icon">🔥</span>
                        <span class="alert-text" id="alert-text">正常</span>
                    </div>
                </div>
                <div class="alert-level-box" id="alert-level-box">
                    <div class="alert-level-title">预警等级</div>
                    <div class="alert-level-indicator" id="alert-level-indicator">
                        <span class="level-dot level-low active"></span>
                        <span class="level-dot level-medium"></span>
                        <span class="level-dot level-high"></span>
                    </div>
                    <div class="alert-level-text" id="alert-level-text">低风险</div>
                </div>
            </div>

            <!-- 实时数据卡片 - 第一行 -->
            <div class="overview-data-cards">
                <div class="data-card card-temp">
                    <div class="card-content">
                        <div class="card-label">温度</div>
                        <div class="card-value">
                            <span id="temp-value">--</span>
                            <span class="card-unit">°C</span>
                        </div>
                    </div>
                </div>

                <div class="data-card card-humidity">
                    <div class="card-content">
                        <div class="card-label">湿度</div>
                        <div class="card-value">
                            <span id="humidity-value">--</span>
                            <span class="card-unit">%</span>
                        </div>
                    </div>
                </div>

                <div class="data-card card-smoke">
                    <div class="card-content">
                        <div class="card-label">烟感</div>
                        <div class="card-value">
                            <span id="smoke-value">--</span>
                            <span class="card-unit">μg/m³</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 实时数据卡片 - 第二行 -->
            <div class="overview-data-cards">
                <div class="data-card card-wind">
                    <div class="card-content">
                        <div class="card-label">风速</div>
                        <div class="card-value">
                            <span id="wind-value">--</span>
                            <span class="card-unit">m/s</span>
                        </div>
                    </div>
                </div>

                <div class="data-card card-light">
                    <div class="card-content">
                        <div class="card-label">光照</div>
                        <div class="card-value">
                            <span id="light-value">--</span>
                            <span class="card-unit">Lux</span>
                        </div>
                    </div>
                </div>

                <div class="data-card card-camera">
                    <div class="card-content">
                        <div class="card-label">摄像头</div>
                        <div class="card-value">
                            <span id="camera-count">1个</span>
                            <span class="card-unit">在线</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 通信状态指示器 -->
            <div class="comm-status-bar">
                <div class="comm-title">通信链路</div>
                <div class="comm-items">
                    <button class="comm-btn comm-online" id="comm-5g">
                        <span class="comm-dot"></span>
                        <span class="comm-name">5G</span>
                    </button>
                    <button class="comm-btn comm-offline" id="comm-shortwave">
                        <span class="comm-dot"></span>
                        <span class="comm-name">短波</span>
                    </button>
                    <button class="comm-btn comm-offline" id="comm-tianqi">
                        <span class="comm-dot"></span>
                        <span class="comm-name">天启卫星</span>
                    </button>
                </div>
            </div>

        </div>
    `;

    // 绑定事件
    initOverviewEvents();
    
    // 启动数据更新
    updateForestData();
    setInterval(updateForestData, 3000); // 每3秒更新一次
}

// 初始化事件绑定
function initOverviewEvents() {
    // 地区切换按钮
    const btnHaikou = document.getElementById('btn-region-haikou');
    const btnNanjing = document.getElementById('btn-region-nanjing');
    
    if (btnHaikou) {
        btnHaikou.addEventListener('click', (e) => {
            e.stopPropagation();
            switchRegion('haikou');
        });
    }
    if (btnNanjing) {
        btnNanjing.addEventListener('click', (e) => {
            e.stopPropagation();
            switchRegion('nanjing');
        });
    }
    
    // 通信链路按钮
    const comm5g = document.getElementById('comm-5g');
    const commShortwave = document.getElementById('comm-shortwave');

    if (comm5g) {
        comm5g.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCommStatus('g5');
        });
    }
    if (commShortwave) {
        commShortwave.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCommStatus('shortwave');
        });
    }
    const commTianqi = document.getElementById('comm-tianqi');
    if (commTianqi) {
        commTianqi.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCommStatus('tianqi');
        });
    }
}

// 切换地区
function switchRegion(region) {
    ForestOverviewState.currentRegion = region;
    
    const btnHaikou = document.getElementById('btn-region-haikou');
    const btnNanjing = document.getElementById('btn-region-nanjing');
    
    if (region === 'haikou') {
        btnHaikou?.classList.add('active');
        btnNanjing?.classList.remove('active');
    } else {
        btnHaikou?.classList.remove('active');
        btnNanjing?.classList.add('active');
    }
    
    // 立即更新数据
    updateForestData();
}

// 切换通信状态
function toggleCommStatus(type) {
    ForestOverviewState.commStatus[type] = !ForestOverviewState.commStatus[type];

    var elementId;
    if (type === 'g5') elementId = 'comm-5g';
    else if (type === 'shortwave') elementId = 'comm-shortwave';
    else elementId = 'comm-tianqi';
    const element = document.getElementById(elementId);

    if (element) {
        if (ForestOverviewState.commStatus[type]) {
            element.classList.add('comm-online');
            element.classList.remove('comm-offline');
        } else {
            element.classList.remove('comm-online');
            element.classList.add('comm-offline');
        }
    }
}

// 更新森林火灾数据
function updateForestData() {
    const data = generateRealtimeData();

    // 更新数值
    const tempValue = document.getElementById('temp-value');
    const humidityValue = document.getElementById('humidity-value');
    const smokeValue = document.getElementById('smoke-value');
    const windValue = document.getElementById('wind-value');
    const lightValue = document.getElementById('light-value');
    const alertCircle = document.getElementById('alert-circle');
    const alertText = document.getElementById('alert-text');
    const lastUpdate = document.getElementById('last-update');

    if (tempValue) tempValue.textContent = data.temperature;
    if (humidityValue) humidityValue.textContent = data.humidity;
    if (smokeValue) smokeValue.textContent = data.smoke;
    if (windValue) windValue.textContent = data.windSpeed;
    if (lightValue) lightValue.textContent = data.light;

    // 更新时间
    if (lastUpdate) {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        lastUpdate.textContent = `最后更新: ${timeStr}`;
    }

    // 固定预警等级为低风险
    ForestOverviewState.alertLevel = 'low';

    // 更新预警等级和火焰图标
    updateAlertLevel(ForestOverviewState.alertLevel);
    updateFireIcon(ForestOverviewState.alertLevel);

    // 添加数值变化动画
    [tempValue, humidityValue, smokeValue, windValue, lightValue].forEach(el => {
        if (el) {
            el.style.transform = 'scale(1.1)';
            setTimeout(() => {
                el.style.transform = 'scale(1)';
            }, 200);
        }
    });
}

// 更新火焰图标状态（与预警等级联动）
function updateFireIcon(level) {
    const alertCircle = document.getElementById('alert-circle');
    const alertText = document.getElementById('alert-text');
    
    if (!alertCircle || !alertText) return;
    
    // 移除所有等级类
    alertCircle.classList.remove('alert-low', 'alert-medium', 'alert-high');
    
    if (level === 'low') {
        alertCircle.classList.add('alert-low');
        alertText.textContent = '正常';
    } else if (level === 'medium') {
        alertCircle.classList.add('alert-medium');
        alertText.textContent = '警告';
    } else if (level === 'high') {
        alertCircle.classList.add('alert-high');
        alertText.textContent = '危险';
    }
}

// 更新预警等级显示
function updateAlertLevel(level) {
    const dots = document.querySelectorAll('.level-dot');
    const levelText = document.getElementById('alert-level-text');
    const levelBox = document.getElementById('alert-level-box');
    
    if (!dots.length || !levelText) return;
    
    // 移除所有active类
    dots.forEach(dot => dot.classList.remove('active'));
    levelBox.classList.remove('level-low', 'level-medium', 'level-high');
    
    if (level === 'low') {
        dots[0].classList.add('active');
        levelText.textContent = '低风险';
        levelBox.classList.add('level-low');
    } else if (level === 'medium') {
        dots[0].classList.add('active');
        dots[1].classList.add('active');
        levelText.textContent = '中风险';
        levelBox.classList.add('level-medium');
    } else if (level === 'high') {
        dots.forEach(dot => dot.classList.add('active'));
        levelText.textContent = '高风险';
        levelBox.classList.add('level-high');
    }
}


// 页面加载后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initForestFireOverview);
} else {
    initForestFireOverview();
}
