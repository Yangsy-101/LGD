import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..');
const cssDirectory = join(projectRoot, 'assets', 'css');

const layers = [
    {
        name: 'base',
        label: '基础层',
        output: 'dashboard-base.css',
        sources: ['style.css', 'satellite_globe.css'],
    },
    {
        name: 'page',
        label: '页面层',
        output: 'dashboard-page.css',
        sources: ['professional.css', 'telemetry-redesign.css'],
    },
    {
        name: 'adaptive',
        label: '自适应层',
        output: 'dashboard-adaptive.css',
        sources: ['command-center-redesign.css'],
    },
];

for (const layer of layers) {
    const sections = await Promise.all(layer.sources.map(async (source) => {
        const css = await readFile(join(cssDirectory, source), 'utf8');
        return `/* ===== Source: ${source} ===== */\n${css.replace(/\r\n/g, '\n').trimEnd()}`;
    }));
    const banner = [
        '/*!',
        ' * AUTO-GENERATED FILE — DO NOT EDIT DIRECTLY.',
        ` * Dashboard CSS ${layer.label} (${layer.name})`,
        ` * Sources: ${layer.sources.join(' -> ')}`,
        ' * Run: node scripts/build-dashboard-css.mjs',
        ' */',
        '',
    ].join('\n');
    await writeFile(join(cssDirectory, layer.output), `${banner}${sections.join('\n\n')}\n`, 'utf8');
    console.log(`Built assets/css/${layer.output}`);
}
