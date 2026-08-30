/**
 * 专业级3D卫星星座可视化组件
 * 使用 Three.js 实现逼真的地球和卫星动画
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

class SatelliteGlobe {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);

        if (!this.container) {
            console.error(`Container #${containerId} not found`);
            return;
        }

        // 场景对象
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.earth = null;
        this.atmosphere = null;
        this.satellites = [];
        this.orbits = [];
        this.stars = null;

        // 控制参数
        this.isMouseDown = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetRotationX = 0.3;
        this.targetRotationY = 0;
        this.rotationSpeed = 0.002;
        this.showOrbits = true;
        this.animationSpeed = 1;
        this.isActive = true;
        this.isDisposed = false;
        this.animationFrameId = null;
        this.boundListeners = null;

        // 轨道配置 - 6条轨道，共40颗卫星
        this.orbitConfigs = [
            { name: 'LEO-1', radius: 1.12, inclination: 20, count: 7, color: 0x00ff88, speed: 0.003 },
            { name: 'LEO-2', radius: 1.18, inclination: 50, count: 7, color: 0x00aaff, speed: 0.0028 },
            { name: 'LEO-3', radius: 1.24, inclination: 80, count: 7, color: 0x88ff00, speed: 0.0025 },
            { name: 'MEO-1', radius: 1.35, inclination: 110, count: 7, color: 0xff6600, speed: 0.002 },
            { name: 'MEO-2', radius: 1.45, inclination: 140, count: 6, color: 0xff0088, speed: 0.0018 },
            { name: 'MEO-3', radius: 1.55, inclination: 170, count: 6, color: 0xaa00ff, speed: 0.0015 }
        ];

        // 加载保存的视角状态
        this.loadViewState();

        this.init();
    }

    loadViewState() {
        try {
            const saved = localStorage.getItem('satellite_globe_view');
            if (saved) {
                const state = JSON.parse(saved);
                if (typeof state.rotX === 'number') this.targetRotationX = state.rotX;
                if (typeof state.rotY === 'number') this.targetRotationY = state.rotY;
                if (typeof state.zoom === 'number') this.initialZoom = state.zoom;
            }
        } catch (e) {
            console.warn('Failed to load globe view state', e);
        }
    }

    saveViewState() {
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            if (!this.camera) return;
            const state = {
                rotX: this.targetRotationX,
                rotY: this.targetRotationY,
                zoom: this.camera.position.z
            };
            localStorage.setItem('satellite_globe_view', JSON.stringify(state));
        }, 500); // 500ms 防抖
    }

    init() {
        try {
            this.setupScene();
            // 移除恒星背景，只保留纯黑色太空
            // this.createStars();
            this.createEarth();
            this.createAtmosphere();
            this.createSatellites();
            this.setupEventListeners();

            // 应用初始旋转状态，防止跳变
            if (this.scene) {
                this.scene.rotation.x = this.targetRotationX;
                this.scene.rotation.y = this.targetRotationY;
            }

            this.animate();
            this.updateStats();
            this.hideLoading();
            console.log('Three.js 卫星可视化初始化成功');
        } catch (error) {
            console.error('初始化失败:', error);
            this.showError(error.message);
        }
    }

    setupScene() {
        const rect = this.container.getBoundingClientRect();
        const width = rect.width || this.container.clientWidth || 300;
        const height = rect.height || this.container.clientHeight || 300;

        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0f172a);

        // 创建相机 - 拉近距离让地球更大
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        // 使用保存的缩放值或默认值
        this.camera.position.z = this.initialZoom || 2.8;

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // 添加光源 - 高对比度设置
        const ambientLight = new THREE.AmbientLight(0x000000, 0); // 几乎无环境光，全靠地球反光和太阳
        this.scene.add(ambientLight);

        // 主光源 (太阳) - 强烈的定向光
        const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
        sunLight.position.set(5, 3, 5);
        sunLight.castShadow = true;
        this.scene.add(sunLight);

        // 补光 (月光/星光) - 微弱的冷色光
        const fillLight = new THREE.DirectionalLight(0x445566, 0.3);
        fillLight.position.set(-5, 0, -5);
        this.scene.add(fillLight);
    }

    createStars() {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const colors = [];
        const sizes = [];

        // 创建更多更逼真的星星
        for (let i = 0; i < 8000; i++) {
            const radius = 50 + Math.random() * 150;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);
            vertices.push(x, y, z);

            // 添加彩色恒星
            const colorType = Math.random();
            let r, g, b;
            if (colorType < 0.6) {
                // 白色恒星
                const brightness = 0.7 + Math.random() * 0.3;
                r = brightness; g = brightness; b = brightness;
            } else if (colorType < 0.75) {
                // 蓝色恒星
                r = 0.6 + Math.random() * 0.2;
                g = 0.7 + Math.random() * 0.2;
                b = 1.0;
            } else if (colorType < 0.9) {
                // 黄色/橙色恒星
                r = 1.0;
                g = 0.7 + Math.random() * 0.3;
                b = 0.4 + Math.random() * 0.2;
            } else {
                // 红色恒星
                r = 1.0;
                g = 0.4 + Math.random() * 0.2;
                b = 0.3 + Math.random() * 0.2;
            }
            colors.push(r, g, b);

            // 随机大小
            sizes.push(0.3 + Math.random() * 1.2);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.6,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true
        });

        this.stars = new THREE.Points(geometry, material);
        this.scene.add(this.stars);

        // 添加银河/星云效果
        this.createNebula();
    }

    createNebula() {
        const nebulaGeometry = new THREE.BufferGeometry();
        const nebulaVertices = [];
        const nebulaColors = [];

        // 创建银河带效果
        for (let i = 0; i < 2000; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 30 + Math.random() * 80;
            const height = (Math.random() - 0.5) * 15;

            const x = radius * Math.cos(angle);
            const y = height;
            const z = radius * Math.sin(angle);
            nebulaVertices.push(x, y, z);

            // 紫色/蓝色星云颜色
            const colorMix = Math.random();
            nebulaColors.push(
                0.2 + colorMix * 0.3,
                0.1 + colorMix * 0.2,
                0.4 + colorMix * 0.4
            );
        }

        nebulaGeometry.setAttribute('position', new THREE.Float32BufferAttribute(nebulaVertices, 3));
        nebulaGeometry.setAttribute('color', new THREE.Float32BufferAttribute(nebulaColors, 3));

        const nebulaMaterial = new THREE.PointsMaterial({
            size: 1.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending
        });

        const nebula = new THREE.Points(nebulaGeometry, nebulaMaterial);
        nebula.rotation.x = 0.3;
        this.scene.add(nebula);
    }

    createEarth() {
        const geometry = new THREE.SphereGeometry(1, 64, 64);
        const textureLoader = new THREE.TextureLoader();

        // 使用NASA蓝色大理石地球纹理
        const earthTexture = textureLoader.load(
            'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg',
            () => console.log('地球纹理加载成功'),
            undefined,
            (err) => console.error('地球纹理加载失败:', err)
        );

        // 凹凸纹理(地形)
        const bumpTexture = textureLoader.load(
            'https://unpkg.com/three-globe@2.31.0/example/img/earth-topology.png'
        );

        // 高光纹理(海洋反光)
        const specularTexture = textureLoader.load(
            'https://unpkg.com/three-globe@2.31.0/example/img/earth-water.png'
        );

        // 夜间灯光纹理
        const nightTexture = textureLoader.load(
            'https://unpkg.com/three-globe@2.31.0/example/img/earth-night.jpg'
        );

        // 创建地球材质 - 调暗整体，增加对比度
        const material = new THREE.MeshPhongMaterial({
            map: earthTexture,
            bumpMap: bumpTexture,
            bumpScale: 0.05,
            specularMap: specularTexture,
            specular: new THREE.Color(0x4466cc),  // 增强海洋反光，更蓝
            shininess: 45,  // 增加光泽度，使高光更集中
            color: new THREE.Color(0x555555)  // 再次调暗基色，增加对比度
        });

        this.earth = new THREE.Mesh(geometry, material);
        this.earth.rotation.x = 0.4; // 地轴倾斜
        this.scene.add(this.earth);

        // 添加云层
        this.createClouds();

        // 添加夜间灯光层
        this.createNightLights(nightTexture);

        // 添加经纬度网格
        this.createGridLines();
    }

    createClouds() {
        const geometry = new THREE.SphereGeometry(1.02, 64, 64);
        const textureLoader = new THREE.TextureLoader();

        // 加载云层纹理
        const cloudTexture = textureLoader.load(
            'https://threejs.org/examples/textures/planets/earth_clouds_1024.png',
            () => console.log('云层纹理加载成功'),
            undefined,
            (err) => console.error('云层纹理加载失败:', err)
        );

        const material = new THREE.MeshPhongMaterial({
            map: cloudTexture,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide,
            depthWrite: false,
            color: 0xffffff
        });

        this.clouds = new THREE.Mesh(geometry, material);
        this.clouds.rotation.x = 0.4;
        this.scene.add(this.clouds);
    }

    createNightLights(nightTexture) {
        const geometry = new THREE.SphereGeometry(1.002, 64, 64);

        const material = new THREE.MeshBasicMaterial({
            map: nightTexture,
            transparent: true,
            opacity: 0.6, // slightly increased for high contrast scene
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.nightLights = new THREE.Mesh(geometry, material);
        this.nightLights.rotation.x = 0.4;
        this.scene.add(this.nightLights);
    }

    createGridLines() {
        const gridGroup = new THREE.Group();
        const material = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.15
        });

        // 纬线
        for (let lat = -60; lat <= 60; lat += 30) {
            const phi = (90 - lat) * Math.PI / 180;
            const points = [];
            for (let lng = 0; lng <= 360; lng += 5) {
                const theta = lng * Math.PI / 180;
                const r = 1.005;
                const x = r * Math.sin(phi) * Math.cos(theta);
                const y = r * Math.cos(phi);
                const z = r * Math.sin(phi) * Math.sin(theta);
                points.push(new THREE.Vector3(x, y, z));
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            gridGroup.add(new THREE.Line(geometry, material));
        }

        // 经线
        for (let lng = 0; lng < 360; lng += 30) {
            const theta = lng * Math.PI / 180;
            const points = [];
            for (let lat = -90; lat <= 90; lat += 5) {
                const phi = (90 - lat) * Math.PI / 180;
                const r = 1.005;
                const x = r * Math.sin(phi) * Math.cos(theta);
                const y = r * Math.cos(phi);
                const z = r * Math.sin(phi) * Math.sin(theta);
                points.push(new THREE.Vector3(x, y, z));
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            gridGroup.add(new THREE.Line(geometry, material));
        }

        this.scene.add(gridGroup);
    }

    createAtmosphere() {
        const geometry = new THREE.SphereGeometry(1.08, 64, 64);
        const material = new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                void main() {
                    float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
                    gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity * 1.2; // 稍微降低大气层亮度
                }
            `,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            transparent: true
        });

        this.atmosphere = new THREE.Mesh(geometry, material);
        this.scene.add(this.atmosphere);
    }

    createSatellites() {
        this.orbitConfigs.forEach((config, orbitIndex) => {
            // 为每颗卫星创建独立轨道
            for (let i = 0; i < config.count; i++) {
                // 创建轨道组（包含轨道线和卫星）
                const orbitGroup = new THREE.Group();

                // 设置这个轨道组的旋转（增大轨道间角度）
                const raanAngle = orbitIndex * Math.PI / 2 + (i / config.count) * Math.PI * 2;
                orbitGroup.rotation.x = config.inclination * Math.PI / 180;
                orbitGroup.rotation.y = raanAngle;

                // 创建轨道线
                const orbitPoints = [];
                for (let j = 0; j <= 100; j++) {
                    const angle = (j / 100) * Math.PI * 2;
                    const x = config.radius * Math.cos(angle);
                    const z = config.radius * Math.sin(angle);
                    orbitPoints.push(new THREE.Vector3(x, 0, z));
                }

                const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
                const orbitMaterial = new THREE.LineBasicMaterial({
                    color: config.color,
                    transparent: true,
                    opacity: 0.6
                });
                const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
                orbitGroup.add(orbitLine);

                this.orbits.push(orbitGroup);
                this.scene.add(orbitGroup);

                // 创建卫星（直接在轨道平面上，初始相位为0）
                const satellite = this.createSatellite(config, i);
                satellite.userData = {
                    config: config,
                    orbitIndex: orbitIndex,
                    satIndex: i,
                    radius: config.radius,
                    initialPhase: (i / config.count) * Math.PI * 2 * 3, // 分散初始相位
                    time: 0
                };

                // 设置卫星初始位置在轨道上
                satellite.position.x = config.radius;
                satellite.position.y = 0;
                satellite.position.z = 0;

                // 卫星添加到轨道组，自动继承轨道旋转
                orbitGroup.add(satellite);
                this.satellites.push(satellite);
            }
        });
    }

    createSatellite(config, index) {
        const group = new THREE.Group();

        // 卫星主体 - 更逼真的3D模型
        const bodyGeometry = new THREE.BoxGeometry(0.025, 0.015, 0.015);
        const bodyMaterial = new THREE.MeshPhongMaterial({
            color: 0x888888,
            specular: 0xffffff,
            shininess: 100
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        group.add(body);

        // 太阳能电池板
        const panelGeometry = new THREE.BoxGeometry(0.06, 0.002, 0.02);
        const panelMaterial = new THREE.MeshPhongMaterial({
            color: 0x1a237e,
            specular: 0x3f51b5,
            shininess: 50
        });
        const leftPanel = new THREE.Mesh(panelGeometry, panelMaterial);
        leftPanel.position.x = -0.04;
        group.add(leftPanel);

        const rightPanel = new THREE.Mesh(panelGeometry, panelMaterial);
        rightPanel.position.x = 0.04;
        group.add(rightPanel);

        // 天线
        const antennaGeometry = new THREE.CylinderGeometry(0.002, 0.002, 0.02, 8);
        const antennaMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc });
        const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
        antenna.position.y = 0.015;
        group.add(antenna);

        // 发光信号点
        const glowGeometry = new THREE.SphereGeometry(0.008, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: config.color,
            transparent: true,
            opacity: 0.9
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.y = 0.025;
        group.add(glow);

        // 外围光晕
        const haloGeometry = new THREE.SphereGeometry(0.02, 16, 16);
        const haloMaterial = new THREE.MeshBasicMaterial({
            color: config.color,
            transparent: true,
            opacity: 0.2
        });
        const halo = new THREE.Mesh(haloGeometry, haloMaterial);
        halo.position.y = 0.025;
        group.add(halo);

        // 信号环
        const ringGeometry = new THREE.RingGeometry(0.025, 0.03, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: config.color,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        group.userData.ring = ring;

        return group;
    }

    setupEventListeners() {
        if (this.boundListeners) {
            return;
        }

        this.boundListeners = {
            mouseDown: (e) => {
                if (this.isDisposed) {
                    return;
                }
                this.isMouseDown = true;
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;
            },
            mouseMove: (e) => {
                if (this.isDisposed || !this.isMouseDown) {
                    return;
                }
                const deltaX = e.clientX - this.mouseX;
                const deltaY = e.clientY - this.mouseY;
                this.targetRotationY += deltaX * 0.005;
                this.targetRotationX += deltaY * 0.005;
                this.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetRotationX));
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;
                this.saveViewState();
            },
            mouseUp: () => {
                this.isMouseDown = false;
            },
            wheel: (e) => {
                if (this.isDisposed || !this.camera) {
                    return;
                }
                e.preventDefault();
                const delta = e.deltaY > 0 ? 1.1 : 0.9;
                this.camera.position.z = Math.max(2, Math.min(10, this.camera.position.z * delta));
                this.saveViewState();
            },
            resize: () => this.onResize(),
        };

        this.container.addEventListener('mousedown', this.boundListeners.mouseDown);
        document.addEventListener('mousemove', this.boundListeners.mouseMove);
        document.addEventListener('mouseup', this.boundListeners.mouseUp);
        this.container.addEventListener('wheel', this.boundListeners.wheel);
        window.addEventListener('resize', this.boundListeners.resize);
    }

    removeEventListeners() {
        if (!this.boundListeners) {
            return;
        }
        this.container?.removeEventListener('mousedown', this.boundListeners.mouseDown);
        document.removeEventListener('mousemove', this.boundListeners.mouseMove);
        document.removeEventListener('mouseup', this.boundListeners.mouseUp);
        this.container?.removeEventListener('wheel', this.boundListeners.wheel);
        window.removeEventListener('resize', this.boundListeners.resize);
        this.boundListeners = null;
    }

    onResize() {
        if (this.isDisposed || !this.container || !this.camera || !this.renderer) {
            return;
        }
        const rect = this.container.getBoundingClientRect();
        const width = rect.width || this.container.clientWidth || 300;
        const height = rect.height || this.container.clientHeight || 300;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate() {
        if (!this.isActive || this.isDisposed || !this.renderer || !this.scene || !this.camera) {
            this.animationFrameId = null;
            return;
        }

        this.animationFrameId = requestAnimationFrame(() => this.animate());

        const time = Date.now() * 0.001;

        if (this.earth) {
            this.earth.rotation.y += 0.001 * this.animationSpeed;
        }

        if (this.clouds) {
            this.clouds.rotation.y += 0.0012 * this.animationSpeed;
        }

        if (this.nightLights) {
            this.nightLights.rotation.y = this.earth ? this.earth.rotation.y : 0;
        }

        this.scene.rotation.x += (this.targetRotationX - this.scene.rotation.x) * 0.05;
        this.scene.rotation.y += (this.targetRotationY - this.scene.rotation.y) * 0.05;

        this.satellites.forEach((satellite) => {
            const data = satellite.userData;
            data.time += data.config.speed * this.animationSpeed;
            const angle = data.time + (data.initialPhase || 0);
            satellite.position.x = data.radius * Math.cos(angle);
            satellite.position.z = data.radius * Math.sin(angle);
            satellite.position.y = 0;

            if (satellite.userData.ring) {
                satellite.userData.ring.scale.setScalar(1 + Math.sin(time * 3 + data.satIndex) * 0.3);
                satellite.userData.ring.material.opacity = 0.3 + Math.sin(time * 3 + data.satIndex) * 0.2;
            }
        });

        if (this.stars) {
            this.stars.rotation.y += 0.0001;
        }

        this.renderer.render(this.scene, this.camera);
    }

    pause() {
        this.isActive = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    resume() {
        if (this.isDisposed || this.isActive) {
            return;
        }
        this.isActive = true;
        this.onResize();
        this.animate();
    }

    disposeObject3D(object) {
        if (!object) {
            return;
        }
        if (object.geometry && typeof object.geometry.dispose === 'function') {
            object.geometry.dispose();
        }
        if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                if (!material) {
                    return;
                }
                Object.keys(material).forEach((key) => {
                    const value = material[key];
                    if (value && typeof value.dispose === 'function') {
                        value.dispose();
                    }
                });
                if (typeof material.dispose === 'function') {
                    material.dispose();
                }
            });
        }
        if (object.children && object.children.length > 0) {
            [...object.children].forEach((child) => this.disposeObject3D(child));
        }
    }

    dispose() {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;
        this.pause();
        this.removeEventListeners();
        this.isMouseDown = false;
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }
        if (this.scene) {
            this.disposeObject3D(this.scene);
        }
        if (this.renderer) {
            this.renderer.dispose();
            if (typeof this.renderer.forceContextLoss === 'function') {
                this.renderer.forceContextLoss();
            }
            const canvas = this.renderer.domElement;
            if (canvas && canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
        }
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.earth = null;
        this.atmosphere = null;
        this.clouds = null;
        this.nightLights = null;
        this.stars = null;
        this.satellites = [];
        this.orbits = [];
    }

    updateStats() {
        const total = this.satellites.length;
        document.getElementById('totalSatellites')?.textContent &&
            (document.getElementById('totalSatellites').textContent = total);
        document.getElementById('activeSatellites')?.textContent &&
            (document.getElementById('activeSatellites').textContent = total - 2);
        document.getElementById('orbitCount')?.textContent &&
            (document.getElementById('orbitCount').textContent = this.orbitConfigs.length);
        document.getElementById('coverageRate')?.textContent &&
            (document.getElementById('coverageRate').textContent = '98%');
    }

    hideLoading() {
        const loading = this.container?.querySelector('.globe-loading');
        if (loading) loading.style.display = 'none';
    }

    showError(message) {
        const loading = this.container?.querySelector('.globe-loading');
        if (loading) {
            loading.innerHTML = `<span style="color: #ff6b6b;"><i class="fas fa-exclamation-triangle"></i> ${message}</span>`;
        }
    }

    // 公共方法
    resetView() {
        this.targetRotationX = 0.3;
        this.targetRotationY = 0;
        this.camera.position.z = 4;
    }

    toggleOrbits() {
        this.showOrbits = !this.showOrbits;
        // 只隐藏轨道线，不隐藏卫星
        this.orbits.forEach(orbitGroup => {
            // 轨道线是轨道组的第一个子元素
            if (orbitGroup.children && orbitGroup.children[0]) {
                orbitGroup.children[0].visible = this.showOrbits;
            }
        });
        return this.showOrbits;
    }

    togglePaths() {
        // 切换卫星光晕显示
        this.satellites.forEach(sat => {
            if (sat.children[1]) {
                sat.children[1].visible = !sat.children[1].visible;
            }
        });
    }

    setAnimationSpeed(speed) {
        // 速度范围1-10，直接使用
        this.animationSpeed = speed;
    }
}

// 导出
window.SatelliteGlobe = SatelliteGlobe;
