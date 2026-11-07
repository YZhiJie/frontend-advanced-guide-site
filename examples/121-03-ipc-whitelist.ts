// 文件: examples/121-03-ipc-whitelist.ts
// Electron IPC 白名单：频道注册、参数校验、角色越权拒绝与敏感 API 隔离
// 目标：未注册频道一律拒绝、校验失败不触达 handler、路径越界/任意 URL 被拦截

import assert from 'node:assert';

type Role = 'user' | 'admin';

const ROLE_WEIGHT: Record<Role, number> = { user: 1, admin: 2 };

interface Caller {
    /** 发起调用的渲染进程窗口 id，用于审计与按窗口授权 */
    windowId: number;
    role: Role;
}

type ErrorCode = 'E_CHANNEL_NOT_ALLOWED' | 'E_PERMISSION_DENIED' | 'E_INVALID_ARGS' | 'E_SENSITIVE_API';

type Validation =
    | { ok: true; value: Record<string, unknown> }
    | { ok: false; code: ErrorCode; message: string };

type InvokeResult = { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string };

interface ChannelDefinition {
    channel: string;
    minRole: Role;
    validate(input: unknown): Validation;
    handle(input: Record<string, unknown>, caller: Caller): unknown;
}

const registry = new Map<string, ChannelDefinition>();
const handlerCalls = new Map<string, number>();

function register(definition: ChannelDefinition): void {
    if (registry.has(definition.channel)) throw new Error(`E_DUPLICATE_CHANNEL: ${definition.channel}`);
    registry.set(definition.channel, definition);
    handlerCalls.set(definition.channel, 0);
}

function callCount(channel: string): number {
    return handlerCalls.get(channel) ?? 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

const DOC_ROOT = '/data/docs';
const ALLOWED_HOSTS = new Set(['shop.example.com', 'help.example.com']);

/** 文件路径白名单：必须落在 DOC_ROOT 下，且禁止 . / .. 段穿越 */
function validateDocPath(input: unknown): Validation {
    if (!isRecord(input) || typeof input.path !== 'string') {
        return { ok: false, code: 'E_INVALID_ARGS', message: 'path 必须为字符串' };
    }
    const path = input.path;
    const segments = path.split('/');
    if (!path.startsWith(`${DOC_ROOT}/`) || segments.includes('..') || segments.includes('.')) {
        return { ok: false, code: 'E_SENSITIVE_API', message: '路径越界' };
    }
    return { ok: true, value: { path } };
}

/** 外链白名单：只允许 https 且命中域名白名单，file:// 与任意域名一律拒绝 */
function validateExternalUrl(input: unknown): Validation {
    if (!isRecord(input) || typeof input.url !== 'string') {
        return { ok: false, code: 'E_INVALID_ARGS', message: 'url 必须为字符串' };
    }
    let parsed: URL;
    try {
        parsed = new URL(input.url);
    } catch {
        return { ok: false, code: 'E_SENSITIVE_API', message: '非法 URL' };
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
        return { ok: false, code: 'E_SENSITIVE_API', message: `URL 不在白名单: ${parsed.href}` };
    }
    return { ok: true, value: { url: parsed.toString() } };
}

register({
    channel: 'cart:read',
    minRole: 'user',
    validate: (input) => {
        if (!isRecord(input) || typeof input.id !== 'string' || !/^\d{4,}$/.test(input.id)) {
            return { ok: false, code: 'E_INVALID_ARGS', message: 'cart id 必须为 4 位以上数字' };
        }
        return { ok: true, value: { id: input.id } };
    },
    handle: (input, caller) => ({
        cartId: input.id,
        windowId: caller.windowId,
        items: [{ sku: 'TS-001', qty: 2 }],
    }),
});

register({
    channel: 'file:read',
    minRole: 'user',
    validate: validateDocPath,
    handle: (input) => ({ path: input.path, content: 'invoice:2026-Q4' }),
});

register({
    channel: 'file:write',
    minRole: 'admin',
    validate: validateDocPath,
    handle: (input) => ({ written: true, path: input.path }),
});

register({
    channel: 'shell:openExternal',
    minRole: 'user',
    validate: validateExternalUrl,
    handle: (input) => ({ opened: input.url }),
});

/**
 * 唯一的 IPC 入口：先查白名单，再验角色，再验参数，最后才触达 handler。
 * 任何一步失败都不执行业务逻辑，错误以数据形式返回，不让异常穿越 IPC 边界。
 */
function invoke(channel: string, payload: unknown, caller: Caller): InvokeResult {
    const definition = registry.get(channel);
    if (!definition) {
        // 不返回「可用频道列表」，避免攻击者枚举能力面
        return { ok: false, code: 'E_CHANNEL_NOT_ALLOWED', message: '通道不存在或未授权' };
    }

    const weight = ROLE_WEIGHT[caller.role];
    if (weight === undefined || weight < ROLE_WEIGHT[definition.minRole]) {
        return { ok: false, code: 'E_PERMISSION_DENIED', message: '权限不足' };
    }

    const validation = definition.validate(payload);
    if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

    handlerCalls.set(channel, (handlerCalls.get(channel) ?? 0) + 1);
    return { ok: true, data: definition.handle(validation.value, caller) };
}

function runAssertions(): void {
    const user: Caller = { windowId: 7, role: 'user' };
    const admin: Caller = { windowId: 1, role: 'admin' };

    // ---------- 测试 1：白名单——未注册频道拒绝且不泄漏能力面 ----------
    const cart = invoke('cart:read', { id: '1001' }, user);
    assert.deepEqual(cart, {
        ok: true,
        data: { cartId: '1001', windowId: 7, items: [{ sku: 'TS-001', qty: 2 }] },
    });

    const exec = invoke('system:exec', { cmd: 'rm -rf /' }, admin);
    assert.deepEqual(exec, {
        ok: false,
        code: 'E_CHANNEL_NOT_ALLOWED',
        message: '通道不存在或未授权',
    });
    assert.ok(!('data' in exec), '拒绝结果不得带数据');
    assert.ok(!exec.message.includes('file:read'), '错误信息不得泄漏已注册频道');
    console.log('[1/4] 白名单 OK, system:exec 未注册即拒绝（管理员也不例外）');

    // ---------- 测试 2：参数校验——类型、格式与路径穿越 ----------
    const read = invoke('file:read', { path: '/data/docs/2026-Q4/invoice.txt' }, user);
    assert.equal(read.ok, true);
    assert.equal(callCount('file:read'), 1);

    const traversal = invoke('file:read', { path: '/data/docs/../secrets/token.txt' }, user);
    assert.deepEqual(traversal, { ok: false, code: 'E_SENSITIVE_API', message: '路径越界' });

    const wrongType = invoke('file:read', { path: 42 }, user);
    assert.deepEqual(wrongType, { ok: false, code: 'E_INVALID_ARGS', message: 'path 必须为字符串' });
    assert.equal(callCount('file:read'), 1, '被拒绝的调用不得触达 handler');
    console.log('[2/4] 参数校验 OK, 穿越与类型错误均未触达 handler');

    // ---------- 测试 3：角色越权——普通用户写文件被拒，管理员放行 ----------
    const denied = invoke('file:write', { path: '/data/docs/out/report.json' }, user);
    assert.deepEqual(denied, { ok: false, code: 'E_PERMISSION_DENIED', message: '权限不足' });
    assert.equal(callCount('file:write'), 0);

    const written = invoke('file:write', { path: '/data/docs/out/report.json' }, admin);
    assert.deepEqual(written, { ok: true, data: { written: true, path: '/data/docs/out/report.json' } });
    assert.equal(callCount('file:write'), 1);

    const guest = invoke('file:write', { path: '/data/docs/out/report.json' }, { windowId: 9, role: 'guest' as Role });
    assert.equal(guest.ok, false, '未知角色一律按越权处理');
    console.log('[3/4] 越权拒绝 OK, user 写文件被拒 / admin 放行');

    // ---------- 测试 4：敏感 API 隔离——外链协议与域名双重白名单 ----------
    const allowed = invoke('shell:openExternal', { url: 'https://shop.example.com/orders/A1001' }, user);
    assert.equal(allowed.ok, true);
    assert.equal(callCount('shell:openExternal'), 1);

    const fileProtocol = invoke('shell:openExternal', { url: 'file:///etc/passwd' }, admin);
    assert.equal(fileProtocol.ok, false);
    assert.equal(fileProtocol.ok === false ? fileProtocol.code : '', 'E_SENSITIVE_API');

    const evilHost = invoke('shell:openExternal', { url: 'https://evil.example/phish' }, user);
    assert.equal(evilHost.ok, false);
    assert.equal(evilHost.ok === false ? evilHost.code : '', 'E_SENSITIVE_API');
    assert.equal(callCount('shell:openExternal'), 1, '敏感 API 被拦截时不得执行');
    console.log('[4/4] 敏感 API 隔离 OK, file:// 与未授权域名均被拦截');

    console.log('\n✅ 121-03 Electron IPC 白名单 全部断言通过');
}

runAssertions();
