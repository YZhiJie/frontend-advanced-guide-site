// 文件: examples/124-03-facet-filter.ts
// 筛选与 URL 同步：多选/范围/时间筛选模型，与 URL query 双向序列化，可分享可回退，非法参数兜底
// 目标：默认态不污染 URL；序列化幂等可分享；解析遇非法值回默认而不是抛错；改筛选必回第一页

import assert from 'node:assert';

const DOC_TYPES = ['doc', 'wiki', 'qa', 'code'] as const;
type DocType = (typeof DOC_TYPES)[number];

const WITHIN_OPTIONS = ['7d', '30d', '365d', 'any'] as const;
type Within = (typeof WITHIN_OPTIONS)[number];

const SORT_OPTIONS = ['relevance', 'newest', 'views'] as const;
type SortBy = (typeof SORT_OPTIONS)[number];

interface FilterState {
    /** 多选类型；序列化前排序，保证同一状态永远产出同一串 */
    types: DocType[];
    /** 时间范围 */
    within: Within;
    /** 文档大小区间（KB），null 表示该端不限 */
    sizeKb: [number | null, number | null];
    sort: SortBy;
    /** 页码从 1 开始 */
    page: number;
}

const DEFAULT_FILTER: FilterState = {
    types: [],
    within: 'any',
    sizeKb: [null, null],
    sort: 'relevance',
    page: 1,
};

/**
 * 序列化只写非默认字段：URL 干净，且默认值将来调整时老链接语义自动跟随。
 * 手工拼接而不用 URLSearchParams，是为了让 types=doc,wiki 保持可读。
 */
function serializeFilters(state: FilterState): string {
    const parts: string[] = [];
    if (state.types.length > 0) {
        parts.push(`types=${[...state.types].sort().join(',')}`);
    }
    if (state.within !== DEFAULT_FILTER.within) {
        parts.push(`within=${state.within}`);
    }
    const [min, max] = state.sizeKb;
    if (min !== null || max !== null) {
        parts.push(`size=${min ?? ''}-${max ?? ''}`);
    }
    if (state.sort !== DEFAULT_FILTER.sort) {
        parts.push(`sort=${state.sort}`);
    }
    if (state.page !== DEFAULT_FILTER.page) {
        parts.push(`page=${state.page}`);
    }
    return parts.join('&');
}

function parsePositiveInt(raw: string | null): number | null {
    if (raw === null || raw.trim() === '') return null;
    if (!/^\d+$/.test(raw)) return null;
    return Number.parseInt(raw, 10);
}

/**
 * 解析即校验：非法值回默认，绝不把脏数据放进模型。
 * URL 是用户可直接编辑的输入，可信度等于表单输入。
 */
function parseFilters(search: string): FilterState {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const state: FilterState = {
        types: [],
        within: DEFAULT_FILTER.within,
        sizeKb: [null, null],
        sort: DEFAULT_FILTER.sort,
        page: DEFAULT_FILTER.page,
    };

    const typesRaw = params.get('types');
    if (typesRaw !== null) {
        const wanted = typesRaw
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
        // 去重 + 枚举白名单：'hacker' 这类未知类型静默丢弃
        state.types = [...new Set(wanted)].filter((item): item is DocType =>
            (DOC_TYPES as readonly string[]).includes(item),
        );
    }

    const withinRaw = params.get('within');
    if (withinRaw !== null && (WITHIN_OPTIONS as readonly string[]).includes(withinRaw)) {
        state.within = withinRaw as Within;
    }

    const sizeRaw = params.get('size');
    if (sizeRaw !== null) {
        const match = sizeRaw.match(/^(\d*)-(\d*)$/);
        if (match !== null && (match[1] !== '' || match[2] !== '')) {
            let min = match[1] === '' ? null : Number.parseInt(match[1], 10);
            let max = match[2] === '' ? null : Number.parseInt(match[2], 10);
            // 兜底：下限大于上限则交换，不抛弃用户的过滤意图
            if (min !== null && max !== null && min > max) [min, max] = [max, min];
            state.sizeKb = [min, max];
        }
    }

    const sortRaw = params.get('sort');
    if (sortRaw !== null && (SORT_OPTIONS as readonly string[]).includes(sortRaw)) {
        state.sort = sortRaw as SortBy;
    }

    const page = parsePositiveInt(params.get('page'));
    state.page = page !== null && page >= 1 ? page : DEFAULT_FILTER.page;
    return state;
}

type FilterPatch = Partial<FilterState>;

/**
 * 应用筛选变更：除「只翻页」外，任何条件变化都把 page 重置回 1——
 * 「改完筛选还停在第 8 页直接零结果」是筛选器最经典的 bug。
 */
function applyPatch(state: FilterState, patch: FilterPatch): FilterState {
    const next: FilterState = {
        ...state,
        ...patch,
        types: patch.types !== undefined ? [...patch.types] : [...state.types],
        sizeKb: patch.sizeKb !== undefined ? [patch.sizeKb[0], patch.sizeKb[1]] : [...state.sizeKb],
    };
    const onlyPage = Object.keys(patch).every((key) => key === 'page');
    if (!onlyPage) next.page = patch.page ?? DEFAULT_FILTER.page;
    return next;
}

async function runAssertions(): Promise<void> {
    // ---------- 测试 1：默认态与最小序列化——默认值不进 URL ----------
    assert.equal(serializeFilters(DEFAULT_FILTER), '', '默认态不得污染 URL');

    const minimal = applyPatch(DEFAULT_FILTER, { types: ['wiki', 'doc'] });
    assert.equal(serializeFilters(minimal), 'types=doc,wiki', '只写非默认字段且类型排序');

    const openRanges: FilterState = { ...DEFAULT_FILTER, sizeKb: [null, 500] };
    assert.equal(serializeFilters(openRanges), 'size=-500', '开放上界');
    assert.equal(serializeFilters({ ...DEFAULT_FILTER, sizeKb: [100, null] }), 'size=100-', '开放下界');
    console.log('[1/4] 最小序列化 OK, 默认态 URL 为空串');

    // ---------- 测试 2：双向序列化——同一状态 round-trip 恒等，可分享 ----------
    const shareable: FilterState = {
        types: ['code', 'doc'],
        within: '30d',
        sizeKb: [100, 500],
        sort: 'newest',
        page: 3,
    };
    const roundTrip = parseFilters(serializeFilters(shareable));
    assert.deepEqual(roundTrip, shareable, 'parse(serialize(state)) 必须恒等');
    assert.equal(serializeFilters(roundTrip), serializeFilters(shareable), '同一状态两次输出同一串');

    const fromLocation = parseFilters('?types=wiki&within=7d&page=2');
    assert.deepEqual(fromLocation, {
        types: ['wiki'],
        within: '7d',
        sizeKb: [null, null],
        sort: 'relevance',
        page: 2,
    });
    console.log('[2/4] 双向序列化 OK, round-trip 恒等可分享');

    // ---------- 测试 3：非法参数兜底——脏 URL 静默回默认，不抛错 ----------
    const dirty = parseFilters('types=doc,hacker,wiki,wiki&page=-5&within=forever&size=abc-def&sort=magic&utm_source=x');
    assert.deepEqual(dirty.types, ['doc', 'wiki'], '未知类型丢弃、重复去重');
    assert.equal(dirty.page, 1, '负页码回第 1 页');
    assert.equal(dirty.within, 'any', '非法时间范围回默认');
    assert.deepEqual(dirty.sizeKb, [null, null], '畸形范围整体丢弃');
    assert.equal(dirty.sort, 'relevance', '非法排序回默认');

    assert.deepEqual(parseFilters('size=900-100').sizeKb, [100, 900], '颠倒区间交换而不是丢弃');
    assert.equal(parseFilters('page=0').page, 1, '页码下界钳到 1');
    assert.deepEqual(parseFilters('size=-').sizeKb, [null, null], '两端皆空等于无筛选');
    console.log('[3/4] 非法参数兜底 OK, 脏 URL 全部安全落回默认');

    // ---------- 测试 4：applyPatch 语义——改筛选重置页码，纯翻页不重置 ----------
    const onPage8: FilterState = { ...DEFAULT_FILTER, types: ['doc'], page: 8 };

    const narrowed = applyPatch(onPage8, { within: '7d' });
    assert.equal(narrowed.page, 1, '改筛选条件必须回第 1 页');
    assert.equal(narrowed.within, '7d');

    const paged = applyPatch(onPage8, { page: 4 });
    assert.equal(paged.page, 4, '纯翻页不被重置');
    assert.deepEqual(paged.types, ['doc'], '纯翻页保留原筛选');

    const explicit = applyPatch(onPage8, { within: '30d', page: 2 });
    assert.equal(explicit.page, 2, '显式带 page 的筛选变更尊重调用方');

    const reset = applyPatch(onPage8, { types: [] });
    assert.equal(serializeFilters(reset), '', '清空筛选后回到干净 URL');
    console.log('[4/4] 筛选变更语义 OK, 改条件回第 1 页 / 纯翻页保留筛选');

    console.log('\n✅ 124-03 筛选与 URL 同步 全部断言通过');
}

void runAssertions();
