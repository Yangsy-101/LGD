// ==================== Map Logic ====================

let nanjingMap = null;
let mapMarkers = {};
let mapInitAttempts = 0;
let mapHasFit = false;

const MAP_CONFIG = {
    tileProvider: 'amap',
    fallbackProviders: ['geoq', 'osm'],
    errorSwitchThreshold: 6,
    probeTimeoutMs: 4000,
    useGcj02: true,
    mapOptions: {
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
        zoomAnimation: false,
        markerZoomAnimation: false,
        fadeAnimation: false,
        inertia: true,
        inertiaDeceleration: 3000
    },
    tileOptions: {
        updateWhenIdle: true,
        updateWhenZooming: false,
        keepBuffer: 1,
        detectRetina: false
    }
};

const PROJECT20_MAP_BACKEND_PORT = '8090';
const normalizeProject20MapApiBase = (value) => String(value || '').replace(/\/$/, '');

const isProject20MapLocalPreviewHost = (hostname) =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

const buildProject20MapOrigin = (protocol, hostname, port) =>
    `${protocol}//${hostname}${port ? `:${port}` : ''}`;

const resolveMapApiBase = () => {
    if (typeof window === 'undefined' || !window.location) {
        return '';
    }
    if (window.__PROJECT20_API_BASE__) {
        return normalizeProject20MapApiBase(window.__PROJECT20_API_BASE__);
    }
    if (window.__API_BASE__) {
        return normalizeProject20MapApiBase(window.__API_BASE__);
    }

    const { protocol, hostname, port, pathname } = window.location;
    if (protocol === 'file:') {
        return 'http://127.0.0.1:8090';
    }
    if (isProject20MapLocalPreviewHost(hostname) && port && port !== PROJECT20_MAP_BACKEND_PORT) {
        return `${protocol}//${hostname}:${PROJECT20_MAP_BACKEND_PORT}`;
    }
    if (pathname.startsWith('/project2-0/')) {
        return `${buildProject20MapOrigin(protocol, hostname, port)}/project2-0`;
    }
    return '';
};

const MAP_API_BASE = resolveMapApiBase();
const buildMapApiUrl = (path) => `${normalizeProject20MapApiBase(MAP_API_BASE)}${path.startsWith('/') ? path : `/${path}`}`;
const parseProject20MapJsonResponse = async (response, requestLabel) => {
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

const TILE_PROVIDERS = [
    {
        id: 'amap',
        name: 'Amap Vector',
        url: 'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        attribution: '&copy; <a href="https://lbs.amap.com/">Amap</a>'
    },
    {
        id: 'osm',
        name: 'OpenStreetMap',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c'],
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    },
    {
        id: 'geoq',
        name: 'GeoQ China Online',
        url: 'https://map.geoq.cn/arcgis/rest/services/ChinaOnlineStreetWarm/MapServer/tile/{z}/{y}/{x}',
        subdomains: [],
        attribution: '&copy; <a href="https://www.geoq.cn/">GeoQ</a>'
    }
];

function getTileProvider(id) {
    return TILE_PROVIDERS.find(provider => provider.id === id);
}

function createTileLayer(provider) {
    const options = {
        attribution: '',
        subdomains: provider.subdomains,
        minZoom: 5,
        maxZoom: 18
    };
    if (MAP_CONFIG.tileOptions) {
        Object.assign(options, MAP_CONFIG.tileOptions);
    }
    return L.tileLayer(provider.url, options);
}

function addTileLayerWithFallback(map) {
    const providerIds = [
        MAP_CONFIG.tileProvider,
        ...(MAP_CONFIG.fallbackProviders || [])
    ].filter(Boolean);

    let providerIndex = 0;
    let layer = null;
    let errorCount = 0;
    let successCount = 0;
    let probeTimer = null;

    const clearProbeTimer = () => {
        if (probeTimer) {
            clearTimeout(probeTimer);
            probeTimer = null;
        }
    };

    const scheduleProbeTimer = () => {
        clearProbeTimer();
        probeTimer = setTimeout(() => {
            if (successCount === 0) {
                switchProvider('no tile loaded');
            }
        }, MAP_CONFIG.probeTimeoutMs || 4000);
    };

    const switchProvider = (reason) => {
        const nextId = providerIds[++providerIndex];
        if (!nextId) {
            return;
        }
        const nextProvider = getTileProvider(nextId);
        if (!nextProvider) {
            switchProvider(reason);
            return;
        }

        if (layer && map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
        errorCount = 0;
        successCount = 0;

        layer = createTileLayer(nextProvider).addTo(map);
        bindLayerEvents();
        scheduleProbeTimer();
        console.info(`Switched tile provider to ${nextProvider.name} (${reason})`);
    };

    const handleTileError = () => {
        errorCount += 1;
        if (errorCount >= MAP_CONFIG.errorSwitchThreshold && successCount === 0) {
            switchProvider('tile error');
        }
    };

    const handleTileLoad = () => {
        successCount += 1;
        clearProbeTimer();
    };

    const bindLayerEvents = () => {
        layer.on('tileerror', handleTileError);
        layer.on('tileload', handleTileLoad);
    };

    const initialProvider = getTileProvider(providerIds[0]) || TILE_PROVIDERS[0];
    layer = createTileLayer(initialProvider).addTo(map);
    bindLayerEvents();
    scheduleProbeTimer();

    return layer;
}

const GCJ02_A = 6378245.0;
const GCJ02_EE = 0.00669342162296594323;

function outOfChina(lat, lng) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
}

function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
}

function wgs84ToGcj02(lat, lng) {
    if (outOfChina(lat, lng)) {
        return { lat, lng };
    }
    const dLat = transformLat(lng - 105.0, lat - 35.0);
    const dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * Math.PI;
    const magic = Math.sin(radLat);
    const sqrtMagic = Math.sqrt(1 - GCJ02_EE * magic * magic);
    const mgLat = lat + (dLat * 180.0) / ((GCJ02_A * (1 - GCJ02_EE)) / (sqrtMagic * sqrtMagic) * Math.PI);
    const mgLng = lng + (dLng * 180.0) / (GCJ02_A / sqrtMagic * Math.cos(radLat) * Math.PI);
    return { lat: mgLat, lng: mgLng };
}

function normalizeLatLng(lat, lng) {
    if (!MAP_CONFIG.useGcj02) {
        return { lat, lng };
    }
    return wgs84ToGcj02(lat, lng);
}

function initMap() {
    const mapContainer = document.getElementById('nanjingMap');
    if (!mapContainer) {
        console.log('Map container missing, skip init');
        return;
    }

    if (!window.L) {
        mapInitAttempts += 1;
        if (mapInitAttempts <= 10) {
            console.warn('Leaflet not ready, retrying...');
            setTimeout(initMap, 500);
        } else {
            console.error('Leaflet failed to load after retries.');
        }
        return;
    }

    console.log('Initializing map...');

    const mapCenter = normalizeLatLng(31.2, 114.0);
    nanjingMap = L.map('nanjingMap', MAP_CONFIG.mapOptions || {}).setView([mapCenter.lat, mapCenter.lng], 5);

    addTileLayerWithFallback(nanjingMap);

    console.log('Map tiles loaded');

    updateMapMarkers();

    // Ensure correct sizing after layout changes
    setTimeout(() => {
        invalidateDashboardMapSize();
    }, 200);
}

async function updateMapMarkers() {
    if (!nanjingMap) return;

    try {
        const response = await fetch(buildMapApiUrl('/api/access_points'));
        const result = await parseProject20MapJsonResponse(response, 'GET /api/access_points');

        if (result.success) {
            const points = result.data || [];
            const latLngs = [];

            Object.values(mapMarkers).forEach(marker => marker.remove());
            mapMarkers = {};

            const customIcon = L.divIcon({
                className: 'custom-map-marker',
                html: '<div class="marker-pin"></div><i class="fas fa-satellite-dish"></i>',
                iconSize: [30, 42],
                iconAnchor: [15, 42],
                popupAnchor: [0, -35]
            });

            points.forEach(point => {
                if (point.lat != null && point.lng != null) {
                    const position = normalizeLatLng(point.lat, point.lng);
                    latLngs.push([position.lat, position.lng]);
                    const marker = L.marker([position.lat, position.lng], { icon: customIcon })
                        .addTo(nanjingMap)
                        .bindPopup(`<b>${point.name}</b><br>SN: ${point.sn_code}<br>${point.location}`);

                    marker.on('click', () => {
                        if (typeof switchAccessPoint === 'function') {
                            switchAccessPoint(point.sn_code);
                        }
                    });

                    mapMarkers[point.sn_code] = marker;
                }
            });

            if (!mapHasFit && latLngs.length > 0) {
                nanjingMap.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
                mapHasFit = true;
            }

            console.log(`Map markers updated: ${Object.keys(mapMarkers).length}`);
        }
    } catch (error) {
        console.error('Failed to load map points:', error);
    }
}

function highlightCurrentMapMarker() {
    if (!nanjingMap || typeof state === 'undefined' || !state.currentAccessPoint) return;

    const currentSN = state.currentAccessPoint;
    const marker = mapMarkers[currentSN];

    if (marker) {
        marker.openPopup();
        nanjingMap.setView(marker.getLatLng(), 12);
    }
}

function invalidateDashboardMapSize() {
    if (!nanjingMap) {
        return;
    }
    nanjingMap.invalidateSize({ pan: false });
}

window.invalidateDashboardMapSize = invalidateDashboardMapSize;
