// 文件: examples/112-01-query-builder-validation.ts
// 查询构建 + 变量类型校验：把查询串渲染与变量 schema 校验放在同一条链路上
// 目标：错类型/缺必填/未声明变量/声明未使用四类错误都能在发请求前被拒绝

import assert from 'node:assert';

type GqlScalar = 'ID' | 'Int' | 'Float' | 'String' | 'Boolean';

interface VarDef {
    name: string;
    type: GqlScalar;
    required: boolean;
    list: boolean;
    defaultValue?: string | number | boolean;
}

type ArgValue = string | number | boolean | { var: string } | ArgValue[];

interface FieldNode {
    name: string;
    alias?: string;
    args?: Record<string, ArgValue>;
    selection?: FieldNode[];
}

interface OperationSpec {
    name: string;
    vars: VarDef[];
    fields: FieldNode[];
}

interface VarRef {
    var: string;
}

type VarErrorCode = 'MISSING' | 'NULL' | 'TYPE' | 'UNKNOWN' | 'UNUSED';

interface VarError {
    code: VarErrorCode;
    variable: string;
    message: string;
}

type CheckResult = { ok: true; value: unknown } | { ok: false; message: string };

function isVarRef(value: ArgValue): value is VarRef {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'var' in value;
}

function renderLiteral(value: string | number | boolean): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function renderArgValue(value: ArgValue): string {
    if (Array.isArray(value)) return `[${value.map(renderArgValue).join(', ')}]`;
    if (isVarRef(value)) return `$${value.var}`;
    return renderLiteral(value);
}

function renderArgs(args: Record<string, ArgValue>): string {
    const pairs = Object.keys(args).map((key) => `${key}: ${renderArgValue(args[key])}`);
    return `(${pairs.join(', ')})`;
}

function renderField(field: FieldNode, depth: number): string {
    const indent = '    '.repeat(depth);
    const head = `${field.alias ? `${field.alias}: ` : ''}${field.name}${field.args ? renderArgs(field.args) : ''}`;
    if (!field.selection || field.selection.length === 0) return `${indent}${head}`;
    const children = field.selection.map((child) => renderField(child, depth + 1)).join('\n');
    return `${indent}${head} {\n${children}\n${indent}}`;
}

/** 渲染变量定义：$id: ID!、$tags: [String]、可选变量支持默认值 */
function renderVarDef(def: VarDef): string {
    const base = def.list ? `[${def.type}]` : def.type;
    const nonNull = def.required ? '!' : '';
    const fallback = def.defaultValue === undefined ? '' : ` = ${renderLiteral(def.defaultValue)}`;
    return `$${def.name}: ${base}${nonNull}${fallback}`;
}

function buildQuery(spec: OperationSpec): string {
    const defs = spec.vars.length > 0 ? `(${spec.vars.map(renderVarDef).join(', ')})` : '';
    const body = spec.fields.map((field) => renderField(field, 1)).join('\n');
    return `query ${spec.name}${defs} {\n${body}\n}`;
}

/** 收集查询体中真正被引用的变量，用于发现「声明了但没用」 */
function collectVarRefs(fields: FieldNode[]): Set<string> {
    const refs = new Set<string>();
    const visitArg = (value: ArgValue): void => {
        if (Array.isArray(value)) {
            value.forEach(visitArg);
            return;
        }
        if (isVarRef(value)) refs.add(value.var);
    };
    const walk = (list: FieldNode[]): void => {
        for (const field of list) {
            if (field.args) Object.values(field.args).forEach(visitArg);
            if (field.selection) walk(field.selection);
        }
    };
    walk(fields);
    return refs;
}

function describeValue(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return `${typeof value} ${JSON.stringify(value)}`;
}

function checkScalar(type: GqlScalar, value: unknown, path: string): CheckResult {
    switch (type) {
        case 'ID':
            if (typeof value === 'string') return { ok: true, value };
            // Int 型 ID 也是合法输入，按规范统一转成字符串
            if (typeof value === 'number' && Number.isInteger(value)) return { ok: true, value: String(value) };
            return { ok: false, message: `${path} 期望 ID（字符串或整数），实际 ${describeValue(value)}` };
        case 'Int':
            if (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 2 ** 31 - 1) {
                return { ok: true, value };
            }
            return { ok: false, message: `${path} 期望 Int（32 位整数），实际 ${describeValue(value)}` };
        case 'Float':
            if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
            return { ok: false, message: `${path} 期望 Float（有限数字），实际 ${describeValue(value)}` };
        case 'String':
            if (typeof value === 'string') return { ok: true, value };
            return { ok: false, message: `${path} 期望 String，实际 ${describeValue(value)}` };
        case 'Boolean':
            if (typeof value === 'boolean') return { ok: true, value };
            return { ok: false, message: `${path} 期望 Boolean，实际 ${describeValue(value)}` };
    }
}

function checkValue(def: VarDef, value: unknown, path: string): CheckResult {
    if (!def.list) return checkScalar(def.type, value, path);
    if (!Array.isArray(value)) {
        return { ok: false, message: `${path} 期望数组，实际 ${describeValue(value)}` };
    }
    const items: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
        const item = checkScalar(def.type, value[i], `${path}[${i}]`);
        if (!item.ok) return item;
        items.push(item.value);
    }
    return { ok: true, value: items };
}

/**
 * 校验变量：缺必填、显式 null、标量/列表类型、未声明、声明未使用。
 * 显式 null 对可空变量是合法值；默认值交给服务端应用，客户端不填充。
 */
function validateVariables(
    spec: OperationSpec,
    raw: Record<string, unknown>,
): { values: Record<string, unknown>; errors: VarError[] } {
    const errors: VarError[] = [];
    const values: Record<string, unknown> = {};
    const declared = new Set(spec.vars.map((def) => def.name));

    for (const def of spec.vars) {
        const present = Object.prototype.hasOwnProperty.call(raw, def.name);
        const value = raw[def.name];
        if (!present || value === undefined) {
            if (def.required) {
                errors.push({ code: 'MISSING', variable: def.name, message: `缺少必填变量 $${def.name}` });
            }
            continue;
        }
        if (value === null) {
            if (def.required) {
                errors.push({ code: 'NULL', variable: def.name, message: `必填变量 $${def.name} 不能为 null` });
            } else {
                values[def.name] = null;
            }
            continue;
        }
        const checked = checkValue(def, value, `$${def.name}`);
        if (!checked.ok) {
            errors.push({ code: 'TYPE', variable: def.name, message: checked.message });
            continue;
        }
        values[def.name] = checked.value;
    }

    for (const key of Object.keys(raw).sort()) {
        if (!declared.has(key)) {
            errors.push({ code: 'UNKNOWN', variable: key, message: `变量 $${key} 未在操作中声明` });
        }
    }

    const used = collectVarRefs(spec.fields);
    for (const def of spec.vars) {
        if (!used.has(def.name)) {
            errors.push({ code: 'UNUSED', variable: def.name, message: `变量 $${def.name} 声明但查询未使用` });
        }
    }

    return { values, errors };
}

const productSpec: OperationSpec = {
    name: 'ProductDetail',
    vars: [
        { name: 'id', type: 'ID', required: true, list: false },
        { name: 'locale', type: 'String', required: false, list: false, defaultValue: 'en-US' },
        { name: 'preview', type: 'Boolean', required: false, list: false },
    ],
    fields: [
        {
            name: 'product',
            args: { id: { var: 'id' }, locale: { var: 'locale' } },
            selection: [
                { name: 'id' },
                { name: 'title' },
                { name: 'price', selection: [{ name: 'amount' }, { name: 'currency' }] },
                { name: 'inventory', args: { preview: { var: 'preview' } }, selection: [{ name: 'available' }] },
            ],
        },
    ],
};

const searchSpec: OperationSpec = {
    name: 'SearchProducts',
    vars: [
        { name: 'first', type: 'Int', required: true, list: false },
        { name: 'minPrice', type: 'Float', required: false, list: false },
        { name: 'tags', type: 'String', required: true, list: true },
    ],
    fields: [
        {
            name: 'searchProducts',
            args: { first: { var: 'first' }, minPrice: { var: 'minPrice' }, tags: { var: 'tags' } },
            selection: [{ name: 'total' }, { name: 'items', selection: [{ name: 'id' }, { name: 'title' }] }],
        },
    ],
};

function errorKeys(errors: VarError[]): string[] {
    return errors.map((error) => `${error.code}:${error.variable}`);
}

function runAssertions() {
    // ---------- 测试 1：查询串渲染——变量定义顺序、默认值、嵌套选择集与缩进 ----------
    const query = buildQuery(productSpec);
    const expected = [
        'query ProductDetail($id: ID!, $locale: String = "en-US", $preview: Boolean) {',
        '    product(id: $id, locale: $locale) {',
        '        id',
        '        title',
        '        price {',
        '            amount',
        '            currency',
        '        }',
        '        inventory(preview: $preview) {',
        '            available',
        '        }',
        '    }',
        '}',
    ].join('\n');
    assert.equal(query, expected, '查询串必须与预期完全一致');
    assert.ok(query.indexOf('$id: ID!') < query.indexOf('$locale'), '变量定义应保持声明顺序');
    console.log('[1/4] 查询串渲染 OK, 长度:', query.length);

    // ---------- 测试 2：合法变量——ID 数字转字符串、省略可选变量、默认值不由客户端填充 ----------
    const okResult = validateVariables(productSpec, { id: 1001, preview: true });
    assert.deepEqual(okResult.errors, [], '合法变量不应报错');
    assert.equal(okResult.values.id, '1001', '整数 ID 必须规范化为字符串');
    assert.equal(okResult.values.preview, true);
    assert.equal(Object.prototype.hasOwnProperty.call(okResult.values, 'locale'), false, '可选变量缺省时不应注入默认值');
    assert.deepEqual(validateVariables(searchSpec, { first: 10, tags: [] }).errors, [], '空数组是合法列表');
    console.log('[2/4] 合法变量 OK, values:', JSON.stringify(okResult.values));

    // ---------- 测试 3：错类型——Int 传小数、Float 传字符串、列表混入错误元素 ----------
    const typeResult = validateVariables(searchSpec, { first: 1.5, minPrice: '9.9', tags: ['sale', 3] });
    assert.equal(typeResult.errors.length, 3, '三处类型错误都应被捕获');
    assert.deepEqual(errorKeys(typeResult.errors), ['TYPE:first', 'TYPE:minPrice', 'TYPE:tags']);
    assert.match(typeResult.errors[0].message, /Int/);
    assert.match(typeResult.errors[1].message, /Float/);
    assert.match(typeResult.errors[2].message, /tags\[1\]/, '列表错误必须带下标路径');
    assert.equal(Object.prototype.hasOwnProperty.call(typeResult.values, 'first'), false, '错类型变量不得进入 values');
    console.log('[3/4] 错类型拒绝 OK:', typeResult.errors.map((error) => error.message).join(' | '));

    // ---------- 测试 4：缺必填 / null / 未声明 / 声明未使用 ----------
    const missing = validateVariables(productSpec, { locale: 'zh-CN' });
    assert.deepEqual(errorKeys(missing.errors), ['MISSING:id']);

    const nullRequired = validateVariables(productSpec, { id: null });
    assert.deepEqual(errorKeys(nullRequired.errors), ['NULL:id']);

    const unknown = validateVariables(productSpec, { id: 7, extra: 'x' });
    assert.deepEqual(errorKeys(unknown.errors), ['UNKNOWN:extra'], '未声明变量必须拒绝');

    const unusedSpec: OperationSpec = {
        name: 'BrokenQuery',
        vars: [
            { name: 'id', type: 'ID', required: true, list: false },
            { name: 'page', type: 'Int', required: false, list: false },
        ],
        fields: [{ name: 'product', args: { id: { var: 'id' } }, selection: [{ name: 'title' }] }],
    };
    const unused = validateVariables(unusedSpec, { id: 'p1', page: 2 });
    assert.deepEqual(errorKeys(unused.errors), ['UNUSED:page'], '声明但未使用的变量是 Schema 校验错误');
    console.log('[4/4] 缺失/未声明/未使用 OK, 4 组错误均被拦截');

    console.log('\n✅ 112-01 查询构建与变量校验 全部断言通过');
}

runAssertions();
