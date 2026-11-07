// 文件: examples/120-02-component-registry-render.ts
// 组件注册表渲染：物料注册 + 递归渲染 + 未知组件降级占位 + 单组件异常隔离
// 目标：一份 Schema 能被注册表渲染成 HTML，缺物料/抛异常都不拖垮整页

import assert from 'node:assert';

type Json = unknown;

interface PageNode {
    id: string;
    type: string;
    props: Record<string, Json>;
    children?: PageNode[];
}

interface RenderContext {
    /** 递归入口：渲染当前节点的子节点，容器组件不需要自己拼递归 */
    renderChildren(): string;
    warn(message: string): void;
}

/** 物料渲染器：只关心自己的 props 与子节点，不感知整页 */
type MaterialRenderer = (props: Record<string, Json>, ctx: RenderContext) => string;

const escapeHtml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class ComponentRegistry {
    private readonly renderers = new Map<string, MaterialRenderer>();
    readonly warnings: string[] = [];

    /** 注册物料；重复注册直接抛错，避免后注册者静默覆盖前注册者 */
    register(type: string, renderer: MaterialRenderer): void {
        if (this.renderers.has(type)) throw new Error(`物料重复注册: ${type}`);
        this.renderers.set(type, renderer);
    }

    has(type: string): boolean {
        return this.renderers.has(type);
    }

    get size(): number {
        return this.renderers.size;
    }

    render(node: PageNode): string {
        const renderer = this.renderers.get(node.type);
        const ctx: RenderContext = {
            renderChildren: () => (node.children ?? []).map((child) => this.render(child)).join(''),
            warn: (message) => this.warnings.push(message),
        };
        if (!renderer) {
            // 未知组件降级：输出带标识的占位，页面其余部分照常渲染
            this.warnings.push(`未注册物料 ${node.type} @ ${node.id}`);
            return `<div class="placeholder" data-type="${escapeHtml(node.type)}" data-id="${escapeHtml(node.id)}">组件暂不可用</div>`;
        }
        try {
            return renderer(node.props, ctx);
        } catch (error) {
            // 单个物料抛异常只损失一个区块，不能让整页白屏
            this.warnings.push(`物料 ${node.type} 渲染失败: ${(error as Error).message}`);
            return `<div class="placeholder" data-type="${escapeHtml(node.type)}" data-id="${escapeHtml(node.id)}" data-error="1">组件渲染失败</div>`;
        }
    }
}

/** 物料库：真实项目里按需 import，这里手写最小实现 */
function createRegistry(): ComponentRegistry {
    const registry = new ComponentRegistry();
    registry.register('page', (_props, ctx) => `<main class="page">${ctx.renderChildren()}</main>`);
    registry.register('grid', (_props, ctx) => `<section class="grid">${ctx.renderChildren()}</section>`);
    registry.register('banner', (props) => {
        const image = escapeHtml(String(props.image ?? ''));
        const link = escapeHtml(String(props.link ?? '#'));
        return `<a class="banner" href="${link}"><img src="${image}" alt="${escapeHtml(String(props.alt ?? ''))}"></a>`;
    });
    registry.register('text', (props) => `<p class="text" style="font-size:${Number(props.size ?? 14)}px">${escapeHtml(String(props.content ?? ''))}</p>`);
    registry.register('button', (props) => `<button class="btn" data-action="${escapeHtml(String(props.action ?? ''))}">${escapeHtml(String(props.label ?? ''))}</button>`);
    return registry;
}

function node(id: string, type: string, props: Record<string, Json> = {}, children: PageNode[] = []): PageNode {
    return { id, type, props, children };
}

function runAssertions() {
    const registry = createRegistry();

    // ---------- 测试 1：物料注册与基础渲染 ----------
    assert.equal(registry.size, 5);
    assert.ok(registry.has('banner') && !registry.has('carousel'), '只渲染已注册物料');
    assert.throws(() => registry.register('banner', () => ''), /重复注册/, '重复注册必须报错');
    const single = registry.render(node('b1', 'banner', { image: 'bf.jpg', link: '/bf', alt: 'Black Friday' }));
    assert.ok(single.includes('src="bf.jpg"') && single.includes('href="/bf"'), '属性应被渲染');
    console.log('[1/4] 物料注册 OK, 已注册:', registry.size);

    // ---------- 测试 2：递归渲染，嵌套结构完整 ----------
    const page = node('root', 'page', {}, [
        node('g1', 'grid', {}, [
            node('b1', 'banner', { image: 'a.jpg', link: '/a' }),
            node('b2', 'banner', { image: 'b.jpg', link: '/b' }),
        ]),
        node('t1', 'text', { content: 'Up to 70% off', size: 28 }),
        node('c1', 'button', { label: 'Shop now', action: 'open:/category' }),
    ]);
    const html = registry.render(page);
    assert.ok(html.startsWith('<main class="page">') && html.endsWith('</main>'), '根容器应包裹整页');
    assert.equal((html.match(/class="banner"/g) ?? []).length, 2, '两个 banner 都应渲染');
    assert.ok(html.includes('font-size:28px'), '数字属性应生效');
    assert.ok(html.includes('data-action="open:/category"'), '按钮动作应渲染');
    console.log('[2/4] 递归渲染 OK, 长度:', html.length);

    // ---------- 测试 3：未知组件降级为占位，不中断兄弟节点 ----------
    const withUnknown = node('root', 'page', {}, [
        node('x1', 'countdown', { endAt: '2026-11-30' }),
        node('t1', 'text', { content: 'Still alive' }),
    ]);
    const unknownHtml = registry.render(withUnknown);
    assert.ok(unknownHtml.includes('data-type="countdown"'), '占位须标明缺失物料');
    assert.ok(unknownHtml.includes('Still alive'), '未知组件不得影响后续渲染');
    assert.equal(registry.warnings.length, 1, '应记录一条降级告警');
    assert.ok(registry.warnings[0].includes('countdown'));
    console.log('[3/4] 未知组件降级 OK, 告警:', registry.warnings[0]);

    // ---------- 测试 4：单个物料抛异常，整页仍可渲染 ----------
    const brokenRegistry = createRegistry();
    brokenRegistry.register('lottery', () => {
        throw new Error('prize pool empty');
    });
    const risky = node('root', 'page', {}, [
        node('l1', 'lottery', { poolId: 'p1' }),
        node('g1', 'grid', {}, [node('b1', 'banner', { image: 'ok.jpg' })]),
    ]);
    const riskyHtml = brokenRegistry.render(risky);
    assert.ok(riskyHtml.includes('data-error="1"'), '异常物料须输出错误占位');
    assert.ok(riskyHtml.includes('src="ok.jpg"'), '其余物料必须存活');
    assert.ok(brokenRegistry.warnings.some((w) => w.includes('prize pool empty')), '异常需可观测');
    console.log('[4/4] 异常隔离 OK, 占位与正常物料共存');

    console.log('\n✅ 120-02 组件注册表渲染 全部断言通过');
}

runAssertions();
