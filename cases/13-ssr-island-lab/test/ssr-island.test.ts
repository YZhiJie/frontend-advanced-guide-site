// 文件: cases/13-ssr-island-lab/test/ssr-island.test.ts
// ============ SSR 渲染（转义 / 岛屿占位）与 hydration 行为回归 ============

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    collectIslands,
    createRenderContext,
    escapeHtml,
    h,
    renderPage,
    renderToString,
} from '../src/vnode.js'
import type { IslandDescriptor } from '../src/vnode.js'
import { hydrateIslands } from '../src/hydrate.js'
import type { IslandHost, IslandRegistry } from '../src/hydrate.js'

/** 构造「页面占位节点表」，模拟服务端 HTML 里存在的 data-island-id 节点 */
function createHosts(ids: readonly string[]): Map<string, IslandHost> {
    const hosts = new Map<string, IslandHost>()
    for (const id of ids) hosts.set(id, { id })
    return hosts
}

/** 由占位节点表派生的查找函数 */
function resolver(hosts: Map<string, IslandHost>) {
    return (id: string): IslandHost | null => hosts.get(id) ?? null
}

// ---------------- 转义与基础渲染 ----------------

test('escapeHtml 转义 & < > " \' 五类字符', () => {
    assert.equal(escapeHtml('& < > " \''), '&amp; &lt; &gt; &quot; &#39;')
})

test('renderToString 渲染嵌套元素与属性', () => {
    const html = renderToString(
        h('section', { class: 'page' }, h('h1', { id: 'title' }, '你好'), h('p', null, '世界')),
    )
    assert.equal(html, '<section class="page"><h1 id="title">你好</h1><p>世界</p></section>')
})

test('布尔属性与空值属性处理正确', () => {
    const html = renderToString(h('input', { disabled: true, hidden: false, value: null }))
    assert.equal(html, '<input disabled></input>')
})

test('文本含 <script> 与引号时被转义（XSS 安全）', () => {
    const evil = '<script>alert("xss")</script>'
    assert.equal(escapeHtml(evil), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    const html = renderToString(h('p', null, evil))
    assert.equal(html, '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>')
    assert.ok(!html.includes('<script>'))
})

test('属性值里的引号与 & 被转义，无法逃逸出属性边界', () => {
    const html = renderToString(h('a', { title: '"quoted"', href: 'x?a=1&b=2' }, '链接'))
    assert.equal(html, '<a title="&quot;quoted&quot;" href="x?a=1&amp;b=2">链接</a>')
})

// ---------------- 岛屿占位与清单收集 ----------------

test('island: true 的子树被降级为 data-island-id 占位节点', () => {
    const page = renderPage(
        h('div', null, h('Counter', { island: true, initial: 0 }, h('span', null, '占位'))),
    )
    // 岛屿子树被忽略，只留一个占位 div
    assert.equal(page.html, '<div><div data-island-id="island-0"></div></div>')
})

test('多个岛屿按遍历顺序获得稳定自动编号', () => {
    const page = renderPage(h('main', null, h('A', { island: true }), h('B', { island: true })))
    assert.equal(page.html, '<main><div data-island-id="island-0"></div><div data-island-id="island-1"></div></main>')
    assert.deepEqual(
        page.islands.map((it) => it.id),
        ['island-0', 'island-1'],
    )
})

test('islandId 可显式覆盖自动编号', () => {
    const page = renderPage(h('Counter', { island: true, islandId: 'hero', initial: 1 }))
    assert.equal(page.html, '<div data-island-id="hero"></div>')
    assert.equal(page.islands[0]?.id, 'hero')
})

test('岛屿清单收集 name 与剔除标记字段后的 props', () => {
    const page = renderPage(h('div', null, h('Counter', { island: true, islandId: 'c1', initial: 42, label: '计数' })))
    assert.deepEqual(page.islands, [
        { id: 'c1', name: 'Counter', props: { initial: 42, label: '计数' } },
    ])
})

test('非岛屿节点不会进入岛屿清单', () => {
    const page = renderPage(h('div', null, h('h1', null, '标题'), h('p', null, '正文')))
    assert.equal(page.islands.length, 0)
    assert.equal(page.html, '<div><h1>标题</h1><p>正文</p></div>')
})

test('collectIslands 与 renderPage 产出同一份清单', () => {
    const tree = h('div', null, h('A', { island: true, x: 1 }), h('B', { island: true, islandId: 'b' }))
    assert.deepEqual(collectIslands(tree), renderPage(tree).islands)
})

test('完整页面快照：转义 + 岛屿占位 + 清单', () => {
    const page = renderPage(
        h(
            'section',
            { class: 'page' },
            h('h1', { id: 'title' }, '5 < 6 & 7 > 2'),
            h('p', null, '他说："你好"，\'再见\''),
            h('Counter', { island: true, initial: 42 }),
            h('Footer', { island: true, islandId: 'foot' }),
        ),
    )
    assert.equal(
        page.html,
        '<section class="page"><h1 id="title">5 &lt; 6 &amp; 7 &gt; 2</h1>' +
            '<p>他说：&quot;你好&quot;，&#39;再见&#39;</p>' +
            '<div data-island-id="island-0"></div>' +
            '<div data-island-id="foot"></div></section>',
    )
    assert.deepEqual(page.islands, [
        { id: 'island-0', name: 'Counter', props: { initial: 42 } },
        { id: 'foot', name: 'Footer', props: {} },
    ])
})

test('renderToString 不传 ctx 时不抛错（清单被丢弃）', () => {
    const html = renderToString(h('div', null, h('Counter', { island: true })))
    assert.equal(html, '<div><div data-island-id="island-0"></div></div>')
})

test('createRenderContext 的编号在多次渲染间互不影响', () => {
    const ctx = createRenderContext()
    assert.equal(ctx.nextId(), 'island-0')
    assert.equal(ctx.nextId(), 'island-1')
    // 新上下文重新从 island-0 开始，保证渲染确定性
    assert.equal(createRenderContext().nextId(), 'island-0')
})

// ---------------- hydration 行为 ----------------

test('hydrate 只挂载被标记为岛屿的节点', () => {
    const page = renderPage(
        h('div', null, h('h1', null, '标题'), h('Counter', { island: true, initial: 1 })),
    )
    const hosts = createHosts(['island-0'])
    const calls: Array<{ props: Record<string, unknown>; el: IslandHost }> = []
    const registry: IslandRegistry = {
        Counter: (props, el) => {
            calls.push({ props, el })
        },
    }

    const report = hydrateIslands(page.islands, registry, resolver(hosts))

    assert.deepEqual(report, { mounted: ['island-0'], skipped: [] })
    // 非岛屿的 h1 没有对应描述，因此只挂载了一次
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.el.id, 'island-0')
})

test('props 原样透传给 mount（同一引用）', () => {
    const page = renderPage(h('div', null, h('Counter', { island: true, initial: 7 })))
    const hosts = createHosts(['island-0'])
    let received: Record<string, unknown> | undefined
    const registry: IslandRegistry = {
        Counter: (props) => {
            received = props
        },
    }

    hydrateIslands(page.islands, registry, resolver(hosts))

    assert.equal(received, page.islands[0]?.props)
    assert.deepEqual(received, { initial: 7 })
})

test('未注册的岛屿默认被跳过', () => {
    const page = renderPage(h('div', null, h('Counter', { island: true })))
    const registry: IslandRegistry = {
        Other: () => {},
    }
    const report = hydrateIslands(page.islands, registry, resolver(createHosts(['island-0'])))
    assert.deepEqual(report, { mounted: [], skipped: ['island-0'] })
})

test('requireAll 时未注册的岛屿直接报错', () => {
    const page = renderPage(h('div', null, h('Counter', { island: true })))
    const registry: IslandRegistry = {
        Other: () => {},
    }
    assert.throws(
        () => hydrateIslands(page.islands, registry, resolver(createHosts(['island-0'])), { requireAll: true }),
        /未注册的岛屿组件：Counter/,
    )
})

test('占位节点缺失时跳过该岛屿', () => {
    const page = renderPage(h('div', null, h('Counter', { island: true })))
    const ran: string[] = []
    const registry: IslandRegistry = {
        Counter: () => {
            ran.push('counter')
        },
    }
    const report = hydrateIslands(page.islands, registry, () => null)
    assert.deepEqual(report, { mounted: [], skipped: ['island-0'] })
    assert.equal(ran.length, 0)
})

test('多个岛屿按清单顺序挂载', () => {
    const page = renderPage(
        h('main', null, h('A', { island: true }), h('B', { island: true }), h('C', { island: true })),
    )
    const completed: string[] = []
    const registry: IslandRegistry = {
        A: (_props, el) => completed.push(`A@${el.id}`),
        B: (_props, el) => completed.push(`B@${el.id}`),
        C: (_props, el) => completed.push(`C@${el.id}`),
    }
    const hosts = createHosts(['island-0', 'island-1', 'island-2'])

    const report = hydrateIslands(page.islands, registry, resolver(hosts))

    assert.deepEqual(report.mounted, ['island-0', 'island-1', 'island-2'])
    assert.deepEqual(completed, ['A@island-0', 'B@island-1', 'C@island-2'])
    assert.equal(page.islands.length, 3)
    // 类型引用被使用，避免「未使用 import」告警
    const _type: IslandDescriptor | undefined = page.islands[0]
    void _type
})
