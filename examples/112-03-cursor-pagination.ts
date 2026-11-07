// 文件: examples/112-03-cursor-pagination.ts
// 游标分页：cursor 排序合并、按实体 id 去重、hasNextPage 推进与非法分页参数拦截
// 目标：乱序页/重叠页合并后顺序稳定无重复，cursor 与 first 的边界在发请求前就被校验

import assert from 'node:assert';

interface FeedNode {
    id: string;
    createdAt: number;
    title: string;
}

interface Edge<T> {
    cursor: string;
    node: T;
}

interface PageInfo {
    endCursor: string | null;
    hasNextPage: boolean;
}

interface Connection<T> {
    edges: Array<Edge<T>>;
    pageInfo: PageInfo;
}

const CURSOR_RE = /^t\d{13}$/;
const MAX_PAGE_SIZE = 50;

/** cursor 编码：按 createdAt 毫秒时间戳左补零，字典序 == 时间序 */
function cursorOf(createdAt: number): string {
    return `t${String(createdAt).padStart(13, '0')}`;
}

function assertCursor(cursor: string | null): void {
    if (cursor === null) return;
    if (!CURSOR_RE.test(cursor)) throw new Error(`非法 cursor: ${cursor}`);
}

function makeConnection(posts: FeedNode[], hasNextPage: boolean): Connection<FeedNode> {
    const edges = posts.map((post) => ({ cursor: cursorOf(post.createdAt), node: post }));
    const last = edges[edges.length - 1];
    return { edges, pageInfo: { endCursor: last ? last.cursor : null, hasNextPage } };
}

function buildPageRequest(cursor: string | null, first: number): { query: string; variables: { after: string | null; first: number } } {
    if (!Number.isInteger(first) || first < 1 || first > MAX_PAGE_SIZE) {
        throw new Error(`first 必须是 1..${MAX_PAGE_SIZE} 的整数，实际 ${first}`);
    }
    assertCursor(cursor);
    const query = [
        'query ProductFeed($after: String, $first: Int!) {',
        '    products(after: $after, first: $first) {',
        '        edges { cursor node { id title } }',
        '        pageInfo { endCursor hasNextPage }',
        '    }',
        '}',
    ].join('\n');
    return { query, variables: { after: cursor, first } };
}

class CursorPager<T extends { id: string }> {
    edges: Array<Edge<T>> = [];
    hasNextPage = false;
    endCursor: string | null = null;

    /** 合并一页：先校验 cursor，再按 cursor 排序、按 node.id 去重 */
    merge(connection: Connection<T>): void {
        for (const edge of connection.edges) assertCursor(edge.cursor);

        const byId = new Map<string, Edge<T>>();
        for (const edge of [...this.edges, ...connection.edges]) {
            if (!byId.has(edge.node.id)) byId.set(edge.node.id, edge);
        }
        this.edges = [...byId.values()].sort((a, b) => a.cursor.localeCompare(b.cursor));

        const last = this.edges[this.edges.length - 1];
        this.endCursor = last ? last.cursor : null;
        // hasNextPage 只认最新一次响应，避免旧页的 true 把已到底的状态顶回去
        this.hasNextPage = connection.pageInfo.hasNextPage;
    }

    reset(): void {
        this.edges = [];
        this.hasNextPage = false;
        this.endCursor = null;
    }
}

function post(id: string, createdAt: number, title: string): FeedNode {
    return { id, createdAt, title };
}

function runAssertions() {
    // ---------- 测试 1：首页合并——顺序、endCursor、hasNextPage ----------
    const pager = new CursorPager<FeedNode>();
    pager.merge(makeConnection([post('p1', 1000, 'A'), post('p2', 2000, 'B'), post('p3', 3000, 'C')], true));
    assert.deepEqual(pager.edges.map((edge) => edge.node.id), ['p1', 'p2', 'p3']);
    assert.equal(pager.endCursor, cursorOf(3000));
    assert.equal(pager.hasNextPage, true);
    console.log('[1/4] 首页合并 OK, endCursor:', pager.endCursor);

    // ---------- 测试 2：下一页重叠——按 id 去重，hasNextPage 收敛为 false ----------
    pager.merge(makeConnection([post('p3', 3000, 'C'), post('p4', 4000, 'D'), post('p5', 5000, 'E')], false));
    assert.deepEqual(pager.edges.map((edge) => edge.node.id), ['p1', 'p2', 'p3', 'p4', 'p5'], '重叠节点不得重复');
    assert.equal(pager.edges.length, 5);
    assert.equal(pager.hasNextPage, false);
    assert.equal(pager.endCursor, cursorOf(5000));
    console.log('[2/4] 重叠页去重 OK, 总条数:', pager.edges.length);

    // ---------- 测试 3：乱序插入——页内乱序 + 中间插入，合并后仍按时间有序 ----------
    const pager2 = new CursorPager<FeedNode>();
    pager2.merge(makeConnection([post('n1', 1000, 'A'), post('n3', 3000, 'C')], true));
    pager2.merge(makeConnection([post('n5', 5000, 'E'), post('n2', 1500, 'B'), post('n4', 4000, 'D')], false));
    assert.deepEqual(pager2.edges.map((edge) => edge.node.id), ['n1', 'n2', 'n3', 'n4', 'n5'], '中间插入的节点应落到正确位置');
    assert.equal(pager2.endCursor, cursorOf(5000));
    assert.equal(new Set(pager2.edges.map((edge) => edge.node.id)).size, pager2.edges.length, '合并后不得有重复 id');
    console.log('[3/4] 乱序插入 OK, 顺序:', pager2.edges.map((edge) => edge.node.id).join(' → '));

    // ---------- 测试 4：分页参数守卫 + reset ----------
    const request = buildPageRequest(null, 10);
    assert.deepEqual(request.variables, { after: null, first: 10 });
    assert.match(request.query, /after: \$after, first: \$first/);

    const validCursor = buildPageRequest(cursorOf(2000), 3);
    assert.equal(validCursor.variables.after, cursorOf(2000));

    assert.throws(() => buildPageRequest(null, 0), /1..50 的整数/);
    assert.throws(() => buildPageRequest(null, 51), /1..50 的整数/);
    assert.throws(() => buildPageRequest(null, 1.5), /1..50 的整数/);
    assert.throws(() => buildPageRequest('abc', 10), /非法 cursor/);

    pager.reset();
    assert.deepEqual(pager.edges, []);
    assert.equal(pager.hasNextPage, false);
    assert.equal(pager.endCursor, null);
    console.log('[4/4] 分页参数守卫与 reset OK');

    console.log('\n✅ 112-03 游标分页 全部断言通过');
}

runAssertions();
