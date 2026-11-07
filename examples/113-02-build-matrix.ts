// 文件: examples/113-02-build-matrix.ts
// 构建矩阵：由 mode 推导 env / 入口 / 产物目录 / PWA 与体积预算，并对构建清单做门禁
// 目标：PC 与 H5 产物互不污染；错入口、缺 SW、串端组件库、超预算都必须被拦下

import assert from 'node:assert';

type EndKind = 'pc' | 'h5';
type Profile = 'dev' | 'prod';
type Mode = `${EndKind}-${Profile}`;
type AssetKind = 'js' | 'css' | 'images' | 'pwa';

interface Budget {
    js: number;
    css: number;
    images: number;
    total: number; // 单位 KB
}

interface BuildTarget {
    mode: Mode;
    end: EndKind;
    env: Record<string, string>;
    entry: string;
    outDir: string;
    pwa: boolean;
    budgets: Budget;
    forbiddenLibs: string[];
}

interface Asset {
    name: string;
    kind: AssetKind;
    sizeKb: number;
}

interface BuildManifest {
    mode: Mode;
    entry: string;
    assets: Asset[];
    imports: string[]; // 实际打进产物的第三方包名
}

const MODES: Mode[] = ['pc-dev', 'pc-prod', 'h5-dev', 'h5-prod'];

/** mode 是构建矩阵的唯一输入：其余字段都由它推导，禁止在代码里再写 if (isPc) 选入口 */
function deriveTarget(mode: Mode): BuildTarget {
    const [end, profile] = mode.split('-') as [EndKind, Profile];
    const prod = profile === 'prod';
    const budgets: Budget =
        end === 'pc'
            ? {
                  js: prod ? 520 : 900,
                  css: prod ? 110 : 180,
                  images: prod ? 700 : 1000,
                  total: prod ? 1400 : 2200,
              }
            : {
                  js: prod ? 260 : 520,
                  css: prod ? 60 : 120,
                  images: prod ? 500 : 800,
                  total: prod ? 800 : 1400,
              };
    return {
        mode,
        end,
        env: {
            VITE_APP_END: end,
            VITE_APP_PROFILE: profile,
            VITE_API_BASE: prod ? 'https://api.shop.example.com' : '/api',
            VITE_ENABLE_PWA: String(end === 'h5' && prod),
            VITE_SENTRY_DSN: prod ? 'https://dsn.example.com/1' : '',
        },
        entry: end === 'pc' ? 'index.pc.html' : 'index.h5.html',
        outDir: `dist/${end}${prod ? '' : '-dev'}`,
        pwa: end === 'h5' && prod,
        budgets,
        forbiddenLibs: end === 'pc' ? ['vant'] : ['element-plus'],
    };
}

function makeManifest(
    mode: Mode,
    entry: string,
    assets: Asset[],
    imports: string[],
): BuildManifest {
    return { mode, entry, assets, imports };
}

/** 构建门禁：返回全部问题而不是首次即抛，便于 CI 一次性列出所有违约项 */
function validateBuild(target: BuildTarget, manifest: BuildManifest): string[] {
    const issues: string[] = [];
    if (manifest.mode !== target.mode) issues.push(`mode 不匹配: ${manifest.mode} ≠ ${target.mode}`);
    if (manifest.entry !== target.entry) issues.push(`入口不匹配: ${manifest.entry} ≠ ${target.entry}`);

    const sum = (kind: AssetKind) =>
        manifest.assets.filter((a) => a.kind === kind).reduce((n, a) => n + a.sizeKb, 0);
    for (const kind of ['js', 'css', 'images'] as const) {
        if (sum(kind) > target.budgets[kind]) {
            issues.push(`${kind} 超预算: ${sum(kind)}KB > ${target.budgets[kind]}KB`);
        }
    }
    const total = manifest.assets.reduce((n, a) => n + a.sizeKb, 0);
    if (total > target.budgets.total) {
        issues.push(`总体积超预算: ${total}KB > ${target.budgets.total}KB`);
    }

    const hasSw = manifest.assets.some((a) => a.name === 'sw.js');
    if (target.pwa && !hasSw) issues.push('PWA 产物缺少 sw.js');
    if (!target.pwa && hasSw) issues.push('非 PWA 产物混入 sw.js');

    for (const lib of target.forbiddenLibs) {
        if (manifest.imports.includes(lib)) {
            issues.push(`串端依赖: ${lib} 不应进入 ${target.end} 产物`);
        }
    }
    return issues.sort();
}

function runAssertions() {
    // ---------- 测试 1：矩阵推导——入口、目录、PWA 与 env ----------
    const targets = MODES.map(deriveTarget);
    assert.equal(targets.length, 4);
    const h5Prod = targets.find((t) => t.mode === 'h5-prod');
    assert.ok(h5Prod);
    assert.equal(h5Prod.entry, 'index.h5.html');
    assert.equal(h5Prod.outDir, 'dist/h5');
    assert.equal(h5Prod.pwa, true);
    assert.deepEqual(h5Prod.env, {
        VITE_APP_END: 'h5',
        VITE_APP_PROFILE: 'prod',
        VITE_API_BASE: 'https://api.shop.example.com',
        VITE_ENABLE_PWA: 'true',
        VITE_SENTRY_DSN: 'https://dsn.example.com/1',
    });
    const pcDev = targets.find((t) => t.mode === 'pc-dev');
    assert.ok(pcDev);
    assert.equal(pcDev.entry, 'index.pc.html');
    assert.equal(pcDev.pwa, false);
    assert.equal(pcDev.env.VITE_ENABLE_PWA, 'false');
    console.log('[1/4] 构建矩阵推导 OK');

    // ---------- 测试 2：健康产物通过门禁 ----------
    const healthy = makeManifest(
        'h5-prod',
        'index.h5.html',
        [
            { name: 'vendor.js', kind: 'js', sizeKb: 210 },
            { name: 'app.css', kind: 'css', sizeKb: 55 },
            { name: 'hero.webp', kind: 'images', sizeKb: 460 },
            { name: 'sw.js', kind: 'pwa', sizeKb: 8 },
        ],
        ['vant'],
    );
    assert.deepEqual(validateBuild(h5Prod, healthy), []);
    console.log('[2/4] 健康产物通过 OK');

    // ---------- 测试 3：预算、入口与 PWA 契约 ----------
    const broken = makeManifest(
        'h5-prod',
        'index.pc.html',
        [
            { name: 'vendor.js', kind: 'js', sizeKb: 320 },
            { name: 'app.css', kind: 'css', sizeKb: 55 },
            { name: 'hero.webp', kind: 'images', sizeKb: 400 },
        ],
        ['vant'],
    );
    const issues = validateBuild(h5Prod, broken);
    assert.ok(issues.some((i) => i.includes('入口不匹配')), `应报入口错误: ${issues}`);
    assert.ok(issues.some((i) => i.startsWith('js 超预算')), `应报 js 超预算: ${issues}`);
    assert.ok(issues.some((i) => i.includes('缺少 sw.js')), `应报缺少 SW: ${issues}`);
    assert.equal(issues.length, 3);
    console.log('[3/4] 预算与入口门禁 OK:', issues.join(' | '));

    // ---------- 测试 4：串端依赖与 PWA 反向污染 ----------
    const leaked = makeManifest(
        'h5-prod',
        'index.h5.html',
        [
            { name: 'vendor.js', kind: 'js', sizeKb: 240 },
            { name: 'sw.js', kind: 'pwa', sizeKb: 8 },
        ],
        ['vant', 'element-plus'],
    );
    const leakIssues = validateBuild(h5Prod, leaked);
    assert.deepEqual(leakIssues, ['串端依赖: element-plus 不应进入 h5 产物']);

    const pcTarget = deriveTarget('pc-prod');
    const pcLeaked = makeManifest(
        'pc-prod',
        'index.pc.html',
        [{ name: 'app.js', kind: 'js', sizeKb: 400 }],
        ['element-plus', 'vant'],
    );
    assert.deepEqual(validateBuild(pcTarget, pcLeaked), ['串端依赖: vant 不应进入 pc 产物']);
    const pcWithSw = makeManifest(
        'pc-prod',
        'index.pc.html',
        [
            { name: 'app.js', kind: 'js', sizeKb: 400 },
            { name: 'sw.js', kind: 'pwa', sizeKb: 8 },
        ],
        ['element-plus'],
    );
    assert.ok(validateBuild(pcTarget, pcWithSw).includes('非 PWA 产物混入 sw.js'));
    console.log('[4/4] 串端依赖与 PWA 反向污染 OK');

    console.log('\n✅ 113-02 构建矩阵 全部断言通过');
}

runAssertions();
