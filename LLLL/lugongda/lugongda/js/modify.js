/**
 * 火灾检测数据 - 双视图切换模块
 *
 * 仅保留两个视图页面：
 *   1. capture - 实时火灾截图（默认）
 *   2. table   - 检测数据表格（底部首按钮切换）
 */

(function() {
    'use strict';

    // 当前视图: 'capture' | 'table'
    let currentView = 'capture';

    /**
     * 初始化
     */
    function initViewToggle() {
        const capturePanel = document.querySelector('.yjy-capture-panel');
        if (!capturePanel) return;

        // 1. 视图结构
        const panelContent = capturePanel.querySelector('.yjy-panel-content');
        if (panelContent) {
            setupViewStructure(panelContent);
        }

        // 默认显示 capture
        showView('capture');
    }

    /* ========== 视图结构 ========== */
    function setupViewStructure(panelContent) {
        const captureLayout = panelContent.querySelector('.yjy-capture-layout');
        if (!captureLayout) return;

        const captureStage = captureLayout.querySelector('.yjy-capture-stage');
        if (!captureStage) return;

        // 视图总容器
        const viewContainer = document.createElement('div');
        viewContainer.className = 'capture-view-container';

        // 视图1: 实时截图（移入原有内容）
        const captureView = document.createElement('div');
        captureView.className = 'capture-view-page active';
        captureView.id = 'capture-view-capture';
        while (captureStage.firstChild) {
            captureView.appendChild(captureStage.firstChild);
        }

        // 视图2: 检测数据表格
        const tableView = document.createElement('div');
        tableView.className = 'capture-view-page';
        tableView.id = 'capture-view-table';
        tableView.innerHTML = createTableViewHTML();

        viewContainer.appendChild(captureView);
        viewContainer.appendChild(tableView);

        captureStage.appendChild(viewContainer);
    }

    /* ========== 视图2: 检测数据表格 HTML ========== */
    function createTableViewHTML() {
        return `
            <div class="data-table-container">
                <table class="data-table" id="fire-data-table">
                    <thead>
                        <tr>
                            <th>序号</th>
                            <th>检测时间</th>
                            <th>火灾类型</th>
                            <th>置信度</th>
                            <th>位置</th>
                            <th>状态</th>
                        </tr>
                    </thead>
                    <tbody id="fire-data-tbody">
                    </tbody>
                </table>
                <div class="table-empty-hint" id="table-empty-hint">
                    <div class="table-empty-icon">📊</div>
                    <div>暂无检测数据</div>
                    <div style="font-size: 12px; margin-top: 5px;">数据将在后期添加</div>
                </div>
            </div>
        `;
    }

    /* ========== 核心：切换视图 ========== */
    function showView(viewType) {
        const views = {
            capture:  document.getElementById('capture-view-capture'),
            table:    document.getElementById('capture-view-table')
        };

        const targetView = viewType === 'table' ? 'table' : 'capture';

        // 隐藏所有视图
        Object.values(views).forEach(function(v) {
            if (v) v.classList.remove('active');
        });

        // 显示目标视图
        if (views[targetView]) {
            views[targetView].classList.add('active');
        }

        currentView = targetView;
    }

    /* ========== 外部 API ========== */

    window.addFireTableData = function(dataList) {
        const tbody = document.getElementById('fire-data-tbody');
        const emptyHint = document.getElementById('table-empty-hint');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (dataList && dataList.length > 0) {
            if (emptyHint) emptyHint.style.display = 'none';
            dataList.forEach(function(item, index) {
                const tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + (index + 1) + '</td>' +
                    '<td>' + (item.time || '-') + '</td>' +
                    '<td>' + (item.type || '-') + '</td>' +
                    '<td>' + (item.confidence || '-') + '</td>' +
                    '<td>' + (item.location || '-') + '</td>' +
                    '<td>' + (item.status || '-') + '</td>';
                tbody.appendChild(tr);
            });
        } else {
            if (emptyHint) emptyHint.style.display = 'flex';
        }
    };

    window.clearFireTableData = function() {
        const tbody = document.getElementById('fire-data-tbody');
        const emptyHint = document.getElementById('table-empty-hint');
        if (tbody) tbody.innerHTML = '';
        if (emptyHint) emptyHint.style.display = 'flex';
    };

    window.getCurrentCaptureView = function() {
        return currentView;
    };

    window.setCaptureView = function(viewType) {
        showView(viewType);
    };

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initViewToggle);
    } else {
        initViewToggle();
    }
})();

/**
 * 检测数据面板 - 放大坐标字号
 */
(function() {
    'use strict';

    function initInfoPanel() {
        var infoPanel = document.querySelector('.yjy-info-panel');
        if (!infoPanel) return;

        // 1. 拦截 renderSensorChart，每次渲染后注入放大字号
        patchRenderChart();

        // 2. 温湿度与烟雾图表保持上下同时显示
        showSensorCharts();
    }

    /**
     * 猴子补丁：拦截原始 renderSensorChart，
     * 在每次 setOption 后追加字号放大配置，保证持久生效。
     */
    function patchRenderChart() {
        var attempts = 0;
        var timer = setInterval(function() {
            if (typeof YingJiJiuYuanScene === 'undefined') {
                attempts++;
                if (attempts > 50) clearInterval(timer);
                return;
            }

            // 已有原始方法
            var origRender = YingJiJiuYuanScene.renderSensorChart;
            if (!origRender) {
                attempts++;
                if (attempts > 50) clearInterval(timer);
                return;
            }

            clearInterval(timer);

            // 替换为增强版
            YingJiJiuYuanScene.renderSensorChart = function() {
                // 先执行原始渲染
                origRender.call(this);

                // 再覆盖字号（merge 模式，不会丢失数据）
                if (this.sensorChart) {
                    this.sensorChart.setOption({
                        legend: {
                            textStyle: { fontSize: 16 }
                        },
                        grid: {
                            left: '4%', right: '4%', top: '18%', bottom: '15%', containLabel: true
                        },
                        xAxis: {
                            axisLabel: { fontSize: 15, rotate: 0 }
                        },
                        yAxis: {
                            nameTextStyle: { fontSize: 15 },
                            axisLabel: { fontSize: 15 }
                        },
                        tooltip: {
                            textStyle: { fontSize: 14 }
                        },
                        series: [
                            { symbolSize: 8, lineStyle: { width: 2.5 } },
                            { symbolSize: 8, lineStyle: { width: 2.5 } }
                        ]
                    });
                }
            };

            // 立刻执行一次让当前图表生效
            YingJiJiuYuanScene.renderSensorChart();
        }, 200);
    }

    function showSensorCharts() {
        var tempView = document.getElementById('yjy-temp-humi-view');
        var smokeView = document.getElementById('yjy-smoke-view');

        if (tempView) tempView.style.display = 'flex';
        if (smokeView) smokeView.style.display = 'flex';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInfoPanel);
    } else {
        initInfoPanel();
    }
})();

/**
 * 救援设备 - 两列表格布局模块
 */
(function() {
    'use strict';

    var DEVICES = [
        { key: 'beacon', name: '报警灯' },
        { key: 'valve',  name: '水阀' }
    ];

    function initLinkageTable() {
        var linkagePanel = document.querySelector('.yjy-linkage-panel');
        if (!linkagePanel) return;

        var linkageList = linkagePanel.querySelector('.yjy-linkage-list');
        if (!linkageList) return;

        // 读取当前各设备的激活状态
        var deviceStates = {};
        DEVICES.forEach(function(dev) {
            var card = linkageList.querySelector('.yjy-linkage-card[data-device="' + dev.key + '"]');
            if (card) {
                var activeOpt = card.querySelector('.yjy-linkage-option.active');
                deviceStates[dev.key] = activeOpt ? activeOpt.getAttribute('data-state') : 'off';
            } else {
                deviceStates[dev.key] = 'off';
            }
        });

        // 构建新布局
        var tableLayout = document.createElement('div');
        tableLayout.className = 'linkage-table-layout';

        // 表头
        var header = document.createElement('div');
        header.className = 'linkage-table-header';
        header.innerHTML =
            '<div class="linkage-table-header-cell">设备名称</div>' +
            '<div class="linkage-table-header-cell">启动状态</div>';
        tableLayout.appendChild(header);

        // 数据行容器
        var body = document.createElement('div');
        body.className = 'linkage-table-body';

        DEVICES.forEach(function(dev) {
            var row = document.createElement('div');
            row.className = 'linkage-table-row';
            row.setAttribute('data-device', dev.key);

            // 左列：设备名称
            var nameCell = document.createElement('div');
            nameCell.className = 'linkage-table-name';
            nameCell.textContent = dev.name;

            // 右列：启动状态
            var statusCell = document.createElement('div');
            statusCell.className = 'linkage-table-status';

            var btnOn = document.createElement('div');
            btnOn.className = 'linkage-status-btn' + (deviceStates[dev.key] === 'on' ? ' active' : '');
            btnOn.setAttribute('data-state', 'on');
            btnOn.setAttribute('data-device', dev.key);
            btnOn.innerHTML = '<span>开启</span><span class="linkage-status-check">✓</span>';

            var btnOff = document.createElement('div');
            btnOff.className = 'linkage-status-btn' + (deviceStates[dev.key] === 'off' ? ' active' : '');
            btnOff.setAttribute('data-state', 'off');
            btnOff.setAttribute('data-device', dev.key);
            btnOff.innerHTML = '<span>关闭</span><span class="linkage-status-check">✓</span>';

            statusCell.appendChild(btnOn);
            statusCell.appendChild(btnOff);

            row.appendChild(nameCell);
            row.appendChild(statusCell);
            body.appendChild(row);
        });

        tableLayout.appendChild(body);

        // 替换原有列表
        linkageList.parentNode.replaceChild(tableLayout, linkageList);

        // 绑定点击事件
        tableLayout.addEventListener('click', function(e) {
            var btn = e.target.closest('.linkage-status-btn');
            if (!btn) return;

            var deviceKey = btn.getAttribute('data-device');
            var state = btn.getAttribute('data-state');
            var row = tableLayout.querySelector('.linkage-table-row[data-device="' + deviceKey + '"]');
            if (!row) return;

            // 更新该行所有按钮状态
            var btns = row.querySelectorAll('.linkage-status-btn');
            btns.forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');

            // 同步原始 linkage 事件（如果其他JS依赖）
            if (typeof window.onLinkageChange === 'function') {
                window.onLinkageChange(deviceKey, state);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLinkageTable);
    } else {
        initLinkageTable();
    }
})();
