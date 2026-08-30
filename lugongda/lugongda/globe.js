(function () {
  'use strict';

  function waitForThree(cb) {
    if (window.THREE && window.THREE.Scene && window.THREE.WebGLRenderer) {
      cb(window.THREE);
      return;
    }
    setTimeout(function () { waitForThree(cb); }, 150);
  }

  function createGlowTexture(THREE, color) {
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var half = size / 2;
    var gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.15, color);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  function createSatellite(THREE, orbitRadius, inclination, speed, phase, color, glowTex) {
    var group = new THREE.Group();
    var satColor = new THREE.Color(color);

    // ── central body (satellite bus) ──
    var bodyGeo = new THREE.BoxGeometry(0.07, 0.045, 0.045);
    var bodyMat = new THREE.MeshStandardMaterial({
      color: 0xd8d8d8,
      emissive: color,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.75,
      depthWrite: true,
    });
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // ── solar panel wings (left + right) ──
    var panelGeo = new THREE.BoxGeometry(0.20, 0.008, 0.038);
    var panelMat = new THREE.MeshStandardMaterial({
      color: 0x142050,
      emissive: 0x080c28,
      roughness: 0.55,
      metalness: 0.85,
      depthWrite: true,
    });
    var panelL = new THREE.Mesh(panelGeo, panelMat);
    panelL.position.set(-0.135, 0, 0);
    group.add(panelL);
    var panelR = new THREE.Mesh(panelGeo, panelMat);
    panelR.position.set(0.135, 0, 0);
    group.add(panelR);

    // solar cell divider lines
    var lineGeo = new THREE.BoxGeometry(0.16, 0.004, 0.004);
    var lineMat = new THREE.MeshBasicMaterial({ color: 0x4466aa, depthWrite: true });
    for (var s = -1; s <= 1; s += 2) {
      for (var i = 0; i < 4; i++) {
        var line = new THREE.Mesh(lineGeo, lineMat);
        line.position.set(s * 0.135, 0.007, (i - 1.5) * 0.01);
        group.add(line);
      }
    }

    // ── antenna dish (pointing toward Earth = +Z after lookAt) ──
    var stemGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.035, 8);
    var stemMat = new THREE.MeshStandardMaterial({
      color: 0x999999,
      roughness: 0.3,
      metalness: 0.9,
      depthWrite: true,
    });
    var stem = new THREE.Mesh(stemGeo, stemMat);
    stem.rotation.x = Math.PI / 2; // cylinder faces Z
    stem.position.set(0, 0, 0.04);
    group.add(stem);

    var dishGeo = new THREE.CylinderGeometry(0.015, 0.022, 0.01, 16);
    var dishMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8e8,
      emissive: color,
      emissiveIntensity: 0.12,
      roughness: 0.2,
      metalness: 0.95,
      depthWrite: true,
    });
    var dish = new THREE.Mesh(dishGeo, dishMat);
    dish.rotation.x = Math.PI / 2;
    dish.position.set(0, 0, 0.06);
    group.add(dish);

    // ── thruster glow (behind satellite = -Z after lookAt) ──
    var thrusterMat = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.60,
      depthWrite: false,
    });
    var thruster = new THREE.Sprite(thrusterMat);
    thruster.scale.set(0.18, 0.18, 1);
    thruster.position.set(0, 0, -0.06);
    group.add(thruster);

    return {
      group: group,
      radius: orbitRadius,
      inclination: inclination,
      speed: speed,
      phase: phase,
    };
  }

  function createOrbitRing(THREE, radius, inclination, color, opacity) {
    var ringGeo = new THREE.TorusGeometry(radius, 0.006, 16, 140);
    var ringMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      depthWrite: false,
    });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = inclination;
    return ring;
  }

  function createSurfaceDots(THREE) {
    var dotsGroup = new THREE.Group();
    var dotGeo = new THREE.SphereGeometry(0.018, 8, 8);

    var N = 80;
    for (var i = 0; i < N; i++) {
      // fibonacci sphere distribution
      var phi = Math.acos(1 - 2 * (i + 0.5) / N);
      var theta = Math.PI * (1 + Math.sqrt(5)) * i;
      var x = 1.022 * Math.sin(phi) * Math.cos(theta);
      var y = 1.022 * Math.cos(phi);
      var z = 1.022 * Math.sin(phi) * Math.sin(theta);

      // keep ~50% of dots
      if (Math.random() > 0.55) continue;

      var brightness = 0.35 + Math.random() * 0.65;
      var dotMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.48, 0.9, 0.35 + brightness * 0.45),
        depthWrite: true,
      });
      var dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(x, y, z);
      dotsGroup.add(dot);
    }
    return dotsGroup;
  }

  function createSurfaceConnections(THREE, dotsGroup) {
    var connGroup = new THREE.Group();
    var children = dotsGroup.children;
    if (children.length < 2) return connGroup;

    // connect some nearby dots with arc lines
    for (var i = 0; i < children.length; i++) {
      for (var j = i + 1; j < children.length; j++) {
        if (Math.random() > 0.06) continue;
        var a = children[i].position.clone();
        var b = children[j].position.clone();
        var dist = a.distanceTo(b);
        if (dist > 1.4) continue;

        // quadratic bezier arc above the surface
        var mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
        mid.normalize().multiplyScalar(1.18);

        var curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
        var pts = curve.getPoints(24);
        var lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        var lineMat = new THREE.LineBasicMaterial({
          color: 0x34dcff,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        });
        var line = new THREE.Line(lineGeo, lineMat);
        connGroup.add(line);
      }
    }
    return connGroup;
  }

  function createStars(THREE) {
    var count = 250;
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x88bbff,
      size: 0.018,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  waitForThree(function (THREE) {
    var canvas = document.getElementById('globe-canvas');
    if (!canvas) return;

    var container = document.getElementById('globe-container');
    if (!container) return;

    // ── renderer ──────────────────────────────────────────
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── scene & camera ────────────────────────────────────
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    camera.position.set(0, 0.45, 4.6);
    camera.lookAt(0, 0, 0);

    // ── earth group ───────────────────────────────────────
    var earthGroup = new THREE.Group();
    scene.add(earthGroup);

    // dark sphere body
    var earthGeo = new THREE.SphereGeometry(1, 72, 72);
    var earthMat = new THREE.MeshStandardMaterial({
      color: 0x07162a,
      emissive: 0x020c1a,
      roughness: 0.75,
      metalness: 0.15,
    });
    var earth = new THREE.Mesh(earthGeo, earthMat);
    earthGroup.add(earth);

    // wireframe grid
    var wireGeo = new THREE.SphereGeometry(1.008, 36, 36);
    var wireMat = new THREE.MeshBasicMaterial({
      color: 0x1e5a88,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: true,
    });
    var wireframe = new THREE.Mesh(wireGeo, wireMat);
    earthGroup.add(wireframe);

    // atmosphere fresnel shell
    var atmosGeo = new THREE.SphereGeometry(1.1, 72, 72);
    var atmosMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x34dcff) },
      },
      vertexShader: [
        'varying vec3 vNormal;',
        'varying vec3 vWorldPos;',
        'void main() {',
        '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
        '  vWorldPos = worldPos.xyz;',
        '  vNormal = normalize(mat3(modelMatrix) * normal);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vNormal;',
        'varying vec3 vWorldPos;',
        'uniform vec3 uColor;',
        'void main() {',
        '  vec3 viewDir = normalize(cameraPosition - vWorldPos);',
        '  float fresnel = 1.0 - abs(dot(viewDir, vNormal));',
        '  fresnel = pow(fresnel, 3.2);',
        '  gl_FragColor = vec4(uColor, fresnel * 0.45);',
        '}',
      ].join('\n'),
      transparent: true,
      depthWrite: false,
    });
    var atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    earthGroup.add(atmosphere);

    // ── surface dots (ground stations) ────────────────────
    var surfaceDots = createSurfaceDots(THREE);
    earthGroup.add(surfaceDots);

    // ── surface connections ───────────────────────────────
    var connections = createSurfaceConnections(THREE, surfaceDots);
    earthGroup.add(connections);

    // ── orbit rings ───────────────────────────────────────
    var orbitsGroup = new THREE.Group();
    orbitsGroup.add(createOrbitRing(THREE, 1.42, 0.35, 0x34dcff, 0.38));
    orbitsGroup.add(createOrbitRing(THREE, 1.56, Math.PI / 3.1, 0x4d9eff, 0.28));
    orbitsGroup.add(createOrbitRing(THREE, 1.7, -0.45, 0x34dcff, 0.32));
    scene.add(orbitsGroup);

    // ── satellites ────────────────────────────────────────
    var glowTexA = createGlowTexture(THREE, '#34dcff');
    var glowTexB = createGlowTexture(THREE, '#4d9eff');
    var satellites = [
      createSatellite(THREE, 1.42, 0.35, 0.55, 0.0, '#34dcff', glowTexA),
      createSatellite(THREE, 1.56, Math.PI / 3.1, 0.42, Math.PI * 0.67, '#4d9eff', glowTexB),
      createSatellite(THREE, 1.7, -0.45, 0.33, Math.PI * 1.33, '#34dcff', glowTexA),
    ];
    var satsGroup = new THREE.Group();
    satellites.forEach(function (s) { satsGroup.add(s.group); });
    scene.add(satsGroup);

    // ── stars ─────────────────────────────────────────────
    var stars = createStars(THREE);
    scene.add(stars);

    // ── lights ────────────────────────────────────────────
    var ambient = new THREE.AmbientLight(0x335577, 0.55);
    scene.add(ambient);
    var pointLight = new THREE.PointLight(0x5599cc, 1.6, 12);
    pointLight.position.set(3, 2.5, 3.5);
    scene.add(pointLight);
    var rimLight = new THREE.PointLight(0x3388bb, 1.0, 10);
    rimLight.position.set(-3, -1, -2);
    scene.add(rimLight);

    // ── resize ────────────────────────────────────────────
    function resize() {
      var rect = container.getBoundingClientRect();
      var w = Math.max(2, Math.floor(rect.width));
      var h = Math.max(2, Math.floor(rect.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    // ── click → open 天启卫星 detail page ─────────────────
    var targetUrl = 'http://127.0.0.1:8090/';
    function buildSatelliteTargetUrl() {
      var parentUrl = '';
      try {
        if (window.parent && window.parent !== window && window.parent.location) {
          parentUrl = window.parent.location.href;
        }
      } catch (_) {}
      if (!parentUrl) parentUrl = document.referrer || window.location.href;

      var url = new URL(targetUrl, window.location.href);
      url.searchParams.set('returnUrl', parentUrl);
      return url.toString();
    }

    function openSatellitePlatform() {
      var detailWindow = window.open(buildSatelliteTargetUrl(), 'leo-satellite-platform');
      if (detailWindow) detailWindow.focus();
    }
    var raycaster = new THREE.Raycaster();
    var clickMouse = new THREE.Vector2();

    canvas.addEventListener('click', function (e) {
      var rect = canvas.getBoundingClientRect();
      clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      clickMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(clickMouse, camera);
      var hits = raycaster.intersectObject(earth, false);

      if (hits.length > 0) {
        openSatellitePlatform();
      }
    });

    // touch support
    canvas.addEventListener('touchend', function (e) {
      if (!e.changedTouches || !e.changedTouches.length) return;
      var touch = e.changedTouches[0];
      var rect = canvas.getBoundingClientRect();
      clickMouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      clickMouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(clickMouse, camera);
      var hits = raycaster.intersectObject(earth, false);

      if (hits.length > 0) {
        e.preventDefault();
        openSatellitePlatform();
      }
    }, { passive: false });

    // ── animate ───────────────────────────────────────────
    function animate(time) {
      requestAnimationFrame(animate);

      var t = time * 0.001;

      // earth rotation
      earthGroup.rotation.y += 0.0018;

      // satellite orbit positions
      satellites.forEach(function (s) {
        var angle = t * s.speed + s.phase;
        var r = s.radius;
        var x = r * Math.cos(angle);
        var z = r * Math.sin(angle);

        var ci = Math.cos(s.inclination);
        var si = Math.sin(s.inclination);
        var y = z * si;
        var z2 = z * ci;

        s.group.position.set(x, y, z2);

        // orient trail to face outward
        s.group.lookAt(0, 0, 0);
      });

      // slow orbit precession
      orbitsGroup.rotation.y += 0.0004;

      // star twinkle-like rotation
      stars.rotation.y += 0.0003;
      stars.rotation.x += 0.0002;

      renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);
  });
})();
