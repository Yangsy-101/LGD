/**
 * 网关设备状态信息管理模块
 * 负责设备状态的展示和更新
 */

// 设备配置数据
const deviceConfig = [
    {
        id: 'CAM-001',
        name: '摄像头',
        count: 5,
        connection: 'wifi',
        status: 'online'
    },
    {
        id: 'THS-001',
        name: '温湿度传感器',
        count: 1,
        connection: 'wifi',
        status: 'online'
    },
    {
        id: 'SMK-001',
        name: '烟感传感器',
        count: 1,
        connection: 'wifi',
        status: 'online'
    },
    {
        id: 'WND-001',
        name: '风速计',
        count: 4,
        connection: 'sub1g',
        status: 'online'
    },
    {
        id: 'THS-002',
        name: '温湿度传感器',
        count: 5,
        connection: 'sub1g',
        status: 'online'
    },
    {
        id: 'LIT-001',
        name: '光照传感器',
        count: 7,
        connection: 'ble',
        status: 'online'
    },
    {
        id: 'SND-001',
        name: '响度计',
        count: 3,
        connection: 'ble',
        status: 'offline'
    },
    {
        id: 'HF-001',
        name: 'HF/VHF模块',
        count: 2,
        connection: 'ethernet',
        status: 'online'
    },
    {
        id: 'SAT-001',
        name: '天通模块',
        count: 2,
        connection: 'ethernet',
        status: 'online'
    },
    {
        id: 'EDG-001',
        name: '边缘计算模块',
        count: 3,
        connection: 'ethernet',
        status: 'online'
    }
];

// 连接方式映射
const connectionMap = {
    'wifi': 'WiFi',
    'sub1g': 'Sub-1G',
    'ble': 'BLE',
    'ethernet': '网口'
};

/**
 * 初始化设备状态面板
 */
function initDeviceStatus() {
    const statusBox = document.getElementById('status-box');
    
    if (!statusBox) {
        console.error('未找到 status-box 容器');
        return;
    }

    // 创建整体包装容器
    const wrapper = document.createElement('div');
    wrapper.className = 'device-status-wrapper';

    // 创建固定表头
    const header = createListHeader();
    wrapper.appendChild(header);

    // 创建设备列表容器
    const listContainer = document.createElement('div');
    listContainer.className = 'device-list-container';

    // 生成设备卡片
    deviceConfig.forEach((device, index) => {
        const card = createDeviceCard(device, index);
        listContainer.appendChild(card);
    });

    wrapper.appendChild(listContainer);

    // 添加统计信息
    const stats = createDeviceStats();
    wrapper.appendChild(stats);
    
    // 添加到容器
    statusBox.appendChild(wrapper);
}

/**
 * 创建列表表头
 */
function createListHeader() {
    const header = document.createElement('div');
    header.className = 'device-list-header';

    header.innerHTML = `
        <div class="header-column header-device-name">
            <span>设备名称</span>
        </div>
        <div class="header-column header-count">
            <span>接入数量</span>
        </div>
        <div class="header-column header-connection">
            <span>接入方式</span>
        </div>
        <div class="header-column header-status">
            <span>运行状态</span>
        </div>
    `;

    return header;
}

/**
 * 创建单个设备卡片
 */
// 设备类型颜色指示
const deviceTypeColors = {
    '摄像头': '#ff6b6b',
    '温湿度传感器': '#4ecdc4',
    '烟感传感器': '#ffd93d',
    '风速计': '#a78bfa',
    '光照传感器': '#fbbf24',
    '响度计': '#22d3ee',
    'HF/VHF模块': '#fb923c',
    '天通模块': '#60a5fa',
    '边缘计算模块': '#34d399'
};

function createDeviceCard(device, index) {
    const card = document.createElement('div');
    card.className = 'device-card';
    card.style.animationDelay = `${index * 0.03}s`;
    card.dataset.deviceId = device.id;

    const statusText = device.status === 'online' ? '正常' : '故障';
    const dotColor = deviceTypeColors[device.name] || '#00eaff';

    card.innerHTML = `
        <div class="device-name-area">
            <span class="device-type-dot" style="background:${dotColor};box-shadow:0 0 6px ${dotColor};"></span>
            <span class="device-name">${device.name}</span>
        </div>
        <div class="device-count-area">
            <span class="device-count">${device.count}</span>
        </div>
        <div class="device-connection-area">
            <div class="connection-tag ${device.connection}">
                ${connectionMap[device.connection]}
            </div>
        </div>
        <div class="device-status-area">
            <div class="status-indicator ${device.status}"></div>
            <div class="status-label ${device.status}">${statusText}</div>
        </div>
    `;

    card.addEventListener('click', () => {
        console.log('设备详情:', device);
    });

    return card;
}

/**
 * 创建设备统计信息
 */
function createDeviceStats() {
    const statsContainer = document.createElement('div');
    statsContainer.className = 'device-stats';

    const totalDevices = deviceConfig.length;
    const onlineDevices = deviceConfig.filter(d => d.status === 'online').length;
    const offlineDevices = totalDevices - onlineDevices;

    statsContainer.innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${totalDevices}</div>
            <div class="stat-label">总设备数</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" style="color: #00ff88;">${onlineDevices}</div>
            <div class="stat-label">在线</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" style="color: #ff3366;">${offlineDevices}</div>
            <div class="stat-label">离线</div>
        </div>
    `;

    return statsContainer;
}

/**
 * 更新设备状态（实时更新接口）
 * @param {string} deviceId - 设备ID
 * @param {Object} updates - 更新的属性
 */
function updateDeviceStatus(deviceId, updates) {
    const device = deviceConfig.find(d => d.id === deviceId);
    if (!device) {
        console.error('设备不存在:', deviceId);
        return;
    }

    // 更新数据
    Object.assign(device, updates);

    // 重新渲染（简单实现，可优化为局部更新）
    const statusBox = document.getElementById('status-box');
    if (statusBox) {
        statusBox.innerHTML = '';
        initDeviceStatus();
    }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeviceStatus);
} else {
    initDeviceStatus();
}

// 导出接口供外部使用
window.DeviceStatusAPI = {
    updateDeviceStatus,
    getDeviceConfig: () => deviceConfig
};
