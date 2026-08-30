/**
 * 场景标题交互管理模块
 * 负责场景标题的点击跳转功能
 */

// 场景配置数据
const sceneConfig = {
    'forest': {
        url: 'scenes/forest-fire2.html'
    },
    'ocean': {
        url: 'scenes/ocean-iot2.html'
    }
};

/**
 * 初始化场景标题点击事件
 */
function initSceneInteractions() {
    // 获取所有带有 data-scene 属性的场景面板
    const scenePanels = document.querySelectorAll('.scene-panel');
    
    scenePanels.forEach(panel => {
        const sceneKey = panel.getAttribute('data-scene');
        const titleElement = panel.querySelector('.clickable-title');
        
        if (sceneKey && sceneConfig[sceneKey] && titleElement) {
            // 添加点击事件
            titleElement.addEventListener('click', () => {
                handleSceneClick(sceneConfig[sceneKey], titleElement);
            });
            
            // 添加悬停效果提示
            titleElement.title = "点击进入场景演示";
        }
    });

    // 为工厂场景的两个子标题添加点击事件（只有标题头部可点击）
    const factorySceneHeaders = document.querySelectorAll('.scene-item-header.clickable-scene-title');
    factorySceneHeaders.forEach(headerElement => {
        const sceneUrl = headerElement.getAttribute('data-scene-url');
        if (sceneUrl) {
            headerElement.addEventListener('click', () => {
                handleSceneClick({ url: sceneUrl }, headerElement);
            });
            headerElement.title = "点击进入场景演示";
        }
    });
}

/**
 * 处理场景点击跳转
 */
function handleSceneClick(scene, element) {
    console.log(`跳转到场景URL: ${scene.url}`);
    
    // 保留轻量点击反馈，但不人为延迟跳转
    element.style.transform = 'scale(0.98)';
    element.style.color = '#00eaff';
    window.location.href = scene.url;
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSceneInteractions);
} else {
    initSceneInteractions();
}
