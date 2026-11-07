// 文件: examples/120-01-schema-validation.ts
// 活动 Schema 校验：组件白名单 + 嵌套层级 + 必填/类型 + 版本迁移
// 目标：非法配置在发布前被拦截（报错带路径），旧版本配置可无损升级到新 Schema

import assert from 'node:assert';

type Json = unknown;

interface PageNode {
    id: string;
    type: string;
    props: Record<string, Json>;
    children: PageNode[];
}

interface PageSchema {
    version: number;
    title: string;
    root: PageNode;
}

type PropType = 'string' | 'number' | 'boolean';

interface PropRule {
    type: PropType;
    required?: boolean;
}

interface ComponentRule {
    /** 允许的直接子节点数量上限，0 表示叶子组件 */
    maxChildren: number;
    props: Record<string, PropRule>;
}

/** 组件白名单：不在表里的 type 一律视为非法配置 */
const COMPONENT_RULES: Record<string, ComponentRule> = {
    page: { maxChildren: 30, props: {} },
    grid: { maxChildren: 6, props: {} },
    banner: {
        maxChildren: 0,
        props: {
            image: { type: 'string', required: true },
            link: { type: 'string' },
            alt: { type: 'string' },
        },
    },
    text: {
        maxChildren: 0,
        props: {
            content: { type: 'string', required: true },
            size: { type: 'number' },
        },
    },
    button: {
        maxChildren: 0,
        props: {
            label: { type: 'string', required: true },
            action: { type: 'string', required: true },
        },
    },
};

/** 允许的最大嵌套深度（root 记为第 1 层），防止运营复制出无限深树 */
const MAX_DEPTH = 5;

interface Issue {
    path: string;
    message: string;
}

function typeOf(value: Json): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function validateNode(node: PageNode, path: string, depth: number, issues: Issue[]): void {
    if (depth > MAX_DEPTH) {
        issues.push({ path, message: `嵌套层级超过 ${MAX_DEPTH} 层` });
        return;
    }
    const rule = COMPONENT_RULES[node.type];
    if (!rule) {
        // 未知组件是最危险的错误：渲染层没有对应实现，线上直接空白
        issues.push({ path, message: `未知组件类型: ${node.type}` });
        return;
    }
    if (node.children.length > rule.maxChildren) {
        issues.push({ path, message: `${node.type} 子节点超限: ${node.children.length} > ${rule.maxChildren}` });
    }
    if (rule.maxChildren === 0 && node.children.length > 0) {
        issues.push({ path, message: `${node.type} 是叶子组件，不允许子节点` });
    }
    for (const [key, propRule] of Object.entries(rule.props)) {
        const value = node.props[key];
        if (value === undefined) {
            if (propRule.required) issues.push({ path: `${path}.props.${key}`, message: '缺少必填属性' });
            continue;
        }
        if (typeOf(value) !== propRule.type) {
            issues.push({
                path: `${path}.props.${key}`,
                message: `类型错误: 期望 ${propRule.type}，实际 ${typeOf(value)}`,
            });
        }
    }
    node.children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, depth + 1, issues));
}

function validate(schema: PageSchema): Issue[] {
    const issues: Issue[] = [];
    if (schema.version !== 2) {
        issues.push({ path: 'version', message: `不支持的 Schema 版本: ${schema.version}` });
    }
    if (schema.title.trim() === '') {
        issues.push({ path: 'title', message: '标题不能为空' });
    }
    validateNode(schema.root, 'root', 1, issues);
    return issues;
}

/** v1 → v2：image 更名为 banner，src 更名为 image；text 的 fontsize 迁移为 size */
function migrateToV2(schema: PageSchema): PageSchema {
    if (schema.version !== 1) return schema;
    const visit = (node: PageNode): PageNode => ({
        id: node.id,
        type: node.type === 'image' ? 'banner' : node.type,
        props: node.type === 'image'
            ? { ...node.props, image: node.props.src }
            : node.type === 'text'
                ? { ...node.props, size: node.props.fontsize }
                : { ...node.props },
        children: node.children.map(visit),
    });
    const root = visit(schema.root);
    // 迁移时顺手删掉旧字段，避免新旧字段同时留在配置里造成歧义
    const strip = (node: PageNode): PageNode => {
        const props = { ...node.props };
        delete props.src;
        delete props.fontsize;
        return { ...node, props, children: node.children.map(strip) };
    };
    return { version: 2, title: schema.title, root: strip(root) };
}

function node(type: string, props: Record<string, Json> = {}, children: PageNode[] = []): PageNode {
    return { id: `${type}-${Math.random().toString(36).slice(2, 8)}`, type, props, children };
}

function runAssertions() {
    // ---------- 测试 1：合法 schema 零报错 ----------
    const valid: PageSchema = {
        version: 2,
        title: 'Black Friday 2026',
        root: node('page', {}, [
            node('grid', {}, [
                node('banner', { image: 'https://cdn.example.com/bf.jpg', link: '/bf', alt: 'Black Friday' }),
                node('text', { content: 'Up to 70% off', size: 28 }),
            ]),
            node('button', { label: 'Shop now', action: 'open:/category' }),
        ]),
    };
    assert.deepEqual(validate(valid), [], '合法配置不应报错');
    console.log('[1/4] 合法 Schema 通过 OK');

    // ---------- 测试 2：未知组件 + 超深嵌套 + 叶子挂子节点 ----------
    const deep = (levels: number): PageNode => {
        let current = node('banner', { image: 'x.png' });
        for (let i = 0; i < levels; i++) current = node('grid', {}, [current]);
        return current;
    };
    const invalid: PageSchema = {
        version: 2,
        title: 'broken',
        root: node('page', {}, [
            node('carousel', { images: [] }), // 白名单里没有 carousel
            deep(6), // page(1) + 6 层 grid 已超限
            node('text', { content: 'hi' }, [node('text', { content: 'child' })]),
        ]),
    };
    const issues = validate(invalid);
    assert.ok(issues.some((i) => i.path === 'root.children[0]' && i.message.includes('未知组件')), '未知组件须报错');
    assert.ok(issues.some((i) => i.message.includes('嵌套层级')), '超深嵌套须报错');
    assert.ok(issues.some((i) => i.message.includes('叶子组件')), '叶子挂子节点须报错');
    console.log('[2/4] 非法结构拦截 OK, 问题数:', issues.length);

    // ---------- 测试 3：必填缺失与类型错误，报错路径可定位 ----------
    const badProps: PageSchema = {
        version: 2,
        title: 'props',
        root: node('page', {}, [
            node('banner', { link: '/x' }), // 缺必填 image
            node('text', { content: 'ok', size: '28' }), // size 应是 number
            node('button', { label: 123, action: 'open:/x' }), // label 应是 string
        ]),
    };
    const propIssues = validate(badProps);
    assert.deepEqual(
        propIssues.map((i) => i.path),
        ['root.children[0].props.image', 'root.children[1].props.size', 'root.children[2].props.label'],
        '报错路径必须精确到属性',
    );
    console.log('[3/4] 必填/类型校验 OK, 首条路径:', propIssues[0].path);

    // ---------- 测试 4：v1 配置迁移到 v2 后可通过校验 ----------
    const v1: PageSchema = {
        version: 1,
        title: 'Legacy campaign',
        root: node('page', {}, [
            node('image', { src: 'https://cdn.example.com/old.jpg', link: '/old' }),
            node('text', { content: 'Sale', fontsize: 24 }),
        ]),
    };
    assert.notDeepEqual(validate(v1), [], 'v1 直接校验应失败');
    const migrated = migrateToV2(v1);
    assert.equal(migrated.version, 2);
    assert.equal(migrated.root.children[0].type, 'banner', 'image 应迁移为 banner');
    assert.equal(migrated.root.children[0].props.image, 'https://cdn.example.com/old.jpg');
    assert.equal(migrated.root.children[0].props.src, undefined, '旧字段必须清除');
    assert.equal(migrated.root.children[1].props.size, 24, 'fontsize 应迁移为 size');
    assert.deepEqual(validate(migrated), [], '迁移后必须零报错');
    console.log('[4/4] v1 → v2 迁移 OK, 迁移后校验通过');

    console.log('\n✅ 120-01 活动 Schema 校验 全部断言通过');
}

runAssertions();
