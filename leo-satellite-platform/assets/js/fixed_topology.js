(() => {
    const GLOBE_CONTAINER_ID = 'fixedSatelliteGlobe';
    const PAGE_VISIBILITY_MESSAGE_TYPE = 'controlplatform:page-visibility';

    const initFixedTopology = () => {
        const topology = document.getElementById('fixedTopology');
        const globeContainer = document.getElementById(GLOBE_CONTAINER_ID);
        if (!topology || !globeContainer || topology.dataset.initialized === 'true') {
            return;
        }
        if (typeof window.SatelliteGlobe !== 'function') {
            topology.dataset.visualState = 'unavailable';
            return;
        }

        topology.dataset.initialized = 'true';
        const globe = new window.SatelliteGlobe(GLOBE_CONTAINER_ID);
        window.__fixedTopologyGlobe = globe;

        const toggleOrbitVisibility = () => {
            const visible = globe.toggleOrbits?.();
            if (typeof visible === 'boolean') {
                globeContainer.setAttribute('aria-pressed', String(visible));
            }
        };

        globeContainer.addEventListener('dblclick', (event) => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            toggleOrbitVisibility();
        });

        globeContainer.addEventListener('keydown', (event) => {
            if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) {
                return;
            }
            event.preventDefault();
            toggleOrbitVisibility();
        });

        let resizeFrame = 0;
        const resizeGlobe = () => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => globe.onResize?.());
        };

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(resizeGlobe)
            : null;
        resizeObserver?.observe(globeContainer);
        window.addEventListener('resize', resizeGlobe, { passive: true });

        const setActive = (active) => {
            if (active) {
                globe.resume?.();
                resizeGlobe();
            } else {
                globe.pause?.();
            }
        };

        window.addEventListener('message', (event) => {
            if (event.source === window.parent && event?.data?.type === PAGE_VISIBILITY_MESSAGE_TYPE) {
                setActive(event.data.active !== false);
            }
        });
        document.addEventListener('visibilitychange', () => setActive(!document.hidden));

        requestAnimationFrame(() => {
            resizeGlobe();
            topology.dataset.visualState = 'ready';
            topology.dispatchEvent(new CustomEvent('fixed-topology:ready'));
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFixedTopology, { once: true });
    } else {
        initFixedTopology();
    }
})();
