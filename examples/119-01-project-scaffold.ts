// 文件: examples/119-01-project-scaffold.ts
// 项目脚手架生成器：按业务配置生成目录、模块清单与双端入口，并在生成前校验分层依赖边界
// 目标：骨架可复现；跨层/跨端/外部 UI 库依赖与非法配置全部阻断

import assert from 'node:assert';

type Layer = 'core' | 'services' | 'adapters' | 'composables' | 'ui-shared' | 'ui-pc' | 'ui-h5';
type Target = 'pc' | 'h5';

interface ModuleSpec {
    name: string;
    layer: Layer;
    deps: string[];
    external?: string[];
}

interface ProjectConfig {
    name: string;
    targets: Target[];
    modules: ModuleSpec[];
}

interface Manifest {
    name: string;
    layer: Layer;
    path: string;
    targets: Target[];
    deps: string[];
    external: string[];
}

interface Scaffold {
    directories: string[];
    manifests: Manifest[];
    entryFiles: string[];
}

const LAYER_ORDER: Layer[] = ['core', 'services', 'adapters', 'composables', 'ui-shared', 'ui-pc', 'ui-h5'];

/** 依赖方向：只允许从右往左依赖，UI 层永远不能反向进入 core */
const ALLOWED_LAYER_DEPS: Record<Layer, Layer[]> = {
    core: ['core'],
    services: ['core', 'services'],
    adapters: ['core', 'services', 'adapters'],
    composables: ['core', 'services', 'composables'],
    'ui-shared': ['core', 'composables', 'ui-shared'],
    'ui-pc': ['core', 'services', 'composables', 'ui-shared', 'ui-pc'],
    'ui-h5': ['core', 'services', 'composables', 'ui-shared', 'ui-h5'],
};

/** 各层禁止引入的第三方包：core 必须零框架，UI 库不能串端 */
const FORBIDDEN_EXTERNAL: Record<Layer, string[]> = {
    core: ['vue', 'pinia', 'element-plus', 'vant'],
    services: ['vue', 'pinia', 'element-plus', 'vant'],
    adapters: ['element-plus', 'vant'],
    composables: ['element-plus', 'vant'],
    'ui-shared': ['element-plus', 'vant'],
    'ui-pc': ['vant'],
    'ui-h5': ['element-plus'],
};

/** 模块实际要产出的端：共享层跟随构建矩阵，UI 层只属于自己那一端 */
function moduleTargets(layer: Layer, targets: Target[]): Target[] {
    if (layer === 'ui-pc') return targets.includes('pc') ? ['pc'] : [];
    if (layer === 'ui-h5') return targets.includes('h5') ? ['h5'] : [];
    return [...targets].sort();
}

function validateConfig(config: ProjectConfig): string[] {
    const violations: string[] = [];
    const byName = new Map<string, ModuleSpec>();

    for (const mod of config.modules) {
        if (!/^[a-z][a-z0-9-]*$/.test(mod.name)) {
            violations.push(`模块名不合法: ${mod.name}（要求 kebab-case）`);
        }
        if (byName.has(mod.name)) {
            violations.push(`模块名重复: ${mod.name}`);
        }
        byName.set(mod.name, mod);
        if ((mod.layer === 'ui-pc' || mod.layer === 'ui-h5') && moduleTargets(mod.layer, config.targets).length === 0) {
            violations.push(`目标缺少对应 UI 层: ${mod.name}(${mod.layer})`);
        }
    }

    for (const mod of config.modules) {
        for (const depName of mod.deps) {
            const dep = byName.get(depName);
            if (!dep) {
                violations.push(`未知依赖: ${mod.name} -> ${depName}`);
                continue;
            }
            if (!ALLOWED_LAYER_DEPS[mod.layer].includes(dep.layer)) {
                violations.push(`越层依赖: ${mod.name}(${mod.layer}) -> ${depName}(${dep.layer})`);
            }
        }
        for (const pkg of mod.external ?? []) {
            if (FORBIDDEN_EXTERNAL[mod.layer].includes(pkg)) {
                violations.push(`越界外部依赖: ${mod.name}(${mod.layer}) 不得引入 ${pkg}`);
            }
        }
    }

    // 三色标记找环：路径中的节点再次被访问即为环
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const reported = new Set<string>();
    const visit = (name: string): void => {
        const status = state.get(name) ?? 0;
        if (status === 2) return;
        if (status === 1) {
            const cycle = [...stack.slice(stack.indexOf(name)), name].join(' -> ');
            if (!reported.has(cycle)) {
                violations.push(`依赖环: ${cycle}`);
                reported.add(cycle);
            }
            return;
        }
        state.set(name, 1);
        stack.push(name);
        const mod = byName.get(name);
        if (mod) for (const depName of mod.deps) if (byName.has(depName)) visit(depName);
        stack.pop();
        state.set(name, 2);
    };
    for (const mod of config.modules) visit(mod.name);

    return violations;
}

/** 依赖拓扑序：被依赖的模块排在前面，用于生成构建任务与 barrel 导出 */
function buildOrder(config: ProjectConfig): string[] {
    const byName = new Map(config.modules.map((mod) => [mod.name, mod]));
    const visited = new Set<string>();
    const order: string[] = [];
    const visit = (name: string): void => {
        if (visited.has(name)) return;
        const mod = byName.get(name);
        if (!mod) return;
        for (const depName of mod.deps) visit(depName);
        visited.add(name);
        order.push(name);
    };
    for (const mod of config.modules) visit(mod.name);
    return order;
}

function generateScaffold(config: ProjectConfig): Scaffold {
    const violations = validateConfig(config);
    if (violations.length > 0) {
        throw new Error(`脚手架配置非法:\n- ${violations.join('\n- ')}`);
    }

    const manifests: Manifest[] = config.modules
        .map((mod) => ({
            name: mod.name,
            layer: mod.layer,
            path: `src/${mod.layer}/${mod.name}`,
            targets: moduleTargets(mod.layer, config.targets),
            deps: [...mod.deps],
            external: [...(mod.external ?? [])],
        }))
        .sort((a, b) => {
            const diff = LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer);
            if (diff !== 0) return diff;
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });

    const directories = [...new Set(manifests.map((item) => item.path))].sort();
    const entryFiles = [...config.targets].sort().map((target) => `src/entries/${target}.ts`);

    return { directories, manifests, entryFiles };
}

/** 海外家居 DTC「Loom & Oak」：PC 商城 + H5 社交流量落地页 */
const loomAndOak: ProjectConfig = {
    name: 'loom-and-oak',
    targets: ['pc', 'h5'],
    modules: [
        { name: 'catalog', layer: 'core', deps: [] },
        { name: 'pricing', layer: 'core', deps: ['catalog'] },
        { name: 'api-client', layer: 'services', deps: ['catalog'] },
        { name: 'web-storage', layer: 'adapters', deps: ['api-client'] },
        { name: 'use-catalog', layer: 'composables', deps: ['api-client', 'pricing'] },
        { name: 'price-tag', layer: 'ui-shared', deps: ['pricing'] },
        { name: 'product-list', layer: 'ui-pc', deps: ['use-catalog', 'price-tag'] },
        { name: 'checkout-pc', layer: 'ui-pc', deps: ['api-client', 'price-tag'] },
        { name: 'feed', layer: 'ui-h5', deps: ['use-catalog', 'price-tag'] },
        { name: 'checkout-h5', layer: 'ui-h5', deps: ['api-client', 'price-tag'] },
    ],
};

function runAssertions() {
    // ---------- 测试 1：目录、清单与双端入口 ----------
    const scaffold = generateScaffold(loomAndOak);
    assert.equal(scaffold.directories.length, 10, '10 个模块应生成 10 个目录');
    assert.ok(scaffold.directories.includes('src/core/pricing'));
    assert.ok(scaffold.directories.includes('src/ui-shared/price-tag'));
    assert.ok(scaffold.directories.includes('src/ui-pc/product-list'));
    assert.ok(scaffold.directories.includes('src/ui-h5/feed'));
    assert.deepEqual(scaffold.entryFiles, ['src/entries/h5.ts', 'src/entries/pc.ts']);
    const productList = scaffold.manifests.find((item) => item.name === 'product-list');
    const feed = scaffold.manifests.find((item) => item.name === 'feed');
    const catalog = scaffold.manifests.find((item) => item.name === 'catalog');
    assert.deepEqual(productList?.targets, ['pc'], 'PC 组件不得进入 H5 产物');
    assert.deepEqual(feed?.targets, ['h5']);
    assert.deepEqual(catalog?.targets, ['h5', 'pc'], '共享层跟随双端构建');
    console.log('[1/4] 目录/清单/双端入口 OK, 模块数:', scaffold.manifests.length);

    // ---------- 测试 2：合法依赖图——零违规且拓扑有序 ----------
    assert.deepEqual(validateConfig(loomAndOak), []);
    const order = buildOrder(loomAndOak);
    const indexOf = (name: string) => order.indexOf(name);
    assert.ok(indexOf('catalog') < indexOf('pricing'));
    assert.ok(indexOf('pricing') < indexOf('product-list'));
    assert.ok(indexOf('api-client') < indexOf('use-catalog'));
    assert.ok(indexOf('use-catalog') < indexOf('product-list'));
    assert.ok(indexOf('price-tag') < indexOf('checkout-h5'));
    console.log('[2/4] 依赖拓扑 OK:', order.join(' → '));

    // ---------- 测试 3：越层/跨端/UI 库串端全部被识别 ----------
    const illegal: ProjectConfig = {
        name: 'broken',
        targets: ['pc', 'h5'],
        modules: [
            { name: 'catalog', layer: 'core', deps: [], external: ['vue'] },
            { name: 'pricing', layer: 'core', deps: ['web-storage'] },
            { name: 'web-storage', layer: 'adapters', deps: [] },
            { name: 'feed', layer: 'ui-h5', deps: [] },
            { name: 'product-card', layer: 'ui-pc', deps: ['feed'] },
            { name: 'badge', layer: 'ui-shared', deps: [], external: ['element-plus'] },
            { name: 'checkout', layer: 'ui-h5', deps: [], external: ['element-plus'] },
        ],
    };
    const violations = validateConfig(illegal);
    assert.equal(violations.length, 5, `应恰好识别 5 处违规，实际 ${violations.length}`);
    assert.ok(violations.some((item) => item.includes('catalog(core)') && item.includes('vue')));
    assert.ok(violations.some((item) => item.includes('core') && item.includes('adapters')), 'core 反向依赖 adapters');
    assert.ok(violations.some((item) => item.includes('product-card(ui-pc)') && item.includes('feed(ui-h5)')), 'PC 跨端引用 H5');
    assert.ok(violations.some((item) => item.includes('badge(ui-shared)') && item.includes('element-plus')));
    assert.ok(violations.some((item) => item.includes('checkout(ui-h5)') && item.includes('element-plus')));
    assert.throws(() => generateScaffold(illegal), /脚手架配置非法/, '有违规时禁止生成目录');
    console.log('[3/4] 边界违规识别 OK, 违规数:', violations.length);

    // ---------- 测试 4：非法配置在生成前阻断 ----------
    const duplicate: ProjectConfig = {
        name: 'dup',
        targets: ['pc'],
        modules: [
            { name: 'cart', layer: 'core', deps: [] },
            { name: 'cart', layer: 'services', deps: [] },
        ],
    };
    assert.throws(() => generateScaffold(duplicate), /模块名重复: cart/);

    const cyclic: ProjectConfig = {
        name: 'cycle',
        targets: ['pc'],
        modules: [
            { name: 'order', layer: 'core', deps: ['cart'] },
            { name: 'cart', layer: 'core', deps: ['order'] },
        ],
    };
    assert.throws(() => generateScaffold(cyclic), /依赖环/);

    const wrongTarget: ProjectConfig = {
        name: 'wrong-target',
        targets: ['h5'],
        modules: [
            { name: 'checkout', layer: 'ui-pc', deps: [] },
            { name: 'feed', layer: 'ui-h5', deps: [] },
        ],
    };
    assert.throws(() => generateScaffold(wrongTarget), /目标缺少对应 UI 层: checkout\(ui-pc\)/);

    const badName: ProjectConfig = {
        name: 'bad-name',
        targets: ['pc'],
        modules: [{ name: 'Price_Table', layer: 'ui-pc', deps: [] }],
    };
    assert.throws(() => generateScaffold(badName), /模块名不合法/);
    console.log('[4/4] 非法配置阻断 OK: 重复/环/目标缺失/命名');

    console.log('\n✅ 119-01 项目脚手架生成器 全部断言通过');
}

runAssertions();
