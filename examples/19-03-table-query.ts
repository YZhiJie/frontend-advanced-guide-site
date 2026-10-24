// 文件: examples/19-03-table-query.ts
// ============ 列表查询状态:默认值合并 + URL query 双向同步 + 分页推导 ============
// 中后台列表页 90% 的 bug 来自三处:刷新丢筛选、分享链接打不开同一页、page 越界。
// 这里用"单一查询对象 + URL 为唯一外部来源"一次性解决。

/** 列表查询参数(各业务页用 interface 扩展 Filters) */
export interface ListQuery {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sort?: string; // 形如 '-createdAt'(负号=倒序)
    [key: string]: string | number | undefined;
}

export type QueryDefaults = Pick<ListQuery, 'page' | 'pageSize'> & Partial<ListQuery>;

/** 白名单:只允许这些 key 进出 URL,防止链接里被塞脏参数 */
const ALLOWED_KEYS = ['page', 'pageSize', 'keyword', 'status', 'sort'] as const;

// ---------------- 默认值合并 + 合法化 ----------------

/**
 * 把任意来源(URL/组件初始值)的原始参数与默认值合并并合法化:
 * page/pageSize 强制为正整数,空串/undefined 一律回退默认值。
 */
export function normalizeQuery(raw: Record<string, unknown>, defaults: QueryDefaults): ListQuery {
    const toPositiveInt = (v: unknown, fallback: number): number => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : fallback;
    };
    const clean = (v: unknown): string | undefined => {
        const s = String(v ?? '').trim();
        return s === '' ? undefined : s;
    };

    const query: ListQuery = {
        ...defaults,
        page: toPositiveInt(raw.page, defaults.page),
        pageSize: toPositiveInt(raw.pageSize, defaults.pageSize),
    };
    for (const key of ['keyword', 'status', 'sort']) {
        const v = clean(raw[key]);
        if (v !== undefined) query[key] = v;
    }
    return query;
}

// ---------------- 与 URL 查询串双向同步 ----------------

/** 查询对象 -> URLSearchParams(值为 undefined 的字段不出现在 URL 里,链接干净) */
export function toSearchParams(query: ListQuery): URLSearchParams {
    const params = new URLSearchParams();
    for (const key of ALLOWED_KEYS) {
        const v = query[key];
        if (v !== undefined && v !== '') params.set(key, String(v));
    }
    return params;
}

/** URL 查询串 -> 查询对象(刷新、分享链接、浏览器前进后退都走这个入口) */
export function fromSearchParams(
    search: string | URLSearchParams,
    defaults: QueryDefaults,
): ListQuery {
    const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
    const raw: Record<string, unknown> = {};
    for (const key of ALLOWED_KEYS) {
        if (params.has(key)) raw[key] = params.get(key);
    }
    return normalizeQuery(raw, defaults);
}

// ---------------- 分页推导 ----------------

export interface PageInfo {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    /** SQL/ORM 常用的偏移量:offset = (page-1)*pageSize */
    offset: number;
    hasPrev: boolean;
    hasNext: boolean;
}

/** 由总数与当前页推导分页条所需的全部信息 */
export function resolvePageInfo(total: number, query: ListQuery): PageInfo {
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    // ⚠️ 关键兜底:删光最后一页的数据后当前页会越界,夹回合法区间
    const page = Math.min(Math.max(1, query.page), totalPages);
    return {
        total,
        page,
        pageSize: query.pageSize,
        totalPages,
        offset: (page - 1) * query.pageSize,
        hasPrev: page > 1,
        hasNext: page < totalPages,
    };
}

// ---------------- 验证 ----------------

const defaults: QueryDefaults = { page: 1, pageSize: 20, status: 'all' };

// ---- 脏参数合法化:负页数、空 keyword、非数字 pageSize 全部回退 ----
console.log(normalizeQuery({ page: '-3', pageSize: 'abc', keyword: '  ', status: 'paid' }, defaults));
// { page: 1, pageSize: 20, status: 'paid' }

// ---- URL 往返:对象 -> 链接 -> 对象,结果一致 ----
const query = normalizeQuery({ page: 3, pageSize: 50, keyword: '发票', status: 'paid' }, defaults);
const search = '?' + toSearchParams(query).toString();
console.log(search); // ?page=3&pageSize=50&keyword=%E5%8F%91%E7%A5%A8&status=paid
console.log(fromSearchParams(search, defaults)); // 与 query 相同

// ---- 分页推导:total=55,pageSize=20 -> 共 3 页,第 3 页 offset=40 ----
console.log(resolvePageInfo(55, { page: 3, pageSize: 20 }));
// { total: 55, page: 3, pageSize: 20, totalPages: 3, offset: 40, hasPrev: true, hasNext: false }

// ---- 越界兜底:数据只剩 5 条却停在第 9 页,自动夹回第 1 页 ----
console.log(resolvePageInfo(5, { page: 9, pageSize: 20 }).page); // 1
