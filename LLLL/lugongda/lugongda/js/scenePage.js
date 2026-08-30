/**
 * 场景页面通用功能模块
 * 提供返回主页、数据接口等通用功能
 */

/**
 * 初始化场景页面
 */
function initScenePage() {
    // 可以在这里添加场景页面的通用初始化逻辑
    console.log('场景页面已加载');

    // 子场景先把自身画面和脚本跑稳，再在空闲时预取主页面，避免进入子页面时抢占带宽。
    scheduleMainPrefetch();
    
    initScreenScale();

    // 为返回按钮添加点击事件
    initBackButton();
}

function initScreenScale() {
    const BASE_WIDTH = 1920;
    const BASE_HEIGHT = 1080;

    function applyScreenScale() {
        const root = document.getElementById('screen-root');
        if (!root) return;

        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        const scale = Math.min(vw / BASE_WIDTH, vh / BASE_HEIGHT);
        const offsetX = Math.round((vw - BASE_WIDTH * scale) / 2);
        const offsetY = Math.round((vh - BASE_HEIGHT * scale) / 2);

        root.style.transform = 'none';
        root.style.left = `${offsetX}px`;
        root.style.top = `${offsetY}px`;
        root.style.zoom = scale;
    }

    window.addEventListener('resize', applyScreenScale);
    applyScreenScale();
}

function scheduleMainPrefetch() {
    const run = () => {
        if (document.querySelector('link[data-main-prefetch="1"]')) return;
        const prefetch = document.createElement('link');
        prefetch.rel = 'prefetch';
        prefetch.href = '../main.html';
        prefetch.as = 'document';
        prefetch.dataset.mainPrefetch = '1';
        document.head.appendChild(prefetch);
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 5000 });
    } else {
        window.setTimeout(run, 5000);
    }
}

/**
 * 初始化返回按钮
 */
function initBackButton() {
    const backButton = document.querySelector('.back-button');
    
    if (backButton) {
        backButton.addEventListener('click', (e) => {
            e.preventDefault();
            goBackToMain();
        });
    }
}

/**
 * 返回主页面
 */
function goBackToMain() {
    // 优先回退历史记录，命中浏览器缓存时返回更快
    const ref = document.referrer || '';
    if (ref.includes('/main.html') || ref.endsWith('main.html')) {
        window.history.back();
        return;
    }

    // 无历史记录时回退到主页面
    window.location.href = '../main.html';
}

/**
 * 数据可视化接口
 * 外部可以调用此函数向页面添加可视化内容
 * 
 * @param {string} containerId - 容器ID
 * @param {HTMLElement|string} content - 要添加的内容（DOM元素或HTML字符串）
 */
function renderVisualization(containerId, content) {
    const container = document.getElementById(containerId);
    
    if (!container) {
        console.error(`未找到容器: ${containerId}`);
        return;
    }
    
    // 清空占位内容
    container.innerHTML = '';
    
    // 添加新内容
    if (typeof content === 'string') {
        container.innerHTML = content;
    } else {
        container.appendChild(content);
    }
}

/**
 * 示例：添加图表数据的接口函数
 * 
 * @param {string} containerId - 容器ID
 * @param {Object} chartConfig - 图表配置对象
 */
function addChart(containerId, chartConfig) {
    // 这里可以集成 ECharts、Chart.js 等图表库
    console.log('添加图表到容器:', containerId, chartConfig);
    
    // 示例：创建一个简单的数据展示
    const chartElement = document.createElement('div');
    chartElement.style.width = '100%';
    chartElement.style.height = '100%';
    chartElement.innerHTML = `
        <div style="padding: 20px; color: #fff;">
            <h3 style="color: var(--theme-color);">图表区域</h3>
            <p>可在此处集成 ECharts、D3.js 等可视化库</p>
        </div>
    `;
    
    renderVisualization(containerId, chartElement);
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScenePage);
} else {
    initScenePage();
}

// 导出接口供外部使用
window.ScenePageAPI = {
    renderVisualization,
    addChart,
    goBackToMain
};
