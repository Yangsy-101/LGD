
(function () {
  const BASE_W = 1920;
  const BASE_H = 1080;

  const BLOOM_LAYER = 1;

  const screenRoot = document.getElementById('screen-root');
  const mapCanvas = document.getElementById('main-canvas');

  const tooltipEl = document.getElementById('tooltip');

  const bloomLayer = new THREE.Layers();
  bloomLayer.set(BLOOM_LAYER);

  const state = {
    time: 0,
    ready: false,
    bootStarted: false,
    fallbackBuilt: false,
    mapScale: 1 / 90000,
    mapCenterX: 0,
    mapCenterY: 0,
    mapThickness: 1.35,
    hoveredProvince: null,
    mapBounding: { minX: -200, maxX: 200, minY: -140, maxY: 140 },
    njDataFlows: [],
  };

  const geoUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';
  const geoUrlAlt = 'https://geo.datav.aliyun.com/areas_v3/bound/100000.json';
  const geoUrlLocal = './data/china.json';

  const hainanGeoKey = 'hainan';
  const hainanGeoUrlLocal = './data/hainan.json';
  const hainanGeoUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/460000_full.json';
  const hainanGeoUrlAlt = 'https://geo.datav.aliyun.com/areas_v3/bound/460000.json';

  const nanjingGeoKey = 'nanjing';
  const nanjingGeoUrlLocal = './data/nanjing.json';
  const nanjingGeoUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/320100_full.json';
  const nanjingGeoUrlAlt = 'https://geo.datav.aliyun.com/areas_v3/bound/320100.json';

  let nodeGlowTex = null;
  let starfield = null;
  let energyBase = null;
  let radarRing = null;
  let sweepLight = null;
  const flowLines = [];
  const flowTubes = [];
  const flowPackets = [];
  let scenarioInited = false;

  const tryFetchJson = (url) =>
    fetch(url, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`geo fetch failed: ${url}`);
      return r.json();
    });

  function getEmbeddedGeoJSON(key) {
    return window.LGD_LOCAL_GEOJSONS && window.LGD_LOCAL_GEOJSONS[key];
  }

  function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label || 'operation'} timeout`)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
      if (timer) window.clearTimeout(timer);
    });
  }

  function lonLatWalker(coords, cb) {
    if (!Array.isArray(coords) || coords.length === 0) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      cb(coords[0], coords[1]);
      return;
    }
    for (const c of coords) lonLatWalker(c, cb);
  }

  function getGeometryBounds(geom) {
    const b = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
    if (!geom || !geom.coordinates) return b;
    lonLatWalker(geom.coordinates, (lng, lat) => {
      if (lng < b.minLng) b.minLng = lng;
      if (lat < b.minLat) b.minLat = lat;
      if (lng > b.maxLng) b.maxLng = lng;
      if (lat > b.maxLat) b.maxLat = lat;
    });
    return b;
  }

  function mergeBounds(a, b) {
    return {
      minLng: Math.min(a.minLng, b.minLng),
      minLat: Math.min(a.minLat, b.minLat),
      maxLng: Math.max(a.maxLng, b.maxLng),
      maxLat: Math.max(a.maxLat, b.maxLat),
    };
  }

  function geojsonBounds(geo) {
    let b = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
    if (!geo || !Array.isArray(geo.features)) return b;
    for (const f of geo.features) b = mergeBounds(b, getGeometryBounds(f.geometry));
    return b;
  }

  function projectToView(lng, lat, bounds, w, h, pad) {
    const padPx = pad || 10;
    const dx = Math.max(1e-9, bounds.maxLng - bounds.minLng);
    const dy = Math.max(1e-9, bounds.maxLat - bounds.minLat);
    const sx = (w - padPx * 2) / dx;
    const sy = (h - padPx * 2) / dy;
    const s = Math.min(sx, sy);
    const ox = padPx + (w - padPx * 2 - dx * s) * 0.5;
    const oy = padPx + (h - padPx * 2 - dy * s) * 0.5;
    const x = ox + (lng - bounds.minLng) * s;
    const y = oy + (bounds.maxLat - lat) * s;
    return { x, y };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function clampPoint(pt, w, h, margin) {
    const m = margin || 0;
    return {
      x: clamp(pt.x, m, w - m),
      y: clamp(pt.y, m, h - m),
    };
  }

  function ringToPath(ring, bounds, w, h) {
    if (!Array.isArray(ring) || ring.length === 0) return '';
    let d = '';
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      if (!p || p.length < 2) continue;
      const pt = projectToView(p[0], p[1], bounds, w, h, 10);
      d += i === 0 ? `M ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}` : ` L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
    }
    d += ' Z';
    return d;
  }

  function polygonAreaLonLat(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[i];
      const q = ring[j];
      if (!p || !q) continue;
      a += (q[0] - p[0]) * (q[1] + p[1]);
    }
    return Math.abs(a) * 0.5;
  }

  function maxOuterRingAreaAndBounds(geom) {
    let bestArea = 0;
    let bestBounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
    if (!geom || !geom.coordinates) return { area: 0, bounds: bestBounds };
    const coords = geom.coordinates;

    const considerPoly = (poly) => {
      if (!Array.isArray(poly) || !poly.length) return;
      const outer = poly[0];
      const a = polygonAreaLonLat(outer);
      if (a <= bestArea) return;
      bestArea = a;
      bestBounds = getGeometryBounds({ type: 'Polygon', coordinates: poly });
    };

    if (geom.type === 'Polygon') {
      considerPoly(coords);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of coords) considerPoly(poly);
    }
    return { area: bestArea, bounds: bestBounds };
  }

  function geometryToPath(geom, bounds, w, h) {
    if (!geom || !geom.coordinates) return '';
    const t = geom.type;
    const c = geom.coordinates;
    let d = '';
    if (t === 'Polygon') {
      for (const ring of c) d += ringToPath(ring, bounds, w, h);
      return d;
    }
    if (t === 'MultiPolygon') {
      for (const poly of c) for (const ring of poly) d += ringToPath(ring, bounds, w, h);
      return d;
    }
    return '';
  }

  function findFeatureByName(geo, nameIncludes) {
    if (!geo || !Array.isArray(geo.features)) return null;
    const key = String(nameIncludes || '').trim();
    if (!key) return null;
    for (const f of geo.features) {
      const p = f && f.properties;
      const n = (p && (p.name || p.NAME || p.fullname || p.FULLNAME)) || '';
      if (typeof n === 'string' && n.includes(key)) return f;
    }
    return null;
  }

  function boundsCenter(b) {
    return { lng: (b.minLng + b.maxLng) * 0.5, lat: (b.minLat + b.maxLat) * 0.5 };
  }

  async function loadHainanAdminGeoJSON() {
    const embedded = getEmbeddedGeoJSON(hainanGeoKey);
    if (embedded) return embedded;

    const local = await tryFetchJson(hainanGeoUrlLocal).catch(() => null);
    if (local) return local;

    const base = await tryFetchJson(hainanGeoUrl).catch(() => tryFetchJson(hainanGeoUrlAlt));
    const feats = (base && Array.isArray(base.features) && base.features) || [];

    const adcodes = [];
    for (const f of feats) {
      const ac = f && f.properties && f.properties.adcode;
      if (!ac) continue;
      const s = String(ac);
      if (s.startsWith('46')) adcodes.push(s);
    }
    if (adcodes.length === 0) return base;

    const subFetches = adcodes.map((ac) => {
      const isCityLevel = /00$/.test(ac);
      const fullUrl = `https://geo.datav.aliyun.com/areas_v3/bound/${ac}_full.json`;
      const url = `https://geo.datav.aliyun.com/areas_v3/bound/${ac}.json`;

      // Reduce 404 noise: county-level (4690xx etc.) doesn't provide *_full.
      if (!isCityLevel) return tryFetchJson(url).catch(() => null);

      // Known: 460400_full often 404; try plain json first.
      if (ac === '460400') return tryFetchJson(url).catch(() => null);

      return tryFetchJson(fullUrl).catch(() => tryFetchJson(url).catch(() => null));
    });
    const subs = await Promise.all(subFetches);
    const merged = [];
    for (const s of subs) {
      if (s && Array.isArray(s.features)) merged.push(...s.features);
    }
    if (merged.length) return { type: 'FeatureCollection', features: merged, __cityFeatures: feats };
    return { ...(base || {}), __cityFeatures: feats };
  }

  function renderHainanAdminSVG(geo) {
    const svg = document.getElementById('hainan-map-svg');
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const W = 320;
    let H = 220;
    if (rect && rect.width > 0 && rect.height > 0) {
      H = Math.round(W * (rect.height / rect.width));
      H = Math.max(220, Math.min(520, H));
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    const lg = document.createElementNS(ns, 'linearGradient');
    lg.setAttribute('id', 'hnFill');
    lg.setAttribute('x1', '0');
    lg.setAttribute('y1', '0');
    lg.setAttribute('x2', '1');
    lg.setAttribute('y2', '1');
    const mkStop = (off, col) => {
      const s = document.createElementNS(ns, 'stop');
      s.setAttribute('offset', off);
      s.setAttribute('stop-color', col);
      return s;
    };
    lg.appendChild(mkStop('0', 'rgba(52,220,255,0.16)'));
    lg.appendChild(mkStop('0.65', 'rgba(52,220,255,0.05)'));
    lg.appendChild(mkStop('1', 'rgba(0,0,0,0.02)'));
    defs.appendChild(lg);
    svg.appendChild(defs);

    const featuresAll = (geo && Array.isArray(geo.features) && geo.features) || [];
    let mainBounds = null;
    let mainArea = 0;
    for (const f of featuresAll) {
      const r = maxOuterRingAreaAndBounds(f.geometry);
      if (r.area > mainArea && Number.isFinite(r.bounds.maxLat)) {
        mainArea = r.area;
        mainBounds = r.bounds;
      }
    }

    // Fallback to entire bounds if we can't detect main island.
    if (!mainBounds || !Number.isFinite(mainBounds.maxLat)) {
      mainBounds = geojsonBounds({ type: 'FeatureCollection', features: featuresAll });
    }

    const padLng = (mainBounds.maxLng - mainBounds.minLng) * 0.18;
    const padLat = (mainBounds.maxLat - mainBounds.minLat) * 0.18;
    const expanded = {
      minLng: mainBounds.minLng - padLng,
      maxLng: mainBounds.maxLng + padLng,
      minLat: mainBounds.minLat - padLat,
      maxLat: mainBounds.maxLat + padLat,
    };

    const intersects = (a, b) => !(a.maxLng < b.minLng || a.minLng > b.maxLng || a.maxLat < b.minLat || a.minLat > b.maxLat);
    const features = [];
    for (const f of featuresAll) {
      const fb = getGeometryBounds(f.geometry);
      if (!Number.isFinite(fb.maxLat)) continue;
      if (!intersects(fb, expanded)) continue;
      // discard tiny speckles far from main island
      const r = maxOuterRingAreaAndBounds(f.geometry);
      if (mainArea > 0 && r.area < mainArea * 0.0004) continue;
      features.push(f);
    }
    const b = geojsonBounds({ type: 'FeatureCollection', features: features.length ? features : featuresAll });
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(g);

    for (const f of features) {
      const d = geometryToPath(f.geometry, b, W, H);
      if (!d) continue;
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'url(#hnFill)');
      p.setAttribute('stroke', 'rgba(52,220,255,0.22)');
      p.setAttribute('stroke-width', '1');
      g.appendChild(p);
    }

    const haikouF = findFeatureByName({ type: 'FeatureCollection', features }, '海口');
    const haikouB = haikouF ? getGeometryBounds(haikouF.geometry) : null;
    const hc = haikouB && Number.isFinite(haikouB.minLng) ? boundsCenter(haikouB) : { lng: 110.33119, lat: 20.031971 };
    const haikouXY0 = projectToView(hc.lng, hc.lat, b, W, H, 10);
    const haikouXY = clampPoint(haikouXY0, W, H, 24);

    // 强制显示海口市名称（重点高亮），保证不会看不到
    const hkText = document.createElementNS(ns, 'text');
    hkText.setAttribute('class', 'hn-city-label hn-city-label--focus');
    hkText.setAttribute('x', haikouXY.x.toFixed(2));
    hkText.setAttribute('y', (haikouXY.y + 5).toFixed(2));
    hkText.textContent = '海口';
    svg.appendChild(hkText);

    // "海口公路"：在海口附近拉开一点距离（两个网关不要太近）
    const roadLonLat = {
      lng: Math.min(b.maxLng, Math.max(b.minLng, hc.lng + (b.maxLng - b.minLng) * 0.26)),
      lat: Math.max(b.minLat, Math.min(b.maxLat, hc.lat - (b.maxLat - b.minLat) * 0.20)),
    };
    let roadXY = clampPoint(projectToView(roadLonLat.lng, roadLonLat.lat, b, W, H, 10), W, H, 26);

    // 保证两个网关在屏幕上有明显距离
    const minSepPx = 150;
    let dxp = roadXY.x - haikouXY.x;
    let dyp = roadXY.y - haikouXY.y;
    let dd = Math.hypot(dxp, dyp);
    if (dd < 1e-6) {
      dxp = 1;
      dyp = 0;
      dd = 1;
    }
    if (dd < minSepPx) {
      const k = minSepPx / dd;
      roadXY = clampPoint({ x: haikouXY.x + dxp * k, y: haikouXY.y + dyp * k }, W, H, 26);
    }

    const addGateway = (x, y, label) => {
      const gg = document.createElementNS(ns, 'g');

      // keep gateway fully inside view
      const p = clampPoint({ x, y }, W, H, 28);
      const gx = p.x;
      const gy = clamp(p.y, 40, H - 20);

      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('class', 'hn-gw-dot');
      dot.setAttribute('cx', gx.toFixed(2));
      dot.setAttribute('cy', gy.toFixed(2));
      dot.setAttribute('r', '9');
      gg.appendChild(dot);

      const ripple1 = document.createElementNS(ns, 'circle');
      ripple1.setAttribute('class', 'hn-gw-ripple hn-gw-ripple--a');
      ripple1.setAttribute('cx', gx.toFixed(2));
      ripple1.setAttribute('cy', gy.toFixed(2));
      ripple1.setAttribute('r', '12');
      gg.appendChild(ripple1);

      const ripple2 = document.createElementNS(ns, 'circle');
      ripple2.setAttribute('class', 'hn-gw-ripple hn-gw-ripple--b');
      ripple2.setAttribute('cx', gx.toFixed(2));
      ripple2.setAttribute('cy', gy.toFixed(2));
      ripple2.setAttribute('r', '12');
      gg.appendChild(ripple2);

      const img = document.createElementNS(ns, 'image');
      img.setAttribute('class', 'hn-server');
      img.setAttribute('href', 'images/服务器.png');
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'images/服务器.png');
      img.setAttribute('width', '30');
      img.setAttribute('height', '30');
      img.setAttribute('x', (gx - 15).toFixed(2));
      img.setAttribute('y', (gy - 32).toFixed(2));
      img.setAttribute('opacity', '0.98');
      gg.appendChild(img);

      const tx = document.createElementNS(ns, 'text');
      tx.setAttribute('class', 'hn-gw-label');
      const nearRight = gx > W - 92;
      tx.setAttribute('text-anchor', nearRight ? 'end' : 'start');
      tx.setAttribute('x', (nearRight ? gx - 12 : gx + 12).toFixed(2));
      tx.setAttribute('y', (gy - 14).toFixed(2));
      tx.textContent = label;
      gg.appendChild(tx);

      svg.appendChild(gg);
      return { x: gx, y: gy };
    };

    addGateway(roadXY.x, roadXY.y, '海口公路');
  }

  function initHainanPanel() {
    const svg = document.getElementById('hainan-map-svg');
    if (!svg) return;
    loadHainanAdminGeoJSON()
      .then((geo) => renderHainanAdminSVG(geo))
      .catch((err) => console.error('[HainanGeoJSON] load failed:', err));
  }

  async function loadNanjingAdminGeoJSON() {
    const embedded = getEmbeddedGeoJSON(nanjingGeoKey);
    if (embedded) return embedded;

    const local = await tryFetchJson(nanjingGeoUrlLocal).catch(() => null);
    if (local) return local;

    const base = await tryFetchJson(nanjingGeoUrl).catch(() => tryFetchJson(nanjingGeoUrlAlt));
    const feats = (base && Array.isArray(base.features) && base.features) || [];
    if (feats.length >= 6) return base;

    const districtCodes = [
      '320102',
      '320104',
      '320105',
      '320106',
      '320111',
      '320113',
      '320114',
      '320115',
      '320116',
      '320117',
      '320118',
    ];
    const subs = await Promise.all(
      districtCodes.map((ac) => tryFetchJson(`https://geo.datav.aliyun.com/areas_v3/bound/${ac}.json`).catch(() => null))
    );
    const merged = [];
    for (const s of subs) {
      if (s && Array.isArray(s.features)) merged.push(...s.features);
    }
    if (merged.length) return { type: 'FeatureCollection', features: merged };
    return base;
  }

  function renderNanjingAdminSVG(geo) {
    const svg = document.getElementById('nanjing-map-svg');
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const W = 320;
    let H = 220;
    if (rect && rect.width > 0 && rect.height > 0) {
      H = Math.round(W * (rect.height / rect.width));
      H = Math.max(220, Math.min(520, H));
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    const lg = document.createElementNS(ns, 'linearGradient');
    lg.setAttribute('id', 'njFill');
    lg.setAttribute('x1', '0');
    lg.setAttribute('y1', '0');
    lg.setAttribute('x2', '1');
    lg.setAttribute('y2', '1');
    const mkStop = (off, col) => {
      const s = document.createElementNS(ns, 'stop');
      s.setAttribute('offset', off);
      s.setAttribute('stop-color', col);
      return s;
    };
    lg.appendChild(mkStop('0', 'rgba(52,220,255,0.16)'));
    lg.appendChild(mkStop('0.65', 'rgba(52,220,255,0.05)'));
    lg.appendChild(mkStop('1', 'rgba(0,0,0,0.02)'));
    defs.appendChild(lg);
    svg.appendChild(defs);

    const featuresAll = (geo && Array.isArray(geo.features) && geo.features) || [];
    if (!featuresAll.length) return;

    // Only keep Nanjing 11 districts (avoid city boundary or extra features)
    const districtNames = new Set([
      '玄武区',
      '秦淮区',
      '建邺区',
      '鼓楼区',
      '浦口区',
      '栖霞区',
      '雨花台区',
      '江宁区',
      '六合区',
      '溧水区',
      '高淳区',
    ]);
    const filtered = featuresAll.filter((f) => {
      const p = f && f.properties;
      const nm = (p && (p.name || p.NAME || p.fullname || p.FULLNAME)) || '';
      return districtNames.has(String(nm).trim());
    });
    const features = filtered.length ? filtered : featuresAll;

    const b = geojsonBounds({ type: 'FeatureCollection', features });
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(g);

    // ── Zoomed bounds for a closer look at the urban area ──
    const bMidLng = (b.minLng + b.maxLng) * 0.5;
    const bMidLat = (b.minLat + b.maxLat) * 0.5;
    const bSpanLng = b.maxLng - b.minLng;
    const bSpanLat = b.maxLat - b.minLat;
    const zoomFactor = 0.72;
    // Shift the zoom centre slightly south-east to balance the three gateways
    const bZoom = {
      minLng: bMidLng + bSpanLng * 0.04 - bSpanLng * 0.5 * zoomFactor,
      maxLng: bMidLng + bSpanLng * 0.04 + bSpanLng * 0.5 * zoomFactor,
      minLat: bMidLat - bSpanLat * 0.06 - bSpanLat * 0.5 * zoomFactor,
      maxLat: bMidLat - bSpanLat * 0.06 + bSpanLat * 0.5 * zoomFactor,
    };

    for (const f of features) {
      const d = geometryToPath(f.geometry, bZoom, W, H);
      if (!d) continue;
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'url(#njFill)');
      p.setAttribute('stroke', 'rgba(52,220,255,0.22)');
      p.setAttribute('stroke-width', '1');
      g.appendChild(p);
    }

    // reset animation holders (re-render safe)
    state.njDataFlows = [];

    const linkLayer = document.createElementNS(ns, 'g');
    svg.appendChild(linkLayer);

    const bezierD = (a, b, bendSign) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (bendSign || 1);
      const ny = (dx / len) * (bendSign || 1);
      const k = Math.min(78, Math.max(26, len * 0.32));
      const cx = (a.x + b.x) * 0.5 + nx * k;
      const cy = (a.y + b.y) * 0.5 + ny * k;
      return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    };

    const addDataFlow = (from, to, bendSign, speed) => {
      if (!from || !to) return;

      const path = document.createElementNS(ns, 'path');
      path.setAttribute('class', 'nj-data-path');
      path.setAttribute('d', bezierD(from, to, bendSign));
      linkLayer.appendChild(path);

      const dots = [];
      const offsets = [0.0, 0.33, 0.66];
      for (const off of offsets) {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('class', 'nj-data-dot');
        dot.setAttribute('r', '2.6');
        dot.setAttribute('cx', from.x.toFixed(2));
        dot.setAttribute('cy', from.y.toFixed(2));
        linkLayer.appendChild(dot);
        dots.push({ el: dot, offset: off, speed: speed || 0.18 });
      }

      state.njDataFlows.push({ path, dots });
    };

    const addGateway = (x, y, label) => {
      const gg = document.createElementNS(ns, 'g');
      const p = clampPoint({ x, y }, W, H, 28);
      const gx = p.x;
      const gy = clamp(p.y, 40, H - 20);

      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('class', 'hn-gw-dot');
      dot.setAttribute('cx', gx.toFixed(2));
      dot.setAttribute('cy', gy.toFixed(2));
      dot.setAttribute('r', '9');
      gg.appendChild(dot);

      const ripple1 = document.createElementNS(ns, 'circle');
      ripple1.setAttribute('class', 'hn-gw-ripple hn-gw-ripple--a');
      ripple1.setAttribute('cx', gx.toFixed(2));
      ripple1.setAttribute('cy', gy.toFixed(2));
      ripple1.setAttribute('r', '12');
      gg.appendChild(ripple1);

      const ripple2 = document.createElementNS(ns, 'circle');
      ripple2.setAttribute('class', 'hn-gw-ripple hn-gw-ripple--b');
      ripple2.setAttribute('cx', gx.toFixed(2));
      ripple2.setAttribute('cy', gy.toFixed(2));
      ripple2.setAttribute('r', '12');
      gg.appendChild(ripple2);

      const img = document.createElementNS(ns, 'image');
      img.setAttribute('class', 'hn-server');
      img.setAttribute('href', 'images/服务器.png');
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'images/服务器.png');
      img.setAttribute('width', '30');
      img.setAttribute('height', '30');
      img.setAttribute('x', (gx - 15).toFixed(2));
      img.setAttribute('y', (gy - 32).toFixed(2));
      img.setAttribute('opacity', '0.98');
      gg.appendChild(img);

      const tx = document.createElementNS(ns, 'text');
      tx.setAttribute('class', 'hn-gw-label');
      const nearRight = gx > W - 92;
      tx.setAttribute('text-anchor', nearRight ? 'end' : 'start');
      tx.setAttribute('x', (nearRight ? gx - 12 : gx + 12).toFixed(2));
      tx.setAttribute('y', (gy - 14).toFixed(2));
      tx.textContent = label;
      gg.appendChild(tx);

      svg.appendChild(gg);
      return { x: gx, y: gy };
    };

    const lishuiF = findFeatureByName({ type: 'FeatureCollection', features }, '溧水');
    const gulouF = findFeatureByName({ type: 'FeatureCollection', features }, '鼓楼');
    const qinhuaiF = findFeatureByName({ type: 'FeatureCollection', features }, '秦淮');

    const lishuiB = lishuiF ? getGeometryBounds(lishuiF.geometry) : null;
    const gulouB = gulouF ? getGeometryBounds(gulouF.geometry) : null;
    const qinhuaiB = qinhuaiF ? getGeometryBounds(qinhuaiF.geometry) : null;

    const lishuiC = lishuiB && Number.isFinite(lishuiB.minLng) ? boundsCenter(lishuiB) : null;
    let gulouC = gulouB && Number.isFinite(gulouB.minLng) ? boundsCenter(gulouB) : null;
    let qinhuaiC = qinhuaiB && Number.isFinite(qinhuaiB.minLng) ? boundsCenter(qinhuaiB) : null;

    const pointInRing = (x, y, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const pointInGeom = (x, y, geom) => {
      if (!geom || !geom.coordinates) return false;
      if (geom.type === 'Polygon') {
        const rings = geom.coordinates;
        if (!rings.length) return false;
        if (!pointInRing(x, y, rings[0])) return false;
        for (let k = 1; k < rings.length; k++) {
          if (pointInRing(x, y, rings[k])) return false;
        }
        return true;
      }
      if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          if (!poly || !poly.length) continue;
          if (!pointInRing(x, y, poly[0])) continue;
          let holeHit = false;
          for (let k = 1; k < poly.length; k++) {
            if (pointInRing(x, y, poly[k])) {
              holeHit = true;
              break;
            }
          }
          if (!holeHit) return true;
        }
        return false;
      }
      return false;
    };

    const offsetWithin = (c, dirLng, dirLat, geom, bb) => {
      if (!c || !geom || !bb) return c;
      const spanLng = Math.max(1e-9, bb.maxLng - bb.minLng);
      const spanLat = Math.max(1e-9, bb.maxLat - bb.minLat);
      const step = Math.min(spanLng, spanLat) * 0.40;
      const tries = [1.5, 1.25, 1.0, 0.78, 0.56, 0.38, 0.22, 0.10, 0];
      for (const k of tries) {
        const lng = c.lng + dirLng * step * k;
        const lat = c.lat + dirLat * step * k;
        if (pointInGeom(lng, lat, geom)) return { lng, lat };
      }
      return c;
    };

    // Pull Gulou and Qinhuai gateways apart (but keep each point inside its district)
    if (gulouC && qinhuaiC && gulouF && qinhuaiF && gulouB && qinhuaiB) {
      const vx = gulouC.lng - qinhuaiC.lng;
      const vy = gulouC.lat - qinhuaiC.lat;
      const len = Math.hypot(vx, vy) || 1;
      const dx = vx / len;
      const dy = vy / len;
      gulouC = offsetWithin(gulouC, dx, dy, gulouF.geometry, gulouB);
      qinhuaiC = offsetWithin(qinhuaiC, -dx, -dy, qinhuaiF.geometry, qinhuaiB);
    }

    const gw = {};
    if (lishuiC) {
      const pt0 = projectToView(lishuiC.lng, lishuiC.lat, bZoom, W, H, 8);
      gw.lishui = addGateway(pt0.x, pt0.y, '溧水区');
    }
    if (gulouC) {
      const pt0 = projectToView(gulouC.lng, gulouC.lat, bZoom, W, H, 8);
      // pixel nudge right + up to separate from Qinhuai
      gw.youDian = addGateway(pt0.x + 28, pt0.y - 14, '南京邮电大学');
    }
    if (qinhuaiC) {
      const pt0 = projectToView(qinhuaiC.lng, qinhuaiC.lat, bZoom, W, H, 8);
      // pixel nudge left + down to separate from Gulou
      gw.lgd = addGateway(pt0.x - 24, pt0.y + 12, '陆工大');
    }

    // curved data links + moving data dots
    addDataFlow(gw.youDian, gw.lgd, 1, 0.22);
    addDataFlow(gw.lishui, gw.lgd, -1, 0.18);
  }

  function initNanjingPanel() {
    const svg = document.getElementById('nanjing-map-svg');
    if (!svg) return;
    loadNanjingAdminGeoJSON()
      .then((geo) => renderNanjingAdminSVG(geo))
      .catch((err) => console.error('[NanjingGeoJSON] load failed:', err));
  }

  function fitCameraToMap(fillRatio) {
    const fill = Math.max(0.2, Math.min(0.995, fillRatio || 0.7));
    const box = new THREE.Box3();
    for (const m of mapMeshes) box.expandByObject(m);
    if (box.isEmpty()) return;

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const fov = THREE.MathUtils.degToRad(cameraMain.fov);
    const fitHeight = (Math.max(size.x, size.z) * 0.5) / (fill * Math.tan(fov * 0.5));
    const fitWidth = (Math.max(size.x, size.z) * 0.5) / (fill * Math.tan(fov * 0.5) * cameraMain.aspect);
    const dist = Math.max(fitHeight, fitWidth) * 0.55;

    const dir = new THREE.Vector3(0.01, 2.75, 0.9).normalize();
    const anchor = center.clone();
    // Keep camera framing stable even if the extrude is below the surface (y <= 0)
    anchor.y = box.max.y;

    cameraMain.position.copy(anchor).addScaledVector(dir, dist);

    const targetY = box.max.y + 0.8;
    cameraMain.lookAt(center.x, targetY, center.z);

    if (controls) {
      controls.target.set(center.x, targetY, center.z);
      controls.minDistance = Math.max(30, dist * 0.48);
      controls.maxDistance = Math.max(controls.minDistance + 90, dist * 1.55);
      controls.update();
    }
  }


  let statusEl = null;

  function setStatus(text) {
    if (statusEl && statusEl.parentNode) statusEl.parentNode.removeChild(statusEl);
    statusEl = null;
    return;
  }

  function applyScreenScale() {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    const params = new URLSearchParams(window.location.search || '');
    const embedParam = params.get('embed');
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch (e) {
      inIframe = true;
    }
    const isEmbed = embedParam === '1' || embedParam === 'true' || inIframe;

    if (isEmbed) {
      document.documentElement.classList.add('is-embed');
      screenRoot.style.left = '0px';
      screenRoot.style.top = '0px';
      screenRoot.style.width = `${ww}px`;
      screenRoot.style.height = `${wh}px`;
      screenRoot.style.transform = 'translate(0px, 0px)';
      return;
    }

    document.documentElement.classList.remove('is-embed');

    const scale = Math.min(ww / BASE_W, wh / BASE_H);
    const offsetX = Math.floor((ww - BASE_W * scale) * 0.5);
    const offsetY = Math.floor((wh - BASE_H * scale) * 0.5);
    screenRoot.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  function tickClock() {
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const timeEl = document.getElementById('clock-time');
    const dateEl = document.getElementById('clock-date');
    if (timeEl) timeEl.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    if (dateEl) dateEl.textContent = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}`;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x040816, 0.0022);

  const mapRoot = new THREE.Group();
  const glowRoot = new THREE.Group();
  const nodesRoot = new THREE.Group();
  const focusHintsRoot = new THREE.Group();
  const bgRoot = new THREE.Group();
  const provinceLabelsRoot = new THREE.Group();

  scene.add(bgRoot);
  scene.add(mapRoot);
  scene.add(glowRoot);
  scene.add(nodesRoot);
  scene.add(focusHintsRoot);
  scene.add(provinceLabelsRoot);

  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();

  const nodeRaycaster = new THREE.Raycaster();
  const nodeMouseNDC = new THREE.Vector2();

  const mapMeshes = [];
  const mainNodePickables = [];

  const provinceLabelSprites = [];

  function clearProvinceLabels() {
    for (const s of provinceLabelSprites) {
      provinceLabelsRoot.remove(s);
      if (s.geometry) s.geometry.dispose();
      if (s.material && s.material.map) s.material.map.dispose();
      if (s.material) s.material.dispose();
    }
    provinceLabelSprites.length = 0;
  }

  const nodesById = new Map();
  const activeTweens = [];

  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const materialsCache = new Map();

  const rendererMain = new THREE.WebGLRenderer({ canvas: mapCanvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  rendererMain.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  rendererMain.setClearColor(0x000000, 0);
  rendererMain.outputColorSpace = THREE.SRGBColorSpace;
  rendererMain.toneMapping = THREE.ACESFilmicToneMapping;
  rendererMain.toneMappingExposure = 1.25;

  const cameraMain = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  cameraMain.position.set(0, 150, 200);
  cameraMain.layers.set(0);
  cameraMain.layers.enable(BLOOM_LAYER);

  const OrbitControlsCtor =
    (typeof THREE.OrbitControls === 'function' && THREE.OrbitControls) ||
    (THREE.OrbitControls && typeof THREE.OrbitControls.OrbitControls === 'function' && THREE.OrbitControls.OrbitControls) ||
    (typeof window.OrbitControls === 'function' && window.OrbitControls) ||
    (window.OrbitControls && typeof window.OrbitControls.OrbitControls === 'function' && window.OrbitControls.OrbitControls) ||
    null;

  const controls = OrbitControlsCtor ? new OrbitControlsCtor(cameraMain, mapCanvas) : null;
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 70;
    controls.maxDistance = 320;
    controls.minPolarAngle = Math.PI * 0.1;
    controls.maxPolarAngle = Math.PI * 0.5;
    controls.target.set(0, 0, 0);
  } else {
    console.warn('[OrbitControls] not available. Check OrbitControls script include.');
    setStatus('OrbitControls 未加载：已降级为静态视角（请修复 OrbitControls 引入）');
  }

  const ambient = new THREE.AmbientLight(0x7fdcff, 0.35);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xb7f5ff, 0.95);
  dir.position.set(240, 420, 260);
  scene.add(dir);
  const rim = new THREE.DirectionalLight(0x1de3ff, 0.45);
  rim.position.set(-360, 220, -180);
  scene.add(rim);
  const point = new THREE.PointLight(0x44ccff, 0.8, 1200);
  point.position.set(0, 260, 0);
  scene.add(point);

  const bloomComposer = new THREE.EffectComposer(rendererMain);
  bloomComposer.addPass(new THREE.RenderPass(scene, cameraMain));
  const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(1024, 1024), 1.5, 0.35, 0.0);
  bloomPass.threshold = 0.0;
  bloomPass.strength = 1.35;
  bloomPass.radius = 0.65;
  bloomComposer.addPass(bloomPass);

  const finalComposer = new THREE.EffectComposer(rendererMain);
  finalComposer.addPass(new THREE.RenderPass(scene, cameraMain));
  const fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
  finalComposer.addPass(fxaaPass);

  const finalPass = new THREE.ShaderPass({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
      uBloomStrength: { value: 1.0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; uniform float uBloomStrength; varying vec2 vUv; void main(){ vec4 base=texture2D(baseTexture,vUv); vec4 bloom=texture2D(bloomTexture,vUv)*uBloomStrength; gl_FragColor=base+bloom; }',
  }, 'baseTexture');
  finalComposer.addPass(finalPass);

  const filmPass = new THREE.FilmPass(0.08, 0.06, 520, false);
  filmPass.renderToScreen = true;
  finalComposer.addPass(filmPass);

  function setRendererSize(renderer, w, h) {
    renderer.setSize(w, h, false);
  }

  function updateSizes() {
    applyScreenScale();

    const centerEl = document.querySelector('.map-stage');
    const rectMain = centerEl.getBoundingClientRect();
    const wMain = Math.max(2, Math.floor(rectMain.width));
    const hMain = Math.max(2, Math.floor(rectMain.height));
    setRendererSize(rendererMain, wMain, hMain);
    cameraMain.aspect = wMain / hMain;
    cameraMain.updateProjectionMatrix();

    bloomComposer.setSize(wMain, hMain);
    finalComposer.setSize(wMain, hMain);
    const dpr = rendererMain.getPixelRatio();
    fxaaPass.material.uniforms.resolution.value.set(1 / (wMain * dpr), 1 / (hMain * dpr));
  }

  window.addEventListener('resize', updateSizes);

  function waitForStableStageSize(done, attempts) {
    const centerEl = document.querySelector('.map-stage');
    const rect = centerEl ? centerEl.getBoundingClientRect() : { width: 0, height: 0 };
    const ok = rect.width > 200 && rect.height > 200;

    if (ok || (attempts || 0) > 90) {
      updateSizes();
      done();
      return;
    }

    window.requestAnimationFrame(() => waitForStableStageSize(done, (attempts || 0) + 1));
  }

  function lonLatToMercator(lon, lat) {
    const x = lon * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 20037508.34 / Math.PI;
    return { x, y };
  }

  function projectLonLat(lon, lat) {
    const m = lonLatToMercator(lon, lat);
    const x = m.x * state.mapScale - state.mapCenterX;
    const y = m.y * state.mapScale - state.mapCenterY;
    return new THREE.Vector3(x, 0, y);
  }

  function createRadialTexture(c0, c1) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, c0);
    g.addColorStop(0.22, c0);
    g.addColorStop(0.58, c1);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function createProvinceLabelMesh(name, cen) {
    if (!cen) return null;

    const tex = createProvinceTextTexture(name);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;

    const aspect = (tex.image && tex.image.width && tex.image.height) ? (tex.image.width / tex.image.height) : 2.5;
    const bboxW = Math.max(1e-6, (cen.bbox.maxX - cen.bbox.minX));
    const bboxH = Math.max(1e-6, (cen.bbox.maxY - cen.bbox.minY));
    const ref = Math.min(bboxW, bboxH);

    const hBase = Math.max(3.6, Math.min(7.2, ref * 0.07));
    const wBase = Math.max(5.2, Math.min(ref * 0.34, hBase * aspect));
    const kSmall = ref < 22 ? 0.78 : 1.0;
    const h = hBase * kSmall;
    const w = wBase * kSmall;
    if (ref < 14) mat.opacity = 0.75;

    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cen.vx, state.mapThickness + 0.06, -cen.vy);
    mesh.renderOrder = 25;
    mesh.userData = { type: 'provinceLabel', name };
    return mesh;
  }

  function normalizeRegionName(raw) {
    let s = (raw || '').trim();
    if (!s || s === '未知') return '';
    s = s
      .replace(/特别行政区$/g, '')
      .replace(/维吾尔自治区$/g, '')
      .replace(/壮族自治区$/g, '')
      .replace(/回族自治区$/g, '')
      .replace(/自治区$/g, '')
      .replace(/省$/g, '')
      .replace(/市$/g, '');
    return s;
  }

  function createPlainTextTexture(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '700 26px Microsoft YaHei, PingFang SC, sans-serif';

    const pad = 8;
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width + pad * 2);
    const h = 46;
    canvas.width = Math.min(512, Math.max(64, w));
    canvas.height = h;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '700 26px Microsoft YaHei, PingFang SC, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    ctx.shadowColor = 'rgba(18,220,255,0.45)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(235,253,255,0.92)';
    ctx.fillText(text, canvas.width * 0.5, canvas.height * 0.52);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function createProvinceTextTexture(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Long province names (e.g. 内蒙古自治区) need a slightly smaller font to avoid clipping.
    let fontSize = 18;
    if (text.length >= 6) fontSize = 16;
    if (text.length >= 9) fontSize = 14;

    ctx.font = `800 ${fontSize}px Microsoft YaHei, PingFang SC, sans-serif`;

    const pad = 10;
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width + pad * 2);
    const h = Math.max(44, Math.ceil(fontSize * 2.0) + 8);

    canvas.width = Math.min(512, Math.max(80, w));
    canvas.height = h;

    const ctx2 = canvas.getContext('2d');
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    ctx2.font = `800 ${fontSize}px Microsoft YaHei, PingFang SC, sans-serif`;
    ctx2.textBaseline = 'middle';
    ctx2.textAlign = 'center';

    ctx2.shadowColor = 'rgba(18,220,255,0.55)';
    ctx2.shadowBlur = 10;
    ctx2.fillStyle = 'rgba(235,253,255,0.92)';
    ctx2.fillText(text, canvas.width * 0.5, canvas.height * 0.53);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function polygonSignedArea2D(points) {
    let a = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const p = points[i];
      const q = points[j];
      a += (q[0] * p[1] - p[0] * q[1]);
    }
    return a * 0.5;
  }

  function polygonCentroid2D(points) {
    let cx = 0;
    let cy = 0;
    let a = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const p = points[i];
      const q = points[j];
      const cross = (q[0] * p[1] - p[0] * q[1]);
      a += cross;
      cx += (q[0] + p[0]) * cross;
      cy += (q[1] + p[1]) * cross;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-6) {
      let sx = 0;
      let sy = 0;
      for (const p of points) {
        sx += p[0];
        sy += p[1];
      }
      const n = points.length || 1;
      return { x: sx / n, y: sy / n };
    }
    cx /= (6 * a);
    cy /= (6 * a);
    return { x: cx, y: cy };
  }

  function pointInPolygon2D(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointSegmentDistance2D(p, a, b) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const ab2 = abx * abx + aby * aby;
    const t = ab2 > 1e-12 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
    const cx = a[0] + abx * t;
    const cy = a[1] + aby * t;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointToPolygonDistance2D(p, poly) {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      d = Math.min(d, pointSegmentDistance2D(p, a, b));
    }
    return d;
  }

  function findInteriorLabelPoint(poly, bbox) {
    if (!poly || poly.length < 3 || !bbox) return null;
    const w = bbox.maxX - bbox.minX;
    const h = bbox.maxY - bbox.minY;
    const steps = Math.max(8, Math.min(18, Math.floor(Math.max(w, h) / 12)));
    let best = null;
    let bestD = -Infinity;

    for (let iy = 0; iy < steps; iy++) {
      const y = bbox.minY + (iy + 0.5) * (h / steps);
      for (let ix = 0; ix < steps; ix++) {
        const x = bbox.minX + (ix + 0.5) * (w / steps);
        const p = [x, y];
        if (!pointInPolygon2D(p, poly)) continue;
        const d = pointToPolygonDistance2D(p, poly);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }

    if (!best) {
      const c = polygonCentroid2D(poly);
      return [c.x, c.y];
    }
    return best;
  }

  function pickLargestOuterRing(geom) {
    let bestRing = null;
    let bestArea = 0;
    const tryRing = (ring) => {
      if (!ring || ring.length < 3) return;
      const pts = [];
      for (const pt of ring) {
        const m = lonLatToMercator(pt[0], pt[1]);
        const x = m.x * state.mapScale - state.mapCenterX;
        const y = m.y * state.mapScale - state.mapCenterY;
        pts.push([x, y]);
      }
      const area = Math.abs(polygonSignedArea2D(pts));
      if (area > bestArea) {
        bestArea = area;
        bestRing = ring;
      }
    };

    if (!geom || !geom.coordinates) return null;
    if (geom.type === 'Polygon') {
      tryRing(geom.coordinates && geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates || []) {
        if (poly && poly[0]) tryRing(poly[0]);
      }
    }
    if (!bestRing) return null;
    return { ring: bestRing, area: bestArea };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '600 28px Microsoft YaHei, PingFang SC, sans-serif';
    const padX = 20;
    const w = Math.ceil(ctx.measureText(text).width + padX * 2);
    const h = 56;
    canvas.width = w;
    canvas.height = h;

    const ctx2 = canvas.getContext('2d');
    ctx2.font = '600 28px Microsoft YaHei, PingFang SC, sans-serif';
    ctx2.textBaseline = 'middle';
    ctx2.clearRect(0, 0, w, h);

    const grad = ctx2.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(52,220,255,0.18)');
    grad.addColorStop(1, 'rgba(52,220,255,0.04)');
    roundRect(ctx2, 2, 6, w - 4, h - 12, 12);
    ctx2.fillStyle = grad;
    ctx2.fill();
    ctx2.strokeStyle = 'rgba(52,220,255,0.35)';
    ctx2.lineWidth = 2;
    ctx2.stroke();

    ctx2.shadowColor = 'rgba(52,220,255,0.55)';
    ctx2.shadowBlur = 14;
    ctx2.fillStyle = 'rgba(220,245,255,0.95)';
    ctx2.fillText(text, padX, h / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function createStarfield(count, radius, height) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const cA = new THREE.Color(0x6fe9ff);
    const cB = new THREE.Color(0x5c7cff);

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.25 + Math.random() * 0.75);
      const y = (Math.random() - 0.2) * height;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos[i * 3 + 0] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      const t = Math.random();
      const cc = cA.clone().lerp(cB, t);
      col[i * 3 + 0] = cc.r;
      col[i * 3 + 1] = cc.g;
      col[i * 3 + 2] = cc.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6,
      transparent: true,
      opacity: 0.36,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.y = 120;
    return pts;
  }

  function createEnergyBase() {
    const g = new THREE.Group();
    const sizeX = Math.max(320, (state.mapBounding.maxX - state.mapBounding.minX) * 1.2);
    const sizeZ = Math.max(220, (state.mapBounding.maxY - state.mapBounding.minY) * 1.2);
    const r = Math.max(sizeX, sizeZ) * 0.46;

    const baseY = -state.mapThickness - 0.35;

    const ringGeo = new THREE.RingGeometry(r * 0.62, r * 0.98, 128, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x2ff6ff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = baseY;
    ring.layers.enable(BLOOM_LAYER);
    g.add(ring);

    const ring2Geo = new THREE.RingGeometry(r * 0.35, r * 0.52, 96, 1);
    ring2Geo.rotateX(-Math.PI / 2);
    const ring2Mat = new THREE.MeshBasicMaterial({
      color: 0x4fb7ff,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.position.y = baseY + 0.02;
    g.add(ring2);

    const grid = new THREE.GridHelper(r * 2.0, 18, 0x2ff6ff, 0x2ff6ff);
    grid.position.y = baseY - 0.08;
    grid.material.transparent = true;
    grid.material.opacity = 0.08;
    g.add(grid);
    return g;
  }

  function createRadarRing() {
    const geo = new THREE.CircleGeometry(220, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x2ff6ff) },
        uPeriod: { value: 6.2 },
      },
      vertexShader: 'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'uniform float uTime;',
        'uniform vec3 uColor;',
        'uniform float uPeriod;',
        'varying vec3 vPos;',
        'float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}',
        'void main(){',
        'float r=length(vPos.xz);',
        'float t=fract(uTime/uPeriod);',
        'float ring=abs(r - (t*220.0));',
        'float a=smoothstep(6.0, 0.0, ring) * (1.0 - t) * 0.55;',
        'float ripple=smoothstep(1.0, 0.0, abs(fract(r*0.05 - uTime*0.45)-0.5)*2.0) * 0.06;',
        'float noise=(rand(vPos.xz*0.15+uTime*0.1)-0.5)*0.05;',
        'float alpha=clamp(a + ripple + noise, 0.0, 0.65);',
        'gl_FragColor=vec4(uColor, alpha);',
        '}'
      ].join('\n'),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.35;
    mesh.layers.enable(BLOOM_LAYER);
    mesh.userData = { mat };
    return mesh;
  }

  function createSweepLight() {
    const geo = new THREE.PlaneGeometry(520, 260, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x5ceaff) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'uniform float uTime;',
        'uniform vec3 uColor;',
        'varying vec2 vUv;',
        'void main(){',
        'float d=vUv.x*0.9 + vUv.y*0.6;',
        'float p=fract(d - uTime*0.08);',
        'float band=smoothstep(0.15, 0.0, abs(p-0.5));',
        'float edge=smoothstep(0.0, 0.28, vUv.x)*smoothstep(0.0, 0.28, vUv.y)*smoothstep(0.0, 0.28, 1.0-vUv.x)*smoothstep(0.0, 0.28, 1.0-vUv.y);',
        'float alpha=band*0.22*edge;',
        'gl_FragColor=vec4(uColor, alpha);',
        '}'
      ].join('\n'),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 1.2;
    mesh.userData = { mat };
    return mesh;
  }

  function createEmbeddedProvinceLabelTexture(name, u, v) {
    const s = 512;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, s, s);

    const fontSize = 52;
    ctx.font = `800 ${fontSize}px Microsoft YaHei, PingFang SC, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const x = Math.max(0.08, Math.min(0.92, u)) * s;
    const y = Math.max(0.10, Math.min(0.90, 1 - v)) * s;

    ctx.shadowColor = 'rgba(20,220,255,0.55)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(240,254,255,0.85)';
    ctx.fillText(name, x, y);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function loadChinaGeoJSON() {
    const embedded = getEmbeddedGeoJSON('china');
    if (embedded) {
      setStatus('GeoJSON：已加载本地 data/china.js');
      return Promise.resolve(embedded);
    }

    return tryFetchJson(geoUrlLocal)
      .then((j) => {
        setStatus('GeoJSON：已加载本地 data/china.json');
        return j;
      })
      .catch(() =>
        tryFetchJson(geoUrl)
          .then((j) => {
            setStatus('GeoJSON：已加载在线数据');
            return j;
          })
          .catch(() =>
            tryFetchJson(geoUrlAlt).then((j) => {
              setStatus('GeoJSON：已加载在线备用数据');
              return j;
            })
          )
      );
  }

  function computeGeoCenterAndBounds(geo) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const visitPoint = (pt) => {
      const lon = pt[0];
      const lat = pt[1];
      const m = lonLatToMercator(lon, lat);
      const sx = m.x * state.mapScale;
      const sy = m.y * state.mapScale;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    };

    for (const f of geo.features || []) {
      const geom = f.geometry;
      if (!geom || !geom.coordinates) continue;
      const coords = geom.coordinates;

      if (geom.type === 'Polygon') {
        for (const ring of coords) for (const pt of ring) visitPoint(pt);
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of coords) for (const ring of poly) for (const pt of ring) visitPoint(pt);
      }
    }

    if (!Number.isFinite(minX)) {
      minX = -200;
      maxX = 200;
      minY = -140;
      maxY = 140;
    }

    state.mapCenterX = (minX + maxX) * 0.5;
    state.mapCenterY = (minY + maxY) * 0.5;
    state.mapBounding = { minX, maxX, minY, maxY };
  }

  function buildProvinceShape(ring) {
    const shape = new THREE.Shape();
    let first = true;
    for (const pt of ring) {
      const m = lonLatToMercator(pt[0], pt[1]);
      const x = m.x * state.mapScale - state.mapCenterX;
      const y = m.y * state.mapScale - state.mapCenterY;
      const vx = x;
      const vy = y;
      if (first) {
        shape.moveTo(vx, vy);
        first = false;
      } else {
        shape.lineTo(vx, vy);
      }
    }
    return shape;
  }

  function createMapFromGeoJSON(geo) {
    clearProvinceLabels();
    const topMat = new THREE.MeshPhongMaterial({
      color: 0x1ef0ff,
      transparent: true,
      opacity: 0.44,
      shininess: 60,
      specular: 0x7df8ff,
      emissive: 0x001018,
      emissiveIntensity: 0.4,
    });

    const sideMat = new THREE.MeshPhongMaterial({
      color: 0x0b2c3a,
      transparent: true,
      opacity: 0.56,
      shininess: 20,
      specular: 0x3cc7ff,
      emissive: 0x00060a,
      emissiveIntensity: 0.25,
    });

    const provincePrimaryCentroid = new Map();

    const makeMeshFromPolygon = (poly, name, metric, isPrimary) => {
      if (!poly || !poly.length) return;
      const outer = poly[0];
      if (!outer || outer.length < 3) return;
      const shape = buildProvinceShape(outer);

      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth: state.mapThickness,
        bevelEnabled: false,
        curveSegments: 1,
        steps: 1,
      });
      extrudeGeo.rotateX(-Math.PI / 2);
      extrudeGeo.computeVertexNormals();

      const matTop = topMat.clone();
      const matSide = sideMat.clone();


      const mesh = new THREE.Mesh(extrudeGeo, [matTop, matSide]);
      mesh.renderOrder = 5;
      mesh.userData = {
        type: 'province',
        name,
        metric,
        baseTopOpacity: matTop.opacity,
        baseSideOpacity: matSide.opacity,
        baseTopEmissive: matTop.emissiveIntensity,
        baseSideEmissive: matSide.emissiveIntensity,
      };
      mapRoot.add(mesh);
      mapMeshes.push(mesh);

      const edgesGeo = new THREE.EdgesGeometry(extrudeGeo, 18);
      const edgesMat = new THREE.LineBasicMaterial({ color: 0xbefbff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
      const edges = new THREE.LineSegments(edgesGeo, edgesMat);
      edges.userData = { type: 'provinceEdges', name };
      edges.renderOrder = 10;
      edges.layers.enable(BLOOM_LAYER);
      glowRoot.add(edges);
    };

    for (const f of geo.features || []) {
      const geom = f.geometry;
      if (!geom || !geom.coordinates) continue;
      const rawName = (f.properties && (f.properties.name || f.properties.NAME)) || '';
      const name = normalizeRegionName(rawName);
      const metric = Math.floor(60 + Math.random() * 40);
      if (!name) {
        if (geom.type === 'Polygon') makeMeshFromPolygon(geom.coordinates, '', metric, true);
        else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) makeMeshFromPolygon(poly, '', metric, true);
        continue;
      }

      const best = pickLargestOuterRing(geom);
      if (best && best.ring) {
        const pts = [];
        let minVX = Infinity;
        let maxVX = -Infinity;
        let minVY = Infinity;
        let maxVY = -Infinity;
        for (const pt of best.ring) {
          const mm = lonLatToMercator(pt[0], pt[1]);
          const xx = mm.x * state.mapScale - state.mapCenterX;
          const yy = mm.y * state.mapScale - state.mapCenterY;
          pts.push([xx, yy]);
          minVX = Math.min(minVX, xx);
          maxVX = Math.max(maxVX, xx);
          minVY = Math.min(minVY, yy);
          maxVY = Math.max(maxVY, yy);
        }

        const bbox = { minX: minVX, maxX: maxVX, minY: minVY, maxY: maxVY };
        const ip = findInteriorLabelPoint(pts, bbox);
        let vx = ip ? ip[0] : (minVX + maxVX) * 0.5;
        let vy = ip ? ip[1] : (minVY + maxVY) * 0.5;

        if (!provincePrimaryCentroid.has(name)) {
          provincePrimaryCentroid.set(name, { vx, vy, bbox });
        }
      }

      if (geom.type === 'Polygon') {
        makeMeshFromPolygon(geom.coordinates, name, metric, true);
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          const outer = poly && poly[0];
          const a = outer ? Math.abs(polygonSignedArea2D(outer)) : 0;
          makeMeshFromPolygon(poly, name, metric, a > 0);
        }
      }
    }

    const hk = provincePrimaryCentroid.get('香港');
    const mo = provincePrimaryCentroid.get('澳门');
    if (hk && mo) {
      const dx = hk.vx - mo.vx;
      const dy = hk.vy - mo.vy;
      const d = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
      const minSep = 4.2;
      if (d < minSep) {
        const push = (minSep - d) * 0.5;
        const maxPush = 1.6;
        const k = Math.min(maxPush, push) / d;
        hk.vx += dx * k;
        hk.vy += dy * k;
        mo.vx -= dx * k;
        mo.vy -= dy * k;
      }
    }

    for (const [name, cen] of provincePrimaryCentroid.entries()) {
      if (!name) continue;
      const label = createProvinceLabelMesh(name, cen);
      if (!label) continue;
      provinceLabelsRoot.add(label);
      provinceLabelSprites.push(label);
    }

    fitCameraToMap(0.985);
  }

  function createFallbackMap() {
    if (state.fallbackBuilt || mapMeshes.length > 0) return;
    state.fallbackBuilt = true;
    clearProvinceLabels();
    const shape = new THREE.Shape();
    shape.moveTo(-180, -110);
    shape.lineTo(180, -110);
    shape.lineTo(220, 110);
    shape.lineTo(-220, 110);
    shape.lineTo(-180, -110);

    const topMat = new THREE.MeshPhongMaterial({
      color: 0x1ef0ff,
      transparent: true,
      opacity: 0.28,
      shininess: 40,
      specular: 0x7df8ff,
      emissive: 0x001018,
      emissiveIntensity: 0.35,
    });
    const sideMat = new THREE.MeshPhongMaterial({
      color: 0x0b2c3a,
      transparent: true,
      opacity: 0.48,
      shininess: 20,
      specular: 0x3cc7ff,
      emissive: 0x00060a,
      emissiveIntensity: 0.25,
    });

    const geo = new THREE.ExtrudeGeometry(shape, { depth: state.mapThickness, bevelEnabled: false, curveSegments: 1, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
    mesh.renderOrder = 5;
    mesh.userData = { type: 'province', name: '中国', metric: 88 };
    mapRoot.add(mesh);
    mapMeshes.push(mesh);

    const cen = { vx: 0, vy: 0, bbox: { minX: -220, maxX: 220, minY: -110, maxY: 110 } };
    const label = createProvinceLabelMesh('中国', cen);
    if (label) {
      provinceLabelsRoot.add(label);
      provinceLabelSprites.push(label);
    }

    fitCameraToMap(0.985);
  }

  function createNode(id, name, lon, lat) {
    const pos = projectLonLat(lon, lat);
    const g = new THREE.Group();
    g.position.copy(pos);
    g.userData = { type: 'node', id, name, flash: 0 };

    const spriteMat = new THREE.SpriteMaterial({
      map: nodeGlowTex,
      color: new THREE.Color(0x9cf8ff),
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(7.2, 7.2, 1);
    sprite.position.y = 1.8;
    sprite.layers.enable(BLOOM_LAYER);
    g.add(sprite);

    // ── 3D torus halo ring (replaces flat 2D RingGeometry) ──
    const torusGeo = new THREE.TorusGeometry(3.8, 0.18, 20, 80);
    torusGeo.rotateX(Math.PI / 2); // lay flat on XZ plane
    const ring = new THREE.Mesh(torusGeo, new THREE.MeshBasicMaterial({
      color: 0x2ff6ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    ring.position.y = 0.30;
    ring.layers.enable(BLOOM_LAYER);
    ring.userData = { type: 'nodeRing', phase: Math.random() * Math.PI * 2 };
    g.add(ring);

    // ── Inner accent torus (thinner, slightly smaller) ──
    const torusInnerGeo = new THREE.TorusGeometry(2.8, 0.07, 10, 56);
    torusInnerGeo.rotateX(Math.PI / 2);
    const ringInner = new THREE.Mesh(torusInnerGeo, new THREE.MeshBasicMaterial({
      color: 0x5ee8ff,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    ringInner.position.y = 0.26;
    ringInner.layers.enable(BLOOM_LAYER);
    g.add(ringInner);

    // ── 4 cardinal tick marks ──
    const tickGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6);
    const tickMat = new THREE.MeshBasicMaterial({
      color: 0x7ef4ff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tickR = 3.8;
    const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const a of angles) {
      const tick = new THREE.Mesh(tickGeo, tickMat);
      tick.position.set(Math.cos(a) * tickR, 0.30, Math.sin(a) * tickR);
      tick.rotation.z = Math.PI / 2; // align along radial
      tick.layers.enable(BLOOM_LAYER);
      g.add(tick);
    }

    // ── Pulse wave ring (keeps RingGeometry for proper radial expansion) ──
    const pulseGeo = new THREE.RingGeometry(2.4, 5.6, 80, 1);
    pulseGeo.rotateX(-Math.PI / 2);
    const pulse = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({
      color: 0x3cd4ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    pulse.position.y = 0.22;
    pulse.layers.enable(BLOOM_LAYER);
    pulse.userData = { type: 'nodePulse', phase: Math.random() * Math.PI * 2 };
    g.add(pulse);

    const pickProxy = new THREE.Mesh(new THREE.SphereGeometry(3.8, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
    pickProxy.position.y = 1.8;
    pickProxy.userData = { type: 'nodePick', id, name };
    g.add(pickProxy);
    mainNodePickables.push(pickProxy);

    nodesRoot.add(g);
    nodesById.set(id, { id, name, lon, lat, group: g, sprite, ring, ringInner, pulse, pickProxy });
  }

  function createArcLine(a, b, height) {
    const points = [];
    const start = a.clone();
    const end = b.clone();
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += height;
    const segs = 120;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p0 = start.clone().multiplyScalar((1 - t) * (1 - t));
      const p1 = mid.clone().multiplyScalar(2 * (1 - t) * t);
      const p2 = end.clone().multiplyScalar(t * t);
      points.push(p0.add(p1).add(p2));
    }

    const pos = new Float32Array(points.length * 3);
    const dist = new Float32Array(points.length);
    let total = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      pos[i * 3 + 0] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      if (i > 0) total += points[i].distanceTo(points[i - 1]);
      dist[i] = total;
    }
    for (let i = 0; i < dist.length; i++) dist[i] = dist[i] / (total || 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    geo.computeBoundingSphere();

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x2ff6ff) },
        uSpeed: { value: 0.85 },
      },
      vertexShader: 'attribute float aDist; varying float vDist; void main(){ vDist=aDist; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'uniform float uTime;',
        'uniform vec3 uColor;',
        'uniform float uSpeed;',
        'varying float vDist;',
        'void main(){',
        'float flow=fract(vDist*6.0 - uTime*uSpeed);',
        'float core=smoothstep(0.0, 0.12, flow) * smoothstep(1.0, 0.58, flow);',
        'float head=smoothstep(0.04, 0.0, abs(flow-0.08));',
        'float a=core*0.28 + head*0.65;',
        'gl_FragColor=vec4(uColor, a);',
        '}'
      ].join('\n'),
    });

    const line = new THREE.Line(geo, mat);
    line.layers.enable(BLOOM_LAYER);
    line.userData = { mat };
    flowLines.push(line);
    return line;
  }

  function createFlowTube(a, b, height, radius) {
    const points = [];
    const start = a.clone();
    const end = b.clone();
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += height;

    const segs = 90;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p0 = start.clone().multiplyScalar((1 - t) * (1 - t));
      const p1 = mid.clone().multiplyScalar(2 * (1 - t) * t);
      const p2 = end.clone().multiplyScalar(t * t);
      points.push(p0.add(p1).add(p2));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const group = new THREE.Group();
    group.layers.enable(BLOOM_LAYER);

    const r = Math.max(0.06, radius || 0.22);

    // ═══ outer shell — wide, soft, slow plasma sheath ═══
    const shellGeo = new THREE.TubeGeometry(curve, 150, r, 8, false);
    const shellMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x3ca8e0) },
        uSpeed: { value: 0.35 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float uSpeed; varying vec2 vUv;',
        'void main(){',
        'float p = vUv.y;',
        'float w = fract(p * 2.5 - uTime * uSpeed);',
        'float glow = smoothstep(0.0, 0.35, w) * smoothstep(1.0, 0.25, w);',
        'float edge = 1.0 - smoothstep(0.0, 0.52, abs(vUv.x - 0.5));',
        'float endFade = smoothstep(0.0, 0.15, p) * smoothstep(1.0, 0.85, p);',
        'float a = (0.035 + 0.095 * glow) * (0.25 + 0.75 * edge) * endFade;',
        'gl_FragColor = vec4(uColor, a);',
        '}',
      ].join('\n'),
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.renderOrder = 1;
    group.add(shell);

    // ═══ inner core — thin, bright, fast data stream ═══
    const coreGeo = new THREE.TubeGeometry(curve, 180, Math.max(0.04, r * 0.38), 8, false);
    const coreMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xaef8ff) },
        uSpeed: { value: 1.25 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float uSpeed; varying vec2 vUv;',
        'void main(){',
        'float p = vUv.y;',
        'float t = uTime * uSpeed;',
        // three overlapping travelling pulses
        'float w1 = fract(p * 3.5 - t);',
        'float w2 = fract(p * 5.0 - t * 0.62);',
        'float w3 = fract(p * 2.5 - t * 1.28);',
        // bright leading heads
        'float h1 = smoothstep(0.12, 0.0, abs(w1 - 0.05)) * 0.72;',
        'float h2 = smoothstep(0.12, 0.0, abs(w2 - 0.07)) * 0.42;',
        'float h3 = smoothstep(0.12, 0.0, abs(w3 - 0.04)) * 0.28;',
        // trailing cores
        'float c1 = smoothstep(0.0, 0.30, w1) * smoothstep(1.0, 0.48, w1);',
        'float c2 = smoothstep(0.0, 0.30, w2) * smoothstep(1.0, 0.48, w2) * 0.38;',
        'float c3 = smoothstep(0.0, 0.30, w3) * smoothstep(1.0, 0.48, w3) * 0.22;',
        // soft edge fade
        'float edge = 1.0 - smoothstep(0.0, 0.44, abs(vUv.x - 0.5));',
        'float endFade = smoothstep(0.0, 0.15, p) * smoothstep(1.0, 0.85, p);',
        'float a = (0.06 + 0.22 * (c1 + c2 + c3) + h1 + h2 + h3) * (0.45 + 0.55 * edge) * endFade;',
        'gl_FragColor = vec4(uColor, a);',
        '}',
      ].join('\n'),
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.renderOrder = 0;
    group.add(core);

    group.userData = {
      type: 'flowTube',
      curve,
      coreMat,
      shellMat,
      mat: coreMat, // backward compat — animate loop ticks mat.uniforms
    };

    flowTubes.push(group);
    return group;
  }

  function createFlowPackets(curve, count, speed) {
    const g = new THREE.Group();
    g.layers.enable(BLOOM_LAYER);
    const n = Math.max(1, count || 12);
    for (let i = 0; i < n; i++) {
      const spriteMat = new THREE.SpriteMaterial({
        map: nodeGlowTex,
        color: new THREE.Color(0xbefbff),
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const s = new THREE.Sprite(spriteMat);
      const scale = 3.4 + Math.random() * 1.4;
      s.scale.set(scale, scale, 1);
      s.userData = { offset: i / n, speed: speed || 0.12 };
      g.add(s);
    }
    g.userData = { type: 'flowPackets', curve };
    flowPackets.push(g);
    return g;
  }

  function initScenario() {
    if (scenarioInited) return;
    scenarioInited = true;

    createNode('node-hainan', '海南', 110.35, 43);
    createNode('node-jiangsu', '江苏', 119.78, 31.04);

    createNode('node-3', '节点3', 116.40, 39.90);
    createNode('node-4', '节点4', 104.06, 30.67);
    createNode('node-5', '节点5', 113.26, 23.13);

    const n3 = nodesById.get('node-3');
    const n4 = nodesById.get('node-4');
    const n5 = nodesById.get('node-5');
    if (n3) n3.group.visible = false;
    if (n4) n4.group.visible = false;
    if (n5) n5.group.visible = false;

    const a0 = nodesById.get('node-hainan');
    const b0 = nodesById.get('node-jiangsu');
    if (!a0 || !b0) return;

    const a = a0.group.position.clone();
    const b = b0.group.position.clone();
    a.y = state.mapThickness + 1.4;
    b.y = state.mapThickness + 1.4;

    const dist = a.distanceTo(b);
    const tube = createFlowTube(a, b, Math.max(10, Math.min(36, dist * 0.18)), 0.30);
    glowRoot.add(tube);

    const packets = createFlowPackets(tube.userData.curve, 18, 0.12);
    glowRoot.add(packets);
  }

  function flashNode(nodeId) {
    const n = nodesById.get(nodeId);
    if (!n) return;
    n.group.userData.flash = 1.2;
    focusToPosition(n.group.position);
  }

  function setMouseNDCFromEvent(e, out) {
    const rect = mapCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / Math.max(1, rect.width);
    const y = (e.clientY - rect.top) / Math.max(1, rect.height);
    out.x = x * 2 - 1;
    out.y = -(y * 2 - 1);
  }

  function pickNodeMain(e) {
    setMouseNDCFromEvent(e, nodeMouseNDC);
    nodeRaycaster.setFromCamera(nodeMouseNDC, cameraMain);
    const hits = nodeRaycaster.intersectObjects(mainNodePickables, false);
    return hits && hits.length ? hits[0].object : null;
  }

  function pickProvince(e) {
    setMouseNDCFromEvent(e, mouseNDC);
    raycaster.setFromCamera(mouseNDC, cameraMain);
    const hits = raycaster.intersectObjects(mapMeshes, false);
    return hits && hits.length ? hits[0].object : null;
  }

  function onMainMouseMove(e) {
    if (!state.ready) return;
    const nodePick = pickNodeMain(e);
    if (nodePick && nodePick.userData && nodePick.userData.id) {
      updateTooltip(e, `${nodePick.userData.name}`);
      return;
    }

    const prov = pickProvince(e);
    if (prov) setHoveredProvince(prov, e);
    else setHoveredProvince(null);
  }

  function onMainClick(e) {
    if (!state.ready) return;
    const nodePick = pickNodeMain(e);
    if (nodePick && nodePick.userData && nodePick.userData.id) {
      flashNode(nodePick.userData.id);
      return;
    }
    const prov = pickProvince(e);
    if (prov && prov.geometry && prov.geometry.boundingSphere) {
      const center = prov.geometry.boundingSphere.center.clone();
      focusToPosition(prov.localToWorld(center));
    }
  }


  function darkenNonBloom(obj) {
    if (bloomLayer.test(obj.layers) === false) {
      if (obj.isMesh && obj.material) {
        materialsCache.set(obj.uuid, obj.material);
        obj.material = darkMaterial;
      } else if ((obj.isSprite || obj.isLine || obj.isLineSegments || obj.isPoints) && obj.visible) {
        if (!obj.userData) obj.userData = {};
        if (obj.userData.__nonBloomVisible === undefined) obj.userData.__nonBloomVisible = true;
        obj.visible = false;
      }
    }
  }

  function restoreMaterials(obj) {
    if (materialsCache.has(obj.uuid)) {
      obj.material = materialsCache.get(obj.uuid);
      materialsCache.delete(obj.uuid);
    }
    if (obj.userData && obj.userData.__nonBloomVisible) {
      obj.visible = true;
      delete obj.userData.__nonBloomVisible;
    }
  }

  function tween(duration, onUpdate, onComplete) {
    const t = { start: performance.now(), duration, onUpdate, onComplete };
    activeTweens.push(t);
    return t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function updateTooltip(e, html) {
    if (!tooltipEl) return;
    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    tooltipEl.style.transform = `translate(${Math.floor(x + 12)}px, ${Math.floor(y + 12)}px)`;
    tooltipEl.innerHTML = html;
    tooltipEl.style.display = 'block';
  }

  function setHoveredProvince(mesh, e) {
    if (state.hoveredProvince === mesh) return;
    state.hoveredProvince = mesh;
 
    for (const m of mapMeshes) {
      if (!m.material || !Array.isArray(m.material)) continue;
      const top = m.material[0];
      const side = m.material[1];
      const ud = m.userData || {};
      top.opacity = ud.baseTopOpacity ?? 0.44;
      side.opacity = ud.baseSideOpacity ?? 0.56;
      if (top.emissiveIntensity != null) top.emissiveIntensity = ud.baseTopEmissive ?? 0.4;
      if (side.emissiveIntensity != null) side.emissiveIntensity = ud.baseSideEmissive ?? 0.25;
    }
 
    if (mesh) {
      const name = mesh.userData && mesh.userData.name ? mesh.userData.name : '';
      const metric = mesh.userData && mesh.userData.metric ? mesh.userData.metric : '--';
 
      if (mesh.material && Array.isArray(mesh.material)) {
        const top = mesh.material[0];
        const side = mesh.material[1];
        top.opacity = 0.62;
        side.opacity = 0.62;
        if (top.emissiveIntensity != null) top.emissiveIntensity = 0.75;
        if (side.emissiveIntensity != null) side.emissiveIntensity = 0.45;
      }
 
      if (e) {
        if (name) updateTooltip(e, `${name} <span style="opacity:.7">指标</span> ${metric}`);
        else hideTooltip();
      }
    } else {
      hideTooltip();
    }
  }

  function initSidePanelToggles() {
    const btns = document.querySelectorAll('[data-slide-panel]');
    if (!btns || !btns.length) return;

    const syncState = (btn) => {
      if (!btn) return;
      const sel = btn.getAttribute('data-slide-panel') || '';
      if (!sel) return;
      const panel = document.querySelector(sel);
      if (!panel) return;
      const isOut = panel.classList.contains('is-slid-out');
      const titleEl = panel.querySelector('.hud-panel__title');
      const panelName = titleEl && titleEl.textContent ? titleEl.textContent.trim() : '';
      btn.setAttribute('aria-pressed', isOut ? 'true' : 'false');
      btn.setAttribute('data-state', isOut ? 'out' : 'in');
      btn.title = isOut ? '弹出' : '隐藏';
      btn.setAttribute('aria-label', isOut ? `弹出${panelName ? `：${panelName}` : '面板'}` : `隐藏${panelName ? `：${panelName}` : '面板'}`);
    };

    for (const btn of btns) {
      syncState(btn);
      btn.addEventListener('click', () => {
        const sel = btn.getAttribute('data-slide-panel') || '';
        if (!sel) return;
        const panel = document.querySelector(sel);
        if (!panel) return;
        panel.classList.toggle('is-slid-out');
        syncState(btn);
      });
    }
  }

  function main() {
    if (state.bootStarted) return;
    state.bootStarted = true;
    updateSizes();
    initHainanPanel();
    initNanjingPanel();
    initSidePanelToggles();
    mapCanvas.addEventListener('mousemove', onMainMouseMove);
    mapCanvas.addEventListener('mouseleave', () => {
      setHoveredProvince(null);
      hideTooltip();
    });
    mapCanvas.addEventListener('click', onMainClick);

    loadAndBuild();
    requestAnimationFrame(animate);
  }

  function loadAndBuild() {
    setStatus('初始化 Three.js...');
    nodeGlowTex = createRadialTexture('rgba(126,243,255,1)', 'rgba(11,42,74,0.55)');

    starfield = createStarfield(1200, 1200, 1600);
    bgRoot.add(starfield);

    setStatus('加载中国 GeoJSON...');

    withTimeout(loadChinaGeoJSON(), 4500, 'GeoJSON')
      .then((geo) => {
        computeGeoCenterAndBounds(geo);
        createMapFromGeoJSON(geo);
      })
      .catch((err) => {
        console.error('[GeoJSON] load failed:', err);
        setStatus('GeoJSON 加载失败：使用 fallback（请用 HTTP 打开或检查网络）');
        createFallbackMap();
      })
      .finally(() => {
        energyBase = createEnergyBase();
        glowRoot.add(energyBase);

        radarRing = createRadarRing();
        glowRoot.add(radarRing);

        sweepLight = createSweepLight();
        glowRoot.add(sweepLight);
        initScenario();
        state.ready = true;
        notifyMapReady();
      });
  }

  function animate(now) {
    requestAnimationFrame(animate);
    const t = now * 0.001;
    state.time = t;

    for (let i = activeTweens.length - 1; i >= 0; i--) {
      const tw = activeTweens[i];
      const k = (now - tw.start) / tw.duration;
      if (k >= 1) {
        if (tw.onUpdate) tw.onUpdate(1);
        if (tw.onComplete) tw.onComplete();
        activeTweens.splice(i, 1);
      } else {
        if (tw.onUpdate) tw.onUpdate(Math.max(0, k));
      }
    }

    if (controls) controls.update();

    if (starfield) {
      starfield.rotation.y = t * 0.015;
      starfield.rotation.x = Math.sin(t * 0.08) * 0.02;
    }

    if (radarRing && radarRing.userData && radarRing.userData.mat) {
      radarRing.userData.mat.uniforms.uTime.value = t;
    }
    if (sweepLight && sweepLight.userData && sweepLight.userData.mat) {
      sweepLight.userData.mat.uniforms.uTime.value = t;
    }

    for (const l of flowLines) {
      if (l.userData && l.userData.mat) l.userData.mat.uniforms.uTime.value = t;
    }

    for (const m of flowTubes) {
      const ud = m.userData;
      if (!ud) continue;
      if (ud.coreMat) ud.coreMat.uniforms.uTime.value = t;
      if (ud.shellMat) ud.shellMat.uniforms.uTime.value = t;
      if (ud.mat && ud.mat !== ud.coreMat) ud.mat.uniforms.uTime.value = t;
    }

    for (const g of flowPackets) {
      const curve = g.userData && g.userData.curve;
      if (!curve) continue;
      for (const s of g.children) {
        const off = (s.userData && s.userData.offset) || 0;
        const spd = (s.userData && s.userData.speed) || 0.12;
        const p = (t * spd + off) % 1;
        const pos = curve.getPointAt(p);
        s.position.copy(pos);
        s.position.y += 0.2;
        const k = (p * 7.0) % 1;
        s.material.opacity = 0.55 + 0.45 * (1 - k);
      }
    }

    if (state.njDataFlows && state.njDataFlows.length) {
      for (const f of state.njDataFlows) {
        const path = f && f.path;
        if (!path || typeof path.getTotalLength !== 'function') continue;
        const L = path.getTotalLength();
        if (!Number.isFinite(L) || L <= 1) continue;
        for (const d of f.dots || []) {
          const p = (t * (d.speed || 0.18) + (d.offset || 0)) % 1;
          const pt = path.getPointAtLength(p * L);
          if (!pt) continue;
          d.el.setAttribute('cx', pt.x.toFixed(2));
          d.el.setAttribute('cy', pt.y.toFixed(2));
        }
      }
    }

    for (const n of nodesById.values()) {
      const g = n.group;
      let flash = g.userData.flash || 0;
      if (flash > 0) {
        flash = Math.max(0, flash - 0.018);
        g.userData.flash = flash;
      }

      const pulsePhase = (n.pulse.userData && n.pulse.userData.phase) || 0;
      const ringPhase = (n.ring.userData && n.ring.userData.phase) || 0;
      const breathe = 0.86 + 0.14 * Math.sin(t * 2.2 + ringPhase);

      n.sprite.material.opacity = Math.min(1, 0.82 + 0.18 * breathe + flash * 0.55);
      const s = 7.2 * (0.92 + 0.10 * breathe + flash * 0.25);
      n.sprite.scale.set(s, s, 1);

      const k = (t * 0.55 + pulsePhase) % 1;
      const ss = 1 + k * 2.1;
      n.pulse.scale.set(ss, ss, ss);
      n.pulse.material.opacity = (0.22 * (1 - k)) * (0.6 + 0.4 * breathe);

      n.ring.material.opacity = 0.22 + 0.14 * breathe;
      n.ring.rotation.z += 0.004; // subtle torus spin
    }

    for (const g of focusHintsRoot.children) {
      const ring = g.children && g.children[0];
      if (ring && ring.material) {
        const ph = (ring.userData && ring.userData.phase) || 0;
        ring.material.opacity = 0.14 + 0.06 * (0.5 + 0.5 * Math.sin(t * 1.8 + ph));
        ring.rotation.y = t * 0.35;
      }
    }

    rendererMain.setClearColor(0x000000, 0);

    scene.traverse(darkenNonBloom);
    bloomComposer.render();
    scene.traverse(restoreMaterials);
    finalComposer.render();
  }

  function ensureVisibleFallback() {
    window.setTimeout(() => {
      if (!state.ready && mapMeshes.length === 0) {
        console.warn('[Map] render timeout, building fallback map.');
        setStatus('地图加载超时：已启用本地兜底图形');
        createFallbackMap();
        if (!energyBase) {
          energyBase = createEnergyBase();
          glowRoot.add(energyBase);
        }
        if (!radarRing) {
          radarRing = createRadarRing();
          glowRoot.add(radarRing);
        }
        if (!sweepLight) {
          sweepLight = createSweepLight();
          glowRoot.add(sweepLight);
        }
        initScenario();
        state.ready = true;
        notifyMapReady();
      }
      updateSizes();
    }, 5200);
  }

  function notifyMapReady() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lgd-map-ready' }, '*');
      }
    } catch (_) {}
  }

  waitForStableStageSize(() => {
    main();
    ensureVisibleFallback();
  });
})();
