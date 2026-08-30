(() => {
    const GRAPH_CONTAINER_ID = 'architectureGraph';
    const STORAGE_KEY = 'x6-layout-v2';
    const IMAGE_BASE = 'assets/images/';
    const PROJECT20_BACKEND_PORT = '8090';
    const normalizeApiBase = (value) => String(value || '').replace(/\/$/, '');
    const isLocalPreviewHost = (hostname) =>
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '[::1]' ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
    const buildOrigin = (protocol, hostname, port) =>
        `${protocol}//${hostname}${port ? `:${port}` : ''}`;
    const resolveGraphApiBase = () => {
        if (typeof window === 'undefined' || !window.location) {
            return '';
        }
        if (window.__PROJECT20_API_BASE__) {
            return normalizeApiBase(window.__PROJECT20_API_BASE__);
        }
        if (window.__API_BASE__) {
            return normalizeApiBase(window.__API_BASE__);
        }

        const { protocol, hostname, port, pathname } = window.location;
        if (protocol === 'file:') {
            return 'http://127.0.0.1:8090';
        }
        if (isLocalPreviewHost(hostname) && port && port !== PROJECT20_BACKEND_PORT) {
            return `${protocol}//${hostname}:${PROJECT20_BACKEND_PORT}`;
        }
        if (pathname.startsWith('/project2-0/')) {
            return `${buildOrigin(protocol, hostname, port)}/project2-0`;
        }
        return '';
    };
    const GRAPH_API_BASE = resolveGraphApiBase();
    const buildGraphApiUrl = (path) => `${normalizeApiBase(GRAPH_API_BASE)}${path.startsWith('/') ? path : `/${path}`}`;
    const parseJsonResponse = async (response, requestLabel) => {
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
    const LABEL_STYLE = {
        maxWidth: 280,
        minFontSize: 12,
        maxFontSize: 18,
        paddingX: 8,
        paddingY: 8,
    };
    const LABEL_FONT_STEP = 2;
    const EDGE_DASH_PATTERN = '16 12';
    const EDGE_ARROW_DEFAULT = 'double';
    const PAGE_VISIBILITY_MESSAGE_TYPE = 'controlplatform:page-visibility';
    const GLOBE_NODE_ID = 'fig3';
    const GLOBE_NODE_SHAPE = 'x6-globe-node';
    const DEFAULT_NODE_IDS = new Set([
        'fig1',
        'fig2',
        'fig3',
        'fig4',
        'fig5',
        'fig6',
        'fig7',
        'fig1_label',
        'fig2_label',
        'fig3_label',
        'fig4_label',
        'fig5_label',
        'fig6_label',
    ]);
    const buildGlobeContainerId = (nodeId) => `x6-globe-${nodeId}`;
    const buildGlobeMarkup = (nodeId) => {
        const wrap = document.createElement('div');
        wrap.className = 'x6-globe-node';

        const frame = document.createElement('div');
        frame.className = 'x6-globe-frame';

        const container = document.createElement('div');
        container.className = 'satellite-globe-container x6-globe-container';
        container.id = buildGlobeContainerId(nodeId);

        const loading = document.createElement('div');
        loading.className = 'globe-loading';
        loading.innerHTML = `
            <div class="globe-loading-spinner"></div>
            <span>正在加载3D地球...</span>
        `;

        container.appendChild(loading);
        frame.appendChild(container);

        const controls = document.createElement('div');
        controls.className = 'x6-globe-controls';
        controls.innerHTML = `
            <button class="globe-control-btn reset-toggle" data-action="reset" title="重置视角" aria-label="重置视角">
                <i class="fas fa-sync-alt"></i>
            </button>
            <button class="globe-control-btn orbit-toggle active" data-action="toggle-orbits" title="切换轨道显示" aria-label="切换轨道显示">
                <i class="fas fa-ring"></i>
            </button>
        `;

        frame.appendChild(controls);
        wrap.appendChild(frame);

        return wrap;
    };

    const loadLayout = () => {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    };

    const normalizeLayout = (raw) => {
        if (!raw || typeof raw !== 'object') {
            return { nodes: {}, edges: [], viewport: null, dynamicNodes: [], hiddenDefaultNodes: [] };
        }
        if (raw.nodes || raw.edges || raw.viewport) {
            return {
                nodes: raw.nodes || {},
                edges: Array.isArray(raw.edges) ? raw.edges : [],
                viewport: raw.viewport || null,
                dynamicNodes: Array.isArray(raw.dynamicNodes) ? raw.dynamicNodes : [],
                hiddenDefaultNodes: Array.isArray(raw.hiddenDefaultNodes) ? raw.hiddenDefaultNodes : [],
            };
        }
        return { nodes: raw, edges: [], viewport: null, dynamicNodes: [], hiddenDefaultNodes: [] };
    };

    // API Helpers
    const fetchLayoutFromApi = async () => {
        try {
            const res = await fetch(buildGraphApiUrl('/api/layout'));
            const json = await parseJsonResponse(res, 'GET /api/layout');
            return json.success ? json.data : null;
        } catch (e) {
            console.warn('Fetch layout failed', e);
            return null;
        }
    };

    let saveApiTimer = null;
    const saveLayoutToApi = (data) => {
        if (saveApiTimer) clearTimeout(saveApiTimer);
        saveApiTimer = setTimeout(async () => {
            try {
                await fetch(buildGraphApiUrl('/api/layout'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            } catch (e) {
                console.warn('Save layout failed', e);
            }
        }, 1000);
    };

    const getNodeImageUrl = (node) => {
        const data = node?.getData?.() || {};
        if (data.imageUrl) {
            return data.imageUrl;
        }
        const attrs = node?.getAttrs?.() || {};
        return attrs?.image?.xlinkHref || attrs?.image?.href || attrs?.image?.src || '';
    };

    const buildDynamicNodesPayload = (graphInstance) => {
        if (!graphInstance || !graphInstance.getNodes) {
            return [];
        }
        return graphInstance.getNodes()
            .filter((node) => !DEFAULT_NODE_IDS.has(node.id))
            .map((node) => {
                const data = node?.getData?.() || {};
                const role = data.role;
                if (role === 'label') {
                    return {
                        id: node.id,
                        type: 'label',
                        text: data.text || node.getLabel?.() || '',
                        manualFontSize: data.manualFontSize,
                    };
                }
                if (role === 'image') {
                    return {
                        id: node.id,
                        type: 'image',
                        imageUrl: getNodeImageUrl(node),
                    };
                }
                return null;
            })
            .filter(Boolean);
    };

    const buildHiddenDefaultNodesPayload = (graphInstance) => {
        if (!graphInstance || !graphInstance.getNodes) {
            return [];
        }
        const existingIds = new Set();
        graphInstance.getNodes().forEach((node) => {
            existingIds.add(node.id);
        });
        return Array.from(DEFAULT_NODE_IDS).filter((id) => !existingIds.has(id));
    };

    const normalizeArrowMode = (mode) => (mode === 'single' ? 'single' : 'double');

    const getEdgeArrowMode = (edge) => {
        if (!edge) {
            return EDGE_ARROW_DEFAULT;
        }
        const data = edge.getData ? edge.getData() : {};
        if (data && data.arrowMode) {
            return normalizeArrowMode(data.arrowMode);
        }
        const sourceMarker = edge.attr ? edge.attr('line/sourceMarker') : null;
        if (sourceMarker && (typeof sourceMarker === 'object' ? Object.keys(sourceMarker).length > 0 : true)) {
            return 'double';
        }
        return 'single';
    };

    const getEdgeLineStyle = (edge) => {
        if (!edge) {
            return 'dashed';
        }
        const data = edge.getData ? edge.getData() : {};
        if (data && data.lineStyle) {
            return data.lineStyle;
        }
        const dash = edge.attr ? edge.attr('line/strokeDasharray') : null;
        if (!dash || String(dash).trim() === '' || String(dash) === '0') {
            return 'solid';
        }
        return 'dashed';
    };

    const saveLayout = (graphInstance) => {
        try {
            const nodes = {};
            graphInstance.getNodes().forEach((node) => {
                const pos = node.position();
                const size = node.size();
                const data = node.getData ? node.getData() : {};
                nodes[node.id] = {
                    x: pos.x,
                    y: pos.y,
                    width: size.width,
                    height: size.height,
                };
                if (data && data.role === 'label') {
                    const manualFontSize = data.manualFontSize;
                    if (typeof manualFontSize === 'number' && manualFontSize > 0) {
                        nodes[node.id].manualFontSize = manualFontSize;
                    }
                }
            });
            const edges = graphInstance.getEdges().map((edge) => {
                const source = edge.getSource();
                const target = edge.getTarget();
                const vertices = edge.getVertices ? edge.getVertices() : [];
                return {
                    id: edge.id,
                    source,
                    target,
                    vertices,
                    lineStyle: getEdgeLineStyle(edge),
                    arrowMode: getEdgeArrowMode(edge),
                };
            });
            const scale = graphInstance.scale ? graphInstance.scale() : null;
            const translate = graphInstance.translate ? graphInstance.translate() : null;
            const viewport = {
                scale: scale?.sx ?? scale?.x ?? scale?.k ?? 1,
                tx: translate?.tx ?? translate?.x ?? 0,
                ty: translate?.ty ?? translate?.y ?? 0,
            };
            const dynamicNodes = buildDynamicNodesPayload(graphInstance);
            const hiddenDefaultNodes = buildHiddenDefaultNodesPayload(graphInstance);
            const payload = { nodes, edges, viewport, dynamicNodes, hiddenDefaultNodes, ...nodes };

            // 1. 保存到本地存储
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

            // 2. 同步到服务器
            saveLayoutToApi(payload);

        } catch (e) {
            // ignore errors
        }
    };

    const measureContext = document.createElement('canvas').getContext('2d');
    const measureTextWidth = (text, fontSize) => {
        measureContext.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
        return measureContext.measureText(text).width;
    };

    const computeFontSize = (text, width, height) => {
        const availableWidth = Math.max(10, width - LABEL_STYLE.paddingX * 2);
        const availableHeight = Math.max(10, height - LABEL_STYLE.paddingY);
        let fontSize = Math.min(LABEL_STYLE.maxFontSize, Math.floor(availableHeight));
        if (fontSize < LABEL_STYLE.minFontSize) {
            fontSize = LABEL_STYLE.minFontSize;
        }
        let textWidth = measureTextWidth(text, fontSize);
        while (fontSize > LABEL_STYLE.minFontSize && textWidth > availableWidth) {
            fontSize -= 1;
            textWidth = measureTextWidth(text, fontSize);
        }
        return fontSize;
    };

    const fitLabel = (text) => {
        let fontSize = LABEL_STYLE.maxFontSize;
        let textWidth = measureTextWidth(text, fontSize);
        while (fontSize > LABEL_STYLE.minFontSize &&
            textWidth + LABEL_STYLE.paddingX * 2 > LABEL_STYLE.maxWidth) {
            fontSize -= 1;
            textWidth = measureTextWidth(text, fontSize);
        }
        const width = Math.min(
            LABEL_STYLE.maxWidth,
            Math.ceil(textWidth + LABEL_STYLE.paddingX * 2)
        );
        const height = Math.ceil(fontSize + LABEL_STYLE.paddingY);
        return { fontSize, width, height };
    };

    const computeLabelMetricsWithFont = (text, fontSize) => {
        const size = clampFontSize(fontSize);
        const textWidth = measureTextWidth(text, size);
        const width = Math.min(
            LABEL_STYLE.maxWidth,
            Math.ceil(textWidth + LABEL_STYLE.paddingX * 2)
        );
        const height = Math.ceil(size + LABEL_STYLE.paddingY);
        return { fontSize: size, width, height };
    };

    const clampFontSize = (size) => {
        if (!Number.isFinite(size)) {
            return LABEL_STYLE.minFontSize;
        }
        return Math.max(6, Math.round(size));
    };

    const initArchitectureGraph = (() => {
        let attempts = 0;
        let isInitializing = false;

        return async () => {
            // 防止并发初始化
            if (isInitializing) return;
            isInitializing = true;

            const container = document.getElementById(GRAPH_CONTAINER_ID);
            if (!container) {
                isInitializing = false;
                return;
            }
            if (container.dataset.graphReady === 'true') {
                // 已经初始化完成，保持 isInitializing = true (或者无所谓，反正Ready了)
                return;
            }
            if (!window.X6) {
                console.warn('X6 library not loaded for architecture graph.');
                isInitializing = false;
                return;
            }

            const rect = container.getBoundingClientRect();
            if ((rect.width === 0 || rect.height === 0) && attempts < 20) {
                attempts += 1;
                isInitializing = false; // 释放锁允许重试
                setTimeout(initArchitectureGraph, 150);
                return;
            }

            container.dataset.graphReady = 'true';
            // isInitializing 保持为 true，防止后续重复调用

            const { Graph, Transform } = X6;
            const getNodeRole = (node) => node?.getData?.()?.role;
            const registerNode = Graph.registerNode || (X6.Node && X6.Node.register);
            const hasCustomGlobeShape = typeof registerNode === 'function';
            const supportsForeignObject = X6.SUPPORT_FOREIGNOBJECT !== false;
            if (registerNode) {
                registerNode(GLOBE_NODE_SHAPE, {
                    inherit: 'html',
                    width: 220,
                    height: 220,
                    html: (node) => buildGlobeMarkup(node.id),
                }, true);
            }

            // 异步加载布局：优先 API，其次 LocalStorage，最后默认
            let savedLayout = {};
            const remoteData = await fetchLayoutFromApi();
            if (remoteData) {
                savedLayout = normalizeLayout(remoteData);
                // 更新一下本地存储，保持同步
                localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteData));
            } else {
                // 回退到本地存储
                savedLayout = normalizeLayout(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
            }

            let saveTimer = null;

            const graph = new Graph({
                container,
                grid: {
                    visible: false,
                    type: 'dot',
                    args: { color: '#334155' },
                },
                panning: true,
                mousewheel: true,
                background: {
                    color: '#0f172a',
                },
                interacting: {
                    nodeMovable: true,
                },
                autoResize: true,
            });

            const globeInstances = new Map();
            const overlayLayer = document.createElement('div');
            overlayLayer.className = 'x6-overlay-layer';
            container.appendChild(overlayLayer);
            const overlayInstances = new Map();
            let isGraphPageActive = true;
            const wrapper = container.closest('.architecture-graph-wrapper') || container;
            let shiftPressed = false;
            const setEditMode = (active) => {
                shiftPressed = !!active;
                wrapper.classList.toggle('x6-edit-mode', active);
            };

            if (!wrapper.dataset.editModeBound) {
                wrapper.dataset.editModeBound = 'true';
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Shift') {
                        setEditMode(true);
                    }
                });
                document.addEventListener('keyup', (e) => {
                    if (e.key === 'Shift') {
                        setEditMode(false);
                    }
                });
                window.addEventListener('blur', () => setEditMode(false));
            }

            graph.use(new Transform({
                resizing: {
                    enabled: true,
                    preserveAspectRatio: (node) => getNodeRole(node) !== 'label',
                    minWidth: (node) => {
                        const role = getNodeRole(node);
                        if (role === 'label') return 80;
                        if (role === 'globe') return 160;
                        return 60;
                    },
                    minHeight: (node) => {
                        const role = getNodeRole(node);
                        if (role === 'label') return 20;
                        if (role === 'globe') return 160;
                        return 60;
                    },
                    maxWidth: (node) => {
                        const role = getNodeRole(node);
                        if (role === 'label') return Number.MAX_SAFE_INTEGER;
                        if (role === 'globe') return Number.MAX_SAFE_INTEGER;
                        return Number.MAX_SAFE_INTEGER;
                    },
                    maxHeight: (node) => {
                        const role = getNodeRole(node);
                        if (role === 'label') return Number.MAX_SAFE_INTEGER;
                        if (role === 'globe') return Number.MAX_SAFE_INTEGER;
                        return Number.MAX_SAFE_INTEGER;
                    },
                },
                rotating: {
                    enabled: false,
                },
            }));

            const HistoryPlugin = X6.History || (X6.Plugin && X6.Plugin.History);
            if (HistoryPlugin && graph.use) {
                graph.use(new HistoryPlugin());
            } else if (typeof graph.enableHistory === 'function') {
                graph.enableHistory();
            }

            const scheduleSave = () => {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                }
                saveTimer = setTimeout(() => saveLayout(graph), 200);
            };

            graph.on('node:change:position', scheduleSave);
            graph.on('node:change:size', scheduleSave);
            graph.on('edge:change:source', scheduleSave);
            graph.on('edge:change:target', scheduleSave);
            graph.on('edge:change:vertices', scheduleSave);
            graph.on('translate', scheduleSave);
            graph.on('scale', scheduleSave);
            graph.on('translate', () => {
                overlayInstances.forEach((data) => updateOverlayPosition(data.node));
                positionLabelEditor();
            });
            graph.on('scale', () => {
                overlayInstances.forEach((data) => updateOverlayPosition(data.node));
                positionLabelEditor();
            });
            graph.on('node:change:position', ({ node }) => {
                if (node && getNodeRole(node) === 'globe') {
                    updateOverlayPosition(node);
                }
                if (labelEditor && labelEditor.node === node) {
                    positionLabelEditor();
                }
            });
            graph.on('node:change:size', ({ node }) => {
                if (!node) {
                    return;
                }
                updateLabelFont(node);
                if (labelEditor && labelEditor.node === node) {
                    positionLabelEditor();
                }
                if (getNodeRole(node) === 'globe') {
                    const instance = globeInstances.get(node.id);
                    if (instance && typeof instance.onResize === 'function') {
                        requestAnimationFrame(() => instance.onResize());
                    } else {
                        mountGlobeNode(node);
                    }
                    updateOverlayPosition(node);
                }
            });

            const PORT_GROUPS = {
                in: {
                    position: 'left',
                    attrs: {
                        circle: {
                            r: 7,
                            magnet: true,
                            fill: '#0f172a',
                            stroke: '#38bdf8',
                            strokeWidth: 2,
                        },
                    },
                },
                out: {
                    position: 'right',
                    attrs: {
                        circle: {
                            r: 7,
                            magnet: true,
                            fill: '#0f172a',
                            stroke: '#38bdf8',
                            strokeWidth: 2,
                        },
                    },
                },
                top: {
                    position: 'top',
                    attrs: {
                        circle: {
                            r: 7,
                            magnet: true,
                            fill: '#0f172a',
                            stroke: '#38bdf8',
                            strokeWidth: 2,
                        },
                    },
                },
                bottom: {
                    position: 'bottom',
                    attrs: {
                        circle: {
                            r: 7,
                            magnet: true,
                            fill: '#0f172a',
                            stroke: '#38bdf8',
                            strokeWidth: 2,
                        },
                    },
                },
            };

            const createPorts = (id) => ({
                groups: PORT_GROUPS,
                items: [
                    { id: `${id}-in`, group: 'in' },
                    { id: `${id}-out`, group: 'out' },
                    { id: `${id}-top`, group: 'top' },
                    { id: `${id}-bottom`, group: 'bottom' },
                ],
            });

            const createNode = (id, x, y, imageUrl) => {
                return graph.addNode({
                    id,
                    x,
                    y,
                    width: 120,
                    height: 120,
                    shape: 'image',
                    imageUrl,
                    ports: createPorts(id),
                    data: {
                        role: 'image',
                        imageUrl,
                    },
                    attrs: {
                        body: {
                            stroke: 'none',
                        },
                    },
                });
            };

            const createGlobeNode = (id, x, y) => {
                const shape = hasCustomGlobeShape ? GLOBE_NODE_SHAPE : 'html';
                const nodeConfig = {
                    id,
                    x,
                    y,
                    width: 220,
                    height: 220,
                    shape,
                    data: {
                        role: 'globe',
                    },
                    ports: createPorts(id),
                    zIndex: 6,
                };

                if (shape === 'html') {
                    nodeConfig.html = () => buildGlobeMarkup(id);
                }

                return graph.addNode(nodeConfig);
            };

            const updateLabelData = (node, next) => {
                const prev = node?.getData?.() || {};
                node.setData({ ...prev, ...next });
            };

            const applyManualFontSize = (node, fontSize) => {
                const size = clampFontSize(fontSize);
                updateLabelData(node, { manualFontSize: size });
                node.attr('label/fontSize', size);
            };

            const updateLabelFont = (node) => {
                const data = node?.getData?.() || {};
                if (data.role !== 'label') {
                    return;
                }
                if (typeof data.manualFontSize === 'number' && data.manualFontSize > 0) {
                    node.attr('label/fontSize', clampFontSize(data.manualFontSize));
                    return;
                }
                const size = node.size();
                const text = data.text || node.getLabel?.() || '';
                const fontSize = computeFontSize(text, size.width, size.height);
                node.attr('label/fontSize', fontSize);
            };

            const createLabel = (id, x, y, text) => {
                const metrics = fitLabel(text);
                return graph.addNode({
                    id,
                    x,
                    y,
                    width: metrics.width,
                    height: metrics.height,
                    shape: 'rect',
                    label: text,
                    data: {
                        role: 'label',
                        text,
                    },
                    attrs: {
                        body: {
                            fill: 'transparent',
                            stroke: 'none',
                        },
                        label: {
                            fill: '#ff4d4f',
                            fontSize: metrics.fontSize,
                            fontWeight: 'bold',
                            textAnchor: 'start',
                            textVerticalAnchor: 'middle',
                            refX: LABEL_STYLE.paddingX,
                            refY: '50%',
                        },
                    },
                });
            };

            let lastPointer = null;
            const toLocalPoint = (clientX, clientY) => {
                if (graph.clientToLocal) {
                    return graph.clientToLocal(clientX, clientY);
                }
                if (graph.pageToLocal) {
                    return graph.pageToLocal(clientX, clientY);
                }
                return { x: clientX, y: clientY };
            };

            const getInsertPosition = (width, height) => {
                const rect = container.getBoundingClientRect();
                const ref = lastPointer
                    ? lastPointer
                    : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                const local = toLocalPoint(ref.x, ref.y);
                return { x: local.x - width / 2, y: local.y - height / 2 };
            };

            const normalizeImageUrl = (value) => {
                const raw = String(value || '').trim();
                if (!raw) {
                    return '';
                }
                if (/^(https?:\/\/|data:|blob:)/i.test(raw) || raw.startsWith('/')) {
                    return raw;
                }
                if (raw.startsWith(IMAGE_BASE) || raw.startsWith(`./${IMAGE_BASE}`)) {
                    return raw;
                }
                return `${IMAGE_BASE}${raw}`;
            };

            const createCustomId = (prefix) => {
                if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                    return `${prefix}-${window.crypto.randomUUID()}`;
                }
                return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            };

            const addLabelNodeQuick = () => {
                const text = '文字';
                const metrics = fitLabel(text);
                const pos = getInsertPosition(metrics.width, metrics.height);
                const node = createLabel(createCustomId('label'), pos.x, pos.y, text);
                setSingleNodeSelection(node);
                scheduleSave();
                requestAnimationFrame(() => startLabelEditor(node));
            };

            const uploadImageFile = async (file) => {
                const formData = new FormData();
                formData.append('file', file);
                const response = await fetch(buildGraphApiUrl('/api/layout/upload-image'), {
                    method: 'POST',
                    body: formData,
                });
                const result = await parseJsonResponse(response, 'POST /api/layout/upload-image');
                if (!result.success || !result.image_url) {
                    throw new Error(result.message || 'upload image failed');
                }
                return result.image_url;
            };

            const addImageNodeFromFile = async (file) => {
                if (!file) {
                    return;
                }
                try {
                    const imageUrl = await uploadImageFile(file);
                    if (!imageUrl) {
                        return;
                    }
                    const pos = getInsertPosition(120, 120);
                    const node = createNode(createCustomId('img'), pos.x, pos.y, imageUrl);
                    setSingleNodeSelection(node);
                    scheduleSave();
                } catch (e) {
                    console.warn('Image upload failed', e);
                }
            };

            const initGraphToolbar = () => {
                if (container.querySelector('.x6-graph-toolbar')) {
                    return;
                }
                const toolbar = document.createElement('div');
                toolbar.className = 'x6-graph-toolbar';
                toolbar.innerHTML = `
                    <div class="toolbar-section">
                        <div class="toolbar-row toolbar-row-wrap">
                            <input class="toolbar-file" data-role="upload" type="file" accept="image/*">
                            <button class="toolbar-btn" data-action="upload-image">上传图片</button>
                            <button class="toolbar-btn" data-action="add-label">添加文字</button>
                        </div>
                    </div>
                `;
                container.appendChild(toolbar);
                toolbarEl = toolbar;

                const fileInput = toolbar.querySelector('input[data-role="upload"]');
                toolbarFileInput = fileInput || null;
                const addLabelBtn = toolbar.querySelector('button[data-action="add-label"]');
                const uploadBtn = toolbar.querySelector('button[data-action="upload-image"]');

                addLabelBtn?.addEventListener('click', addLabelNodeQuick);
                uploadBtn?.addEventListener('click', () => fileInput?.click());

                fileInput?.addEventListener('change', () => {
                    const file = fileInput?.files?.[0];
                    if (file) {
                        addImageNodeFromFile(file);
                    }
                    if (fileInput) {
                        fileInput.value = '';
                    }
                });

                toolbar.addEventListener('click', (e) => {
                    const button = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
                    const action = button?.dataset?.action;
                    if (!action || action === 'add-label' || action === 'upload-image') {
                        return;
                    }
                    if (typeof handleToolbarAction === 'function') {
                        handleToolbarAction(action);
                    }
                });
                toolbar.addEventListener('mousedown', (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                });
                toolbar.addEventListener('wheel', (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                });
                updateToolbarState();
            };

            let labelEditor = null;
            const getNodeContainerRect = (node) => {
                const matrix = graph.matrix ? graph.matrix() : { a: 1, d: 1, e: 0, f: 0 };
                const bbox = node.getBBox();
                const left = bbox.x * matrix.a + matrix.e;
                const top = bbox.y * matrix.d + matrix.f;
                const width = bbox.width * matrix.a;
                const height = bbox.height * matrix.d;
                return { left, top, width, height };
            };

            const positionLabelEditor = () => {
                if (!labelEditor || !labelEditor.node || !labelEditor.input) {
                    return;
                }
                const rect = getNodeContainerRect(labelEditor.node);
                labelEditor.input.style.left = `${rect.left}px`;
                labelEditor.input.style.top = `${rect.top}px`;
                labelEditor.input.style.width = `${Math.max(rect.width, 120)}px`;
                labelEditor.input.style.height = `${Math.max(rect.height, 28)}px`;
            };

            const closeLabelEditor = (commit) => {
                if (!labelEditor) {
                    return;
                }
                const { node, input, originalText } = labelEditor;
                const nextText = String(input.value || '').trim();
                if (commit && node) {
                    const finalText = nextText || originalText || '';
                    updateLabelData(node, { text: finalText });
                    if (typeof node.setLabel === 'function') {
                        node.setLabel(finalText);
                    } else {
                        node.attr('label/text', finalText);
                    }
                    const data = node.getData?.() || {};
                    const metrics = (typeof data.manualFontSize === 'number' && data.manualFontSize > 0)
                        ? computeLabelMetricsWithFont(finalText, data.manualFontSize)
                        : fitLabel(finalText);
                    node.resize(metrics.width, metrics.height);
                    node.attr('label/fontSize', metrics.fontSize);
                    updateLabelFont(node);
                    scheduleSave();
                }
                input.remove();
                labelEditor = null;
            };

            const startLabelEditor = (node) => {
                if (!node) {
                    return;
                }
                closeLabelEditor(false);
                const text = node.getLabel?.() || node.attr('label/text') || '';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = text;
                input.className = 'x6-label-editor';
                container.appendChild(input);
                labelEditor = { node, input, originalText: text };
                positionLabelEditor();
                input.focus();
                input.select();
                input.addEventListener('mousedown', (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                });
                input.addEventListener('wheel', (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        closeLabelEditor(true);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        closeLabelEditor(false);
                    }
                });
                input.addEventListener('blur', () => closeLabelEditor(true));
            };

            const updateOverlayPosition = (node) => {
                const overlayData = overlayInstances.get(node.id);
                if (!overlayData) {
                    return;
                }
                const matrix = graph.matrix ? graph.matrix() : { a: 1, d: 1, e: 0, f: 0 };
                const bbox = node.getBBox();
                const left = bbox.x * matrix.a + matrix.e;
                const top = bbox.y * matrix.d + matrix.f;
                const width = bbox.width * matrix.a;
                const height = bbox.height * matrix.d;
                overlayData.el.style.transform = `translate(${left}px, ${top}px)`;
                overlayData.el.style.width = `${width}px`;
                overlayData.el.style.height = `${height}px`;
                if (overlayData.globe && typeof overlayData.globe.onResize === 'function') {
                    overlayData.globe.onResize();
                }
            };

            const setGlobeInstanceActive = (globe, active) => {
                if (!globe) {
                    return;
                }
                if (active) {
                    if (typeof globe.resume === 'function') {
                        globe.resume();
                    } else if (typeof globe.onResize === 'function') {
                        globe.onResize();
                    }
                } else if (typeof globe.pause === 'function') {
                    globe.pause();
                }
            };

            const syncGraphPageVisibility = (active) => {
                isGraphPageActive = !!active;
                globeInstances.forEach((globe) => setGlobeInstanceActive(globe, isGraphPageActive));
                overlayInstances.forEach((overlay) => setGlobeInstanceActive(overlay?.globe, isGraphPageActive));
            };

            window.addEventListener('message', (event) => {
                if (!event || !event.data || event.data.type !== PAGE_VISIBILITY_MESSAGE_TYPE) {
                    return;
                }
                syncGraphPageVisibility(event.data.active !== false);
            });

            const mountGlobeOverlay = (node) => {
                if (overlayInstances.has(node.id)) {
                    updateOverlayPosition(node);
                    return;
                }
                // 防止重复：如果已经有嵌入式地球，则不创建悬浮地球
                if (globeInstances.has(node.id)) {
                    return;
                }
                const overlayEl = document.createElement('div');
                overlayEl.className = 'x6-globe-overlay';
                overlayEl.appendChild(buildGlobeMarkup(node.id));
                overlayLayer.appendChild(overlayEl);

                const containerId = buildGlobeContainerId(node.id);
                const globe = new SatelliteGlobe(containerId);
                overlayInstances.set(node.id, { el: overlayEl, globe, node });
                setGlobeInstanceActive(globe, isGraphPageActive);

                bindGlobeControls(node, globe);

                const stop = (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                };
                overlayEl.addEventListener('mousedown', stop);
                overlayEl.addEventListener('wheel', stop);
                overlayEl.addEventListener('touchstart', stop);

                updateOverlayPosition(node);
            };

            const bindGlobeControls = (node, globe) => {
                if (!node || !globe) {
                    return;
                }
                const containerId = buildGlobeContainerId(node.id);
                const container = document.getElementById(containerId);
                const controls = container?.closest('.x6-globe-node')?.querySelector('.x6-globe-controls');
                if (!controls || controls.dataset.bound === 'true') {
                    return;
                }
                controls.dataset.bound = 'true';

                const stop = (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                };

                controls.addEventListener('mousedown', stop);
                controls.addEventListener('pointerdown', stop);
                controls.addEventListener('touchstart', stop);

                const resetBtn = controls.querySelector('[data-action="reset"]');
                if (resetBtn) {
                    resetBtn.addEventListener('click', (e) => {
                        stop(e);
                        if (typeof globe.resetView === 'function') {
                            globe.resetView();
                        }
                    });
                }

                const toggleBtn = controls.querySelector('[data-action="toggle-orbits"]');
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', (e) => {
                        stop(e);
                        if (typeof globe.toggleOrbits === 'function') {
                            const visible = globe.toggleOrbits();
                            toggleBtn.classList.toggle('active', visible);
                            toggleBtn.innerHTML = visible
                                ? '<i class="fas fa-ring"></i>'
                                : '<i class="fas fa-eye-slash"></i>';
                        }
                    });
                }
            };

            const mountGlobeNode = (node, attempt = 0) => {
                if (!node || getNodeRole(node) !== 'globe') {
                    return;
                }
                // 检查是否已存在 Overlay 实例，防止双重渲染
                if (overlayInstances.has(node.id)) {
                    updateOverlayPosition(node);
                    return;
                }

                if (!supportsForeignObject) {
                    mountGlobeOverlay(node);
                    return;
                }
                if (!window.SatelliteGlobe) {
                    if (attempt < 10) {
                        setTimeout(() => mountGlobeNode(node, attempt + 1), 300);
                    }
                    return;
                }
                const containerId = buildGlobeContainerId(node.id);
                const container = document.getElementById(containerId);
                if (!container) {
                    if (attempt < 6) {
                        setTimeout(() => mountGlobeNode(node, attempt + 1), 200);
                    } else {
                        mountGlobeOverlay(node);
                    }
                    return;
                }
                if (globeInstances.has(node.id)) {
                    const instance = globeInstances.get(node.id);
                    if (instance && typeof instance.onResize === 'function') {
                        instance.onResize();
                    }
                    bindGlobeControls(node, instance);
                    return;
                }

                const globe = new SatelliteGlobe(containerId);
                globeInstances.set(node.id, globe);
                setGlobeInstanceActive(globe, isGraphPageActive);
                bindGlobeControls(node, globe);

                container.addEventListener('mousedown', (e) => e.stopPropagation());
                container.addEventListener('wheel', (e) => e.stopPropagation());
                container.addEventListener('touchstart', (e) => e.stopPropagation());

                requestAnimationFrame(() => {
                    if (typeof globe.onResize === 'function') {
                        globe.onResize();
                    }
                });
            };

            const EDGE_STROKE_WIDTH = 8;
            const EDGE_MARKER_SIZE = 24;
            const EDGE_CONNECTION_OFFSET = EDGE_MARKER_SIZE + 20;
            const EDGE_MARKER_OFFSET = 0;
            const EDGE_STYLE = {
                stroke: '#38bdf8',
                strokeWidth: EDGE_STROKE_WIDTH,
                strokeDasharray: EDGE_DASH_PATTERN,
                strokeLinecap: 'butt',
                strokeLinejoin: 'round',
                sourceMarker: {
                    name: 'classic',
                    size: EDGE_MARKER_SIZE,
                    offset: EDGE_MARKER_OFFSET
                },
                targetMarker: {
                    name: 'classic',
                    size: EDGE_MARKER_SIZE,
                    offset: EDGE_MARKER_OFFSET
                },
                style: {
                    animation: 'running-line 16s infinite linear',
                },
            };
            const EDGE_ROUTER = { name: 'normal' };
            const EDGE_CONNECTOR = { name: 'normal' };
            const EDGE_SELECTED_STYLE = {
                stroke: '#f97316',
                strokeWidth: EDGE_STYLE.strokeWidth + 1,
            };
            let selectedEdge = null;
            let selectedNode = null;
            let selectedLabelNode = null;
            let hoveredEdge = null;
            const selectedNodes = new Set();
            let toolbarEl = null;
            let contextMenuEl = null;
            let toolbarFileInput = null;

            const setNodeHighlight = (node, active) => {
                if (!node || getNodeRole(node) === 'globe') {
                    return;
                }
                node.attr('body/stroke', active ? '#f97316' : 'none');
                node.attr('body/strokeWidth', active ? 2 : 0);
            };

            const syncSelectedLabelNode = () => {
                if (selectedNodes.size === 1) {
                    const only = selectedNodes.values().next().value;
                    selectedLabelNode = getNodeRole(only) === 'label' ? only : null;
                } else {
                    selectedLabelNode = null;
                }
            };

            const clearNodeSelection = () => {
                selectedNodes.forEach((node) => setNodeHighlight(node, false));
                selectedNodes.clear();
                selectedNode = null;
                syncSelectedLabelNode();
                updateToolbarState();
            };

            const addNodeSelection = (node) => {
                if (!node) {
                    return;
                }
                selectedNodes.add(node);
                selectedNode = node;
                setNodeHighlight(node, true);
                syncSelectedLabelNode();
                updateToolbarState();
            };

            const toggleNodeSelection = (node) => {
                if (!node) {
                    return;
                }
                if (selectedNodes.has(node)) {
                    selectedNodes.delete(node);
                    setNodeHighlight(node, false);
                } else {
                    selectedNodes.add(node);
                    setNodeHighlight(node, true);
                }
                selectedNode = node;
                syncSelectedLabelNode();
                updateToolbarState();
            };

            const setSingleNodeSelection = (node) => {
                clearNodeSelection();
                if (node) {
                    addNodeSelection(node);
                }
            };

            const getSelectionNodes = () => Array.from(selectedNodes);

            const canUndo = () => {
                if (typeof graph.canUndo === 'function') {
                    return graph.canUndo();
                }
                if (graph.history && typeof graph.history.canUndo === 'function') {
                    return graph.history.canUndo();
                }
                return false;
            };

            const canRedo = () => {
                if (typeof graph.canRedo === 'function') {
                    return graph.canRedo();
                }
                if (graph.history && typeof graph.history.canRedo === 'function') {
                    return graph.history.canRedo();
                }
                return false;
            };

            const doUndo = () => {
                if (typeof graph.undo === 'function') {
                    graph.undo();
                } else if (graph.history && typeof graph.history.undo === 'function') {
                    graph.history.undo();
                }
                updateToolbarState();
            };

            const doRedo = () => {
                if (typeof graph.redo === 'function') {
                    graph.redo();
                } else if (graph.history && typeof graph.history.redo === 'function') {
                    graph.history.redo();
                }
                updateToolbarState();
            };

            const updateToolbarState = () => {
                if (!toolbarEl) {
                    return;
                }
                const hasEdgeSelection = !!selectedEdge;
                const selectionCount = selectedNodes.size;
                const selectedList = getSelectionNodes();
                const hasDeletableNode = selectedList.some((node) => isDeletableNode(node));
                const setDisabled = (selector, disabled) => {
                    const btn = toolbarEl.querySelector(selector);
                    if (!btn) {
                        return;
                    }
                    btn.disabled = !!disabled;
                    btn.classList.toggle('disabled', !!disabled);
                };
                setDisabled('button[data-action="undo"]', !canUndo());
                setDisabled('button[data-action="redo"]', !canRedo());
                setDisabled('button[data-action="delete"]', !(hasDeletableNode || hasEdgeSelection));
                setDisabled('button[data-action="align-left"]', selectionCount < 2);
                setDisabled('button[data-action="align-center"]', selectionCount < 2);
                setDisabled('button[data-action="align-right"]', selectionCount < 2);
                setDisabled('button[data-action="align-top"]', selectionCount < 2);
                setDisabled('button[data-action="align-middle"]', selectionCount < 2);
                setDisabled('button[data-action="align-bottom"]', selectionCount < 2);
                setDisabled('button[data-action="distribute-h"]', selectionCount < 3);
                setDisabled('button[data-action="distribute-v"]', selectionCount < 3);
                setDisabled('button[data-action="layer-front"]', selectionCount < 1);
                setDisabled('button[data-action="layer-back"]', selectionCount < 1);
            };

            const applyEdgeBaseStyle = (edge, arrowMode) => {
                if (!edge) {
                    return;
                }
                const mode = normalizeArrowMode(arrowMode || getEdgeArrowMode(edge));
                edge.attr('line/stroke', EDGE_STYLE.stroke);
                edge.attr('line/strokeWidth', EDGE_STYLE.strokeWidth);
                edge.attr('line/strokeLinecap', EDGE_STYLE.strokeLinecap);
                edge.attr('line/strokeLinejoin', EDGE_STYLE.strokeLinejoin);
                edge.attr('line/sourceMarker', mode === 'double' ? EDGE_STYLE.sourceMarker : null);
                edge.attr('line/targetMarker', EDGE_STYLE.targetMarker);
            };

            const setEdgeLineStyle = (edge, style) => {
                if (!edge) {
                    return;
                }
                const normalized = style === 'solid' ? 'solid' : 'dashed';
                applyEdgeBaseStyle(edge);
                edge.attr('line/strokeDasharray', normalized === 'solid' ? '' : EDGE_DASH_PATTERN);
                if (edge.setData) {
                    const prev = edge.getData?.() || {};
                    edge.setData({ ...prev, lineStyle: normalized });
                }
            };

            const setEdgeArrowMode = (edge, mode) => {
                if (!edge) {
                    return;
                }
                const normalized = normalizeArrowMode(mode);
                applyEdgeBaseStyle(edge, normalized);
                if (edge.setData) {
                    const prev = edge.getData?.() || {};
                    edge.setData({ ...prev, arrowMode: normalized });
                }
            };

            const getNodeRect = (node) => {
                const pos = node.position();
                const size = node.size();
                return { x: pos.x, y: pos.y, width: size.width, height: size.height };
            };

            const alignSelectedNodes = (mode) => {
                const nodes = getSelectionNodes();
                if (nodes.length < 2) {
                    return;
                }
                const rects = nodes.map(getNodeRect);
                const minX = Math.min(...rects.map((r) => r.x));
                const maxX = Math.max(...rects.map((r) => r.x + r.width));
                const minY = Math.min(...rects.map((r) => r.y));
                const maxY = Math.max(...rects.map((r) => r.y + r.height));
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;
                nodes.forEach((node) => {
                    const rect = getNodeRect(node);
                    if (mode === 'left') {
                        node.position(minX, rect.y);
                    } else if (mode === 'right') {
                        node.position(maxX - rect.width, rect.y);
                    } else if (mode === 'center') {
                        node.position(centerX - rect.width / 2, rect.y);
                    } else if (mode === 'top') {
                        node.position(rect.x, minY);
                    } else if (mode === 'bottom') {
                        node.position(rect.x, maxY - rect.height);
                    } else if (mode === 'middle') {
                        node.position(rect.x, centerY - rect.height / 2);
                    }
                });
                scheduleSave();
            };

            const distributeSelectedNodes = (axis) => {
                const nodes = getSelectionNodes();
                if (nodes.length < 3) {
                    return;
                }
                if (axis === 'horizontal') {
                    const sorted = nodes.slice().sort((a, b) => a.position().x - b.position().x);
                    const first = sorted[0];
                    const last = sorted[sorted.length - 1];
                    const startX = first.position().x;
                    const endX = last.position().x + last.size().width;
                    const totalWidth = sorted.reduce((sum, node) => sum + node.size().width, 0);
                    const spacing = (endX - startX - totalWidth) / (sorted.length - 1);
                    let cursor = startX;
                    sorted.forEach((node, index) => {
                        if (index === 0) {
                            cursor = startX;
                            return;
                        }
                        const prev = sorted[index - 1];
                        cursor += prev.size().width + spacing;
                        node.position(cursor, node.position().y);
                    });
                } else if (axis === 'vertical') {
                    const sorted = nodes.slice().sort((a, b) => a.position().y - b.position().y);
                    const first = sorted[0];
                    const last = sorted[sorted.length - 1];
                    const startY = first.position().y;
                    const endY = last.position().y + last.size().height;
                    const totalHeight = sorted.reduce((sum, node) => sum + node.size().height, 0);
                    const spacing = (endY - startY - totalHeight) / (sorted.length - 1);
                    let cursor = startY;
                    sorted.forEach((node, index) => {
                        if (index === 0) {
                            cursor = startY;
                            return;
                        }
                        const prev = sorted[index - 1];
                        cursor += prev.size().height + spacing;
                        node.position(node.position().x, cursor);
                    });
                }
                scheduleSave();
            };

            const applyLayering = (direction) => {
                const nodes = getSelectionNodes();
                if (nodes.length === 0) {
                    return;
                }
                if (direction === 'front') {
                    nodes.forEach((node) => {
                        if (typeof node.toFront === 'function') {
                            node.toFront();
                        }
                    });
                } else if (direction === 'back') {
                    nodes.forEach((node) => {
                        if (typeof node.toBack === 'function') {
                            node.toBack();
                        }
                    });
                }
                scheduleSave();
            };

            const isDeletableNode = (node) => {
                if (!node) {
                    return false;
                }
                return true;
            };

            const cleanupNodeResources = (node) => {
                if (!node) {
                    return;
                }
                const nodeId = node.id;
                const overlay = overlayInstances.get(nodeId);
                if (overlay) {
                    if (overlay.globe && typeof overlay.globe.dispose === 'function') {
                        overlay.globe.dispose();
                    }
                    if (overlay.el && overlay.el.remove) {
                        overlay.el.remove();
                    }
                    overlayInstances.delete(nodeId);
                }
                const globe = globeInstances.get(nodeId);
                if (globe) {
                    if (typeof globe.dispose === 'function') {
                        globe.dispose();
                    }
                    globeInstances.delete(nodeId);
                }
            };

            const deleteSelected = () => {
                let removed = false;
                closeLabelEditor(false);
                if (selectedEdge) {
                    const edgeToRemove = selectedEdge;
                    clearEdgeSelected();
                    edgeToRemove.remove();
                    removed = true;
                }
                const nodes = getSelectionNodes();
                nodes.forEach((node) => {
                    if (isDeletableNode(node)) {
                        cleanupNodeResources(node);
                        node.remove();
                        removed = true;
                    }
                });
                if (removed) {
                    clearEdgeSelected();
                    clearNodeSelection();
                    scheduleSave();
                }
            };

            const handleToolbarAction = (action) => {
                switch (action) {
                    case 'delete':
                        deleteSelected();
                        break;
                    default:
                        break;
                }
            };

            const ensureContextMenu = () => {
                if (contextMenuEl) {
                    return contextMenuEl;
                }
                const menu = document.createElement('div');
                menu.className = 'x6-context-menu';
                menu.addEventListener('click', (e) => {
                    const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
                    if (!btn || btn.disabled) {
                        return;
                    }
                    const action = btn.dataset.action;
                    hideContextMenu();
                    if (action === 'delete') {
                        deleteSelected();
                    } else if (action === 'edit-label' && selectedNode) {
                        startLabelEditor(selectedNode);
                    } else if (action === 'swap-direction' && selectedEdge) {
                        const source = selectedEdge.getSource();
                        const target = selectedEdge.getTarget();
                        if (source && target) {
                            selectedEdge.setSource(target);
                            selectedEdge.setTarget(source);
                            scheduleSave();
                        }
                    } else if (action === 'arrow-single' && selectedEdge) {
                        setEdgeArrowMode(selectedEdge, 'single');
                        scheduleSave();
                    } else if (action === 'arrow-double' && selectedEdge) {
                        setEdgeArrowMode(selectedEdge, 'double');
                        scheduleSave();
                    } else if (action === 'add-label') {
                        addLabelNodeQuick();
                    } else if (action === 'upload-image') {
                        if (toolbarFileInput) {
                            toolbarFileInput.click();
                        } else {
                            const tempInput = document.createElement('input');
                            tempInput.type = 'file';
                            tempInput.accept = 'image/*';
                            tempInput.style.display = 'none';
                            container.appendChild(tempInput);
                            tempInput.addEventListener('change', () => {
                                const file = tempInput.files?.[0];
                                if (file) {
                                    addImageNodeFromFile(file);
                                }
                                tempInput.remove();
                            });
                            tempInput.click();
                        }
                    } else if (action === 'line-solid' && selectedEdge) {
                        setEdgeLineStyle(selectedEdge, 'solid');
                        scheduleSave();
                    } else if (action === 'line-dashed' && selectedEdge) {
                        setEdgeLineStyle(selectedEdge, 'dashed');
                        scheduleSave();
                    }
                });
                menu.addEventListener('mousedown', (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                });
                menu.addEventListener('wheel', (e) => {
                    if (e && e.stopPropagation) {
                        e.stopPropagation();
                    }
                });
                container.appendChild(menu);
                contextMenuEl = menu;
                return menu;
            };

            const hideContextMenu = () => {
                if (!contextMenuEl) {
                    return;
                }
                contextMenuEl.classList.remove('show');
                contextMenuEl.innerHTML = '';
            };

            const showContextMenu = (items, clientX, clientY) => {
                const menu = ensureContextMenu();
                menu.innerHTML = items.map((item) => {
                    const disabledAttr = item.disabled ? 'disabled' : '';
                    return `<button class="context-menu-item" data-action="${item.action}" ${disabledAttr}>${item.label}</button>`;
                }).join('');
                const rect = container.getBoundingClientRect();
                const left = Math.max(8, clientX - rect.left);
                const top = Math.max(8, clientY - rect.top);
                menu.style.left = `${left}px`;
                menu.style.top = `${top}px`;
                menu.classList.add('show');
            };

            container.addEventListener('mousemove', (e) => {
                if (e.target && e.target.closest && e.target.closest('.x6-graph-toolbar')) {
                    return;
                }
                lastPointer = { x: e.clientX, y: e.clientY };
            });
            document.addEventListener('mousedown', (e) => {
                if (!contextMenuEl) {
                    return;
                }
                if (contextMenuEl.contains(e.target)) {
                    return;
                }
                hideContextMenu();
            });
            initGraphToolbar();
            if (graph.on) {
                graph.on('history:change', updateToolbarState);
            }

            // ============ Edge Tools Configuration ============
            // vertices: 拖拽连线产生新的拐点来改变路径
            // segments: 拖拽线段来平移整段线条
            const EDGE_TOOLS = [
                {
                    name: 'vertices',
                    args: {
                        attrs: {
                            fill: '#38bdf8',
                            stroke: '#0f172a',
                            strokeWidth: 2,
                            r: 6,
                            cursor: 'move',
                        },
                        addable: true,      // 点击线条添加新顶点
                        removable: true,    // 双击顶点删除
                        stopPropagation: false,
                    },
                },
                {
                    name: 'segments',
                    args: {
                        attrs: {
                            fill: '#22c55e',
                            stroke: '#0f172a',
                            strokeWidth: 2,
                            width: 10,
                            height: 10,
                            cursor: 'move',
                        },
                        threshold: 20,      // 最小线段长度才显示控制点
                        stopPropagation: false,
                    },
                },
            ];

            // ============ Hover 交互逻辑 ============
            // 鼠标移入时显示工具
            graph.on('edge:mouseenter', ({ edge }) => {
                if (hoveredEdge === edge) return;
                // 先清除之前的
                if (hoveredEdge && hoveredEdge !== selectedEdge) {
                    hoveredEdge.removeTools();
                }
                hoveredEdge = edge;
                edge.addTools(EDGE_TOOLS);
            });

            // 鼠标移出时隐藏工具（延迟以便操作）
            graph.on('edge:mouseleave', ({ edge }) => {
                setTimeout(() => {
                    // 如果当前 edge 仍是 hoveredEdge 且未被选中，则移除工具
                    if (hoveredEdge === edge && selectedEdge !== edge) {
                        edge.removeTools();
                        hoveredEdge = null;
                    }
                }, 200);
            });

            // ============ 选中逻辑 ============
            const setEdgeSelected = (edge) => {
                if (!edge || (selectedEdge && selectedEdge.id === edge.id)) {
                    return;
                }
                clearEdgeSelected();
                selectedEdge = edge;
                edge.attr('line/stroke', EDGE_SELECTED_STYLE.stroke);
                edge.attr('line/strokeWidth', EDGE_SELECTED_STYLE.strokeWidth);
                // 选中时确保工具显示
                edge.removeTools();
                edge.addTools(EDGE_TOOLS);
                updateToolbarState();
            };

            const clearEdgeSelected = () => {
                if (!selectedEdge) {
                    return;
                }
                selectedEdge.attr('line/stroke', EDGE_STYLE.stroke);
                selectedEdge.attr('line/strokeWidth', EDGE_STYLE.strokeWidth);
                // 取消选中时移除工具
                selectedEdge.removeTools();
                selectedEdge = null;
                updateToolbarState();
            };

            const setSelectedNode = (node) => {
                setSingleNodeSelection(node);
            };

            const adjustSelectedLabelFont = (delta) => {
                if (!selectedLabelNode) {
                    return;
                }
                const data = selectedLabelNode.getData?.() || {};
                const baseSize = typeof data.manualFontSize === 'number' && data.manualFontSize > 0
                    ? data.manualFontSize
                    : Number(selectedLabelNode.attr('label/fontSize')) || LABEL_STYLE.minFontSize;
                const nextSize = clampFontSize(baseSize + delta);
                const text = data.text ||
                    selectedLabelNode.getLabel?.() ||
                    selectedLabelNode.attr('label/text') ||
                    '';
                const metrics = computeLabelMetricsWithFont(text, nextSize);
                updateLabelData(selectedLabelNode, { manualFontSize: metrics.fontSize });
                selectedLabelNode.resize(metrics.width, metrics.height);
                selectedLabelNode.attr('label/fontSize', metrics.fontSize);
                scheduleSave();
            };

            const getMinSizeByRole = (role) => {
                if (role === 'label') {
                    return { width: 80, height: 20 };
                }
                if (role === 'globe') {
                    return { width: 160, height: 160 };
                }
                return { width: 60, height: 60 };
            };

            const adjustSelectedNodeSize = (delta) => {
                if (!selectedNode) {
                    return;
                }
                const role = getNodeRole(selectedNode);
                if (role === 'label') {
                    const step = delta >= 0 ? LABEL_FONT_STEP : -LABEL_FONT_STEP;
                    adjustSelectedLabelFont(step);
                    return;
                }
                const size = selectedNode.size();
                const minSize = getMinSizeByRole(role);
                const nextWidth = Math.max(size.width + delta, minSize.width);
                const nextHeight = Math.max(size.height + delta, minSize.height);
                selectedNode.resize(nextWidth, nextHeight);
                scheduleSave();
            };

            const createEdgeShape = () => {
                const edge = graph.createEdge({
                    zIndex: 0,
                    attrs: { line: EDGE_STYLE },
                    router: EDGE_ROUTER,
                    connector: EDGE_CONNECTOR,
                    sourceConnectionPoint: {
                        name: 'boundary',
                        args: { offset: 30 },
                    },
                    targetConnectionPoint: {
                        name: 'boundary',
                        args: { offset: EDGE_CONNECTION_OFFSET },
                    },
                });
                setEdgeLineStyle(edge, 'dashed');
                setEdgeArrowMode(edge, EDGE_ARROW_DEFAULT);
                return edge;
            };

            const isPortAvailable = (cellId, portId, end) => {
                return !graph.getEdges().some((edge) => {
                    const terminal = end === 'source' ? edge.getSource() : edge.getTarget();
                    return terminal && terminal.cell === cellId && terminal.port === portId;
                });
            };

            const isPortAvailableForEdge = (edge, cellId, portId, end) => {
                return !graph.getEdges().some((other) => {
                    if (edge && other.id === edge.id) {
                        return false;
                    }
                    const terminal = end === 'source' ? other.getSource() : other.getTarget();
                    return terminal && terminal.cell === cellId && terminal.port === portId;
                });
            };

            if (graph.setConnecting) {
                graph.setConnecting({
                    allowBlank: false,
                    allowLoop: false,
                    allowNode: false,
                    highlight: true,
                    snap: true,
                    createEdge: createEdgeShape,
                    validateMagnet: ({ magnet }) => {
                        if (!shiftPressed) {
                            return false;
                        }
                        if (!magnet || !magnet.getAttribute) {
                            return false;
                        }
                        return !!magnet.getAttribute('port');
                    },
                    validateConnection: ({ sourceCell, targetCell, sourcePort, targetPort }) => {
                        if (!shiftPressed) {
                            return false;
                        }
                        if (!sourceCell || !targetCell || !sourcePort || !targetPort) {
                            return false;
                        }
                        if (sourceCell.id === targetCell.id) {
                            return false;
                        }
                        return isPortAvailable(sourceCell.id, sourcePort, 'source') &&
                            isPortAvailable(targetCell.id, targetPort, 'target');
                    },
                });
            }

            graph.on('edge:added', ({ edge }) => {
                if (!edge) {
                    return;
                }
                const data = edge.getData?.() || {};
                const style = data.lineStyle || 'dashed';
                setEdgeLineStyle(edge, style);
                if (data.arrowMode) {
                    setEdgeArrowMode(edge, data.arrowMode);
                } else {
                    setEdgeArrowMode(edge, EDGE_ARROW_DEFAULT);
                }
            });

            graph.on('edge:click', ({ edge, e }) => {
                if (e && e.stopPropagation) {
                    e.stopPropagation();
                }
                hideContextMenu();
                clearNodeSelection();
                setEdgeSelected(edge);
            });
            graph.on('node:click', ({ node, e }) => {
                if (e && e.stopPropagation) {
                    e.stopPropagation();
                }
                hideContextMenu();
                clearEdgeSelected();
                if (e && e.shiftKey) {
                    toggleNodeSelection(node);
                } else {
                    setSingleNodeSelection(node);
                }
            });
            graph.on('node:dblclick', ({ node, e }) => {
                if (e && e.stopPropagation) {
                    e.stopPropagation();
                }
                if (getNodeRole(node) === 'label') {
                    startLabelEditor(node);
                }
            });
            graph.on('blank:mousedown', () => {
                hideContextMenu();
                closeLabelEditor(true);
                clearEdgeSelected();
                clearNodeSelection();
            });
            graph.on('node:port:mousedown', ({ e }) => {
                if (!shiftPressed) {
                    hideContextMenu();
                    return;
                }
                if (e && e.stopPropagation) {
                    e.stopPropagation();
                }
                if (e && e.preventDefault) {
                    e.preventDefault();
                }
                hideContextMenu();
            });
            graph.on('node:contextmenu', ({ node, e }) => {
                if (e && e.preventDefault) {
                    e.preventDefault();
                }
                if (e && e.stopPropagation) {
                    e.stopPropagation();
                }
                clearEdgeSelected();
                setSingleNodeSelection(node);
                const items = [];
                if (getNodeRole(node) === 'label') {
                    items.push({ label: '编辑文字', action: 'edit-label', disabled: false });
                }
                items.push({ label: '删除节点', action: 'delete', disabled: !isDeletableNode(node) });
                showContextMenu(items, e.clientX, e.clientY);
            });
            graph.on('edge:contextmenu', ({ edge, e }) => {
                if (e && e.preventDefault) {
                    e.preventDefault();
                }
                if (e && e.stopPropagation) {
                    e.stopPropagation();
                }
                clearNodeSelection();
                setEdgeSelected(edge);
                const currentStyle = getEdgeLineStyle(edge);
                const currentArrow = getEdgeArrowMode(edge);
                showContextMenu([
                    { label: '交换方向', action: 'swap-direction', disabled: false },
                    { label: '单端箭头', action: 'arrow-single', disabled: currentArrow === 'single' },
                    { label: '双端箭头', action: 'arrow-double', disabled: currentArrow === 'double' },
                    { label: '实线', action: 'line-solid', disabled: currentStyle === 'solid' },
                    { label: '虚线', action: 'line-dashed', disabled: currentStyle === 'dashed' },
                    { label: '删除连线', action: 'delete', disabled: false },
                ], e.clientX, e.clientY);
            });
            graph.on('blank:contextmenu', ({ e }) => {
                if (e && e.preventDefault) {
                    e.preventDefault();
                }
                clearEdgeSelected();
                clearNodeSelection();
                showContextMenu([
                    { label: '上传图片', action: 'upload-image', disabled: false },
                    { label: '添加文字', action: 'add-label', disabled: false },
                ], e.clientX, e.clientY);
            });
            graph.on('node:removed', ({ node }) => {
                if (selectedNodes.has(node)) {
                    selectedNodes.delete(node);
                    syncSelectedLabelNode();
                    updateToolbarState();
                }
                if (labelEditor && labelEditor.node === node) {
                    closeLabelEditor(false);
                }
            });
            graph.on('edge:removed', ({ edge }) => {
                if (selectedEdge && edge && selectedEdge.id === edge.id) {
                    clearEdgeSelected();
                }
            });

            document.addEventListener('keydown', (e) => {
                const target = e.target;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                    return;
                }
                if ((e.key === 'Delete' || e.key === 'Backspace')) {
                    if (selectedEdge || selectedNodes.size > 0) {
                        e.preventDefault();
                        deleteSelected();
                    }
                    return;
                }
                if (!selectedNode) {
                    return;
                }
                const role = getNodeRole(selectedNode);
                if (e.key === '+' || e.key === '=') {
                    e.preventDefault();
                    adjustSelectedNodeSize(10);
                } else if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    adjustSelectedNodeSize(-10);
                }
            });

            graph.on('node:port:click', ({ node, port, e }) => {
                if (!selectedEdge) {
                    return;
                }
                if (!shiftPressed) {
                    return;
                }
                if (e && e.stopPropagation) {
                    e.stopPropagation();
                }
                const portId = (port && (port.id || port.port)) || port;
                if (!portId) {
                    return;
                }
                const sourceCell = selectedEdge.getSourceCell && selectedEdge.getSourceCell();
                const targetCell = selectedEdge.getTargetCell && selectedEdge.getTargetCell();
                let end = 'target';
                if (sourceCell && sourceCell.id === node.id) {
                    end = 'source';
                } else if (targetCell && targetCell.id === node.id) {
                    end = 'target';
                } else if (e && e.shiftKey) {
                    end = 'source';
                }
                if (!isPortAvailableForEdge(selectedEdge, node.id, portId, end)) {
                    return;
                }
                if (end === 'source') {
                    selectedEdge.setSource({ cell: node.id, port: portId });
                } else {
                    selectedEdge.setTarget({ cell: node.id, port: portId });
                }
            });

            const getPreferredPortPairs = (sourceNode, targetNode) => {
                const sPos = sourceNode.position();
                const tPos = targetNode.position();
                const dx = tPos.x - sPos.x;
                const dy = tPos.y - sPos.y;
                const horizontalFirst = Math.abs(dx) >= Math.abs(dy);
                if (horizontalFirst) {
                    return dx >= 0
                        ? [['out', 'in'], ['bottom', 'top'], ['top', 'bottom'], ['in', 'out']]
                        : [['in', 'out'], ['bottom', 'top'], ['top', 'bottom'], ['out', 'in']];
                }
                return dy >= 0
                    ? [['bottom', 'top'], ['out', 'in'], ['in', 'out'], ['top', 'bottom']]
                    : [['top', 'bottom'], ['out', 'in'], ['in', 'out'], ['bottom', 'top']];
            };

            const createEdge = (sourceId, targetId, sourcePort, targetPort) => {
                const sourceNode = graph.getCellById(sourceId);
                const targetNode = graph.getCellById(targetId);
                if (!sourceNode || !targetNode) {
                    return null;
                }

                let srcPort = sourcePort || null;
                let tgtPort = targetPort || null;
                if (!srcPort || !tgtPort) {
                    const pairs = getPreferredPortPairs(sourceNode, targetNode);
                    for (const [srcSuffix, tgtSuffix] of pairs) {
                        const candidateSrc = `${sourceId}-${srcSuffix}`;
                        const candidateTgt = `${targetId}-${tgtSuffix}`;
                        if (isPortAvailable(sourceId, candidateSrc, 'source') &&
                            isPortAvailable(targetId, candidateTgt, 'target')) {
                            srcPort = candidateSrc;
                            tgtPort = candidateTgt;
                            break;
                        }
                    }
                }

                if (!srcPort || !tgtPort) {
                    return null;
                }

                const edge = createEdgeShape();
                edge.setSource({ cell: sourceId, port: srcPort });
                edge.setTarget({ cell: targetId, port: tgtPort });
                return graph.addEdge(edge);
            };

            const hiddenDefaultNodes = new Set(
                Array.isArray(savedLayout.hiddenDefaultNodes) ? savedLayout.hiddenDefaultNodes : []
            );
            const shouldCreateDefault = (id) => !hiddenDefaultNodes.has(id);

            const fig1 = shouldCreateDefault('fig1')
                ? createNode('fig1', 60, 260, `${IMAGE_BASE}fig1.png`)
                : null;
            const fig2 = shouldCreateDefault('fig2')
                ? createNode('fig2', 240, 260, `${IMAGE_BASE}fig2.png`)
                : null;
            const fig3 = shouldCreateDefault(GLOBE_NODE_ID)
                ? createGlobeNode(GLOBE_NODE_ID, 420, 240) // Width 220, ends at 640
                : null;
            const fig4 = shouldCreateDefault('fig4')
                ? createNode('fig4', 700, 260, `${IMAGE_BASE}fig4.png`) // Was 600, moved to 700
                : null;
            const fig5 = shouldCreateDefault('fig5')
                ? createNode('fig5', 880, 260, `${IMAGE_BASE}fig5.png`) // Was 780, moved to 880
                : null;
            const fig6 = shouldCreateDefault('fig6')
                ? createNode('fig6', 1060, 260, `${IMAGE_BASE}fig6.png`) // Was 960, moved to 1060
                : null;
            const fig7 = shouldCreateDefault('fig7')
                ? createNode('fig7', 1240, 260, `${IMAGE_BASE}fig7.png`) // Was 1140, moved to 1240
                : null;

            const labelOffsetX = 132;
            const labelOffsetY = 48;
            const label1 = shouldCreateDefault('fig1_label')
                ? createLabel('fig1_label', 60 + labelOffsetX, 260 + labelOffsetY, '传感器')
                : null;
            const label2 = shouldCreateDefault('fig2_label')
                ? createLabel('fig2_label', 240 + labelOffsetX, 260 + labelOffsetY, '卫星通信终端')
                : null;
            const globeLabelOffsetX = 232;
            const label3 = shouldCreateDefault('fig3_label')
                ? createLabel('fig3_label', 420 + globeLabelOffsetX, 240 + labelOffsetY, '低轨星座')
                : null;
            const label4 = shouldCreateDefault('fig4_label')
                ? createLabel('fig4_label', 700 + labelOffsetX, 260 + labelOffsetY, '南邮卫星相控阵地面站')
                : null;
            const label5 = shouldCreateDefault('fig5_label')
                ? createLabel('fig5_label', 880 + labelOffsetX, 260 + labelOffsetY, '卫星数据接入系统')
                : null;
            const label6 = shouldCreateDefault('fig6_label')
                ? createLabel('fig6_label', 1060 + labelOffsetX, 260 + labelOffsetY, '5G基站')
                : null;

            const getSavedNodePosition = (nodeId) => {
                const info = savedLayout.nodes && savedLayout.nodes[nodeId];
                if (info && typeof info.x === 'number' && typeof info.y === 'number') {
                    return { x: info.x, y: info.y };
                }
                return null;
            };

            const dynamicNodes = [];
            const dynamicLabels = [];
            const restoredDynamic = Array.isArray(savedLayout.dynamicNodes) ? savedLayout.dynamicNodes : [];
            restoredDynamic.forEach((item) => {
                if (!item || !item.id || DEFAULT_NODE_IDS.has(item.id)) {
                    return;
                }
                const savedPos = getSavedNodePosition(item.id);
                if (item.type === 'label') {
                    const text = String(item.text || '').trim();
                    const labelText = text || '文字';
                    const metrics = (typeof item.manualFontSize === 'number' && item.manualFontSize > 0)
                        ? computeLabelMetricsWithFont(labelText, item.manualFontSize)
                        : fitLabel(labelText);
                    const pos = savedPos || { x: 60, y: 60 };
                    const label = createLabel(item.id, pos.x, pos.y, labelText);
                    if (typeof item.manualFontSize === 'number' && item.manualFontSize > 0) {
                        updateLabelData(label, { manualFontSize: item.manualFontSize });
                    }
                    label.resize(metrics.width, metrics.height);
                    dynamicLabels.push(label);
                    return;
                }
                if (item.type === 'image') {
                    const imageUrl = normalizeImageUrl(item.imageUrl || '');
                    const pos = savedPos || { x: 60, y: 60 };
                    const node = createNode(item.id, pos.x, pos.y, imageUrl);
                    dynamicNodes.push(node);
                }
            });

            const applyLayout = (node) => {
                const info = savedLayout.nodes[node.id];
                if (!info) {
                    return;
                }
                if (typeof info.x === 'number' && typeof info.y === 'number') {
                    node.position(info.x, info.y);
                }
                if (typeof info.width === 'number' && typeof info.height === 'number') {
                    if (getNodeRole(node) === 'globe') {
                        const width = Math.max(info.width, 180);
                        const height = Math.max(info.height, 180);
                        node.resize(width, height);
                    } else {
                        node.resize(info.width, info.height);
                    }
                }
                if (getNodeRole(node) === 'label' &&
                    typeof info.manualFontSize === 'number' &&
                    info.manualFontSize > 0) {
                    updateLabelData(node, { manualFontSize: info.manualFontSize });
                }
                updateLabelFont(node);
            };

            [fig1, fig2, fig3, fig4, fig5, fig6, fig7, label1, label2, label3, label4, label5, label6, ...dynamicNodes, ...dynamicLabels]
                .filter(Boolean)
                .forEach(applyLayout);

            if (fig3) {
                mountGlobeNode(fig3);
            }

            const savedEdges = savedLayout.edges || [];
            if (savedEdges.length > 0) {
                savedEdges.forEach((edgeInfo) => {
                    if (!edgeInfo || !edgeInfo.source || !edgeInfo.target) {
                        return;
                    }
                    const getTerminalCellId = (terminal) => {
                        if (!terminal) {
                            return null;
                        }
                        if (typeof terminal === 'string') {
                            return terminal;
                        }
                        if (typeof terminal === 'object') {
                            return terminal.cell || terminal.id || null;
                        }
                        return null;
                    };
                    const sourceId = getTerminalCellId(edgeInfo.source);
                    const targetId = getTerminalCellId(edgeInfo.target);
                    if (!sourceId || !targetId) {
                        return;
                    }
                    if (!graph.getCellById(sourceId) || !graph.getCellById(targetId)) {
                        return;
                    }
                    const edge = createEdgeShape();
                    edge.setSource(edgeInfo.source);
                    edge.setTarget(edgeInfo.target);
                    // Restore saved vertices for persistent line routing
                    if (Array.isArray(edgeInfo.vertices) && edgeInfo.vertices.length > 0) {
                        edge.setVertices(edgeInfo.vertices);
                    }
                    if (edgeInfo.lineStyle) {
                        setEdgeLineStyle(edge, edgeInfo.lineStyle);
                    }
                    if (edgeInfo.arrowMode) {
                        setEdgeArrowMode(edge, edgeInfo.arrowMode);
                    } else {
                        setEdgeArrowMode(edge, EDGE_ARROW_DEFAULT);
                    }
                    graph.addEdge(edge);
                });
            }

            if (savedLayout.viewport && typeof savedLayout.viewport.scale === 'number') {
                const { scale, tx, ty } = savedLayout.viewport;
                if (graph.scale) {
                    graph.scale(scale);
                }
                if (graph.translate) {
                    graph.translate(tx || 0, ty || 0);
                }
            } else if (Object.keys(savedLayout.nodes || {}).length === 0) {
                if (graph.zoomToFit) {
                    graph.zoomToFit({ padding: 30, maxScale: 2.2 });
                } else {
                    graph.centerContent();
                }
            }

            // ============ 自动缩放适配逻辑 ============
            // 监听容器大小变化，自动调整内容适应视口，防止遮挡
            const fitGraphContent = () => {
                if (!graph) return;

                // 使用 zoomToFit 确保所有内容都在视口内
                if (graph.zoomToFit) {
                    // padding: 留白，maxScale: 防止内容过小时被过度放大
                    graph.zoomToFit({ padding: 24, maxScale: 2.2 });

                    // 确保居中
                    graph.centerContent();
                }
            };

            // 使用 ResizeObserver 监听容器特定的变化（比 window.resize 更准确）
            if (typeof ResizeObserver !== 'undefined') {
                let resizeTimer;
                const resizeObserver = new ResizeObserver(() => {
                    // 节流处理
                    if (resizeTimer) clearTimeout(resizeTimer);
                    resizeTimer = setTimeout(fitGraphContent, 100);
                });
                resizeObserver.observe(container);
            }

            // 窗口 resize 作为备份
            window.addEventListener('resize', () => {
                setTimeout(fitGraphContent, 200);
            });

            // 初始化后延迟执行一次，确保布局加载完成
            setTimeout(fitGraphContent, 500);
        };
    })();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initArchitectureGraph);
    } else {
        initArchitectureGraph();
    }
})();
