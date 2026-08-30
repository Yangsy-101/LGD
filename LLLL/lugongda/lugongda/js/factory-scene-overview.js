/**
 * 工厂场景概览数据更新模块
 * 在主页面显示两个场景的简要信息
 */

// 模拟数据更新
function updateFactorySceneData() {
    // 应急救援场景数据
    const fireStatusEl = document.getElementById('fire-status');
    const linkageStatusEl = document.getElementById('linkage-status');
    const deviceStatusEl = document.getElementById('device-status');

    if (fireStatusEl) {
        fireStatusEl.textContent = '已开启';
        fireStatusEl.style.color = '#00eaff';
    }

    if (linkageStatusEl) {
        linkageStatusEl.textContent = '已开启';
        linkageStatusEl.style.color = '#00eaff';
    }

    if (deviceStatusEl) {
        deviceStatusEl.textContent = '待机中';
        deviceStatusEl.style.color = '#00eaff';
    }
    
    // 设备人员管控场景数据
    const personCountEl = document.getElementById('person-count');
    const deviceCountEl = document.getElementById('device-count');
    const warningStatusEl = document.getElementById('warning-status');

    if (personCountEl) {
        personCountEl.textContent = '10 人';
        personCountEl.style.color = '#00eaff';
    }

    if (deviceCountEl) {
        deviceCountEl.textContent = '10 台';
        deviceCountEl.style.color = '#00eaff';
    }

    if (warningStatusEl) {
        warningStatusEl.textContent = '已开启';
        warningStatusEl.style.color = '#00eaff';
    }
}

// 初始化
function initFactorySceneOverview() {
    // 立即更新一次
    updateFactorySceneData();
    
    // 每2秒更新一次数据
    setInterval(updateFactorySceneData, 2000);
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFactorySceneOverview);
} else {
    initFactorySceneOverview();
}
