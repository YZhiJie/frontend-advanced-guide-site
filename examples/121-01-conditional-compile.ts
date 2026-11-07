// 文件: examples/121-01-conditional-compile.ts
// 条件编译指令生成：按平台能力矩阵生成 #ifdef 块，并模拟编译产物校验
// 目标：每个目标平台恰好命中一份实现；缺失/未知平台立即失败；产物无残留指令

import assert from 'node:assert';

type Platform = 'H5' | 'MP-WEIXIN' | 'MP-ALIPAY' | 'APP-PLUS' | 'APP-HARMONY';

/** 本次构建的全部目标端，顺序即产物中的生成顺序 */
const TARGETS: readonly Platform[] = ['H5', 'MP-WEIXIN', 'MP-ALIPAY', 'APP-PLUS', 'APP-HARMONY'];

interface Implementation {
    /** 共享同一段实现的平台，生成时用 `||` 合并成一个 #ifdef 块 */
    platforms: Platform[];
    code: string;
    /** 产物校验用的唯一标记，必须只出现在该平台的产物里 */
    marker: string;
}

type Capability = 'share' | 'pay';

const MATRIX: Record<Capability, Implementation[]> = {
    share: [
        { platforms: ['H5'], code: 'navigator.share({ title, url });', marker: 'navigator.share' },
        { platforms: ['MP-WEIXIN'], code: 'wx.shareAppMessage({ title });', marker: 'wx.shareAppMessage' },
        { platforms: ['MP-ALIPAY'], code: 'my.share({ title });', marker: 'my.share' },
        {
            platforms: ['APP-PLUS', 'APP-HARMONY'],
            code: 'uni.shareWithSystem({ type: 0, title });',
            marker: 'uni.shareWithSystem',
        },
    ],
    // 故意缺少 APP-HARMONY：用于验证兜底分支与缺实现报错
    pay: [
        { platforms: ['H5'], code: 'window.location.href = payUrl;', marker: 'payUrl' },
        { platforms: ['MP-WEIXIN'], code: 'uni.requestPayment({ provider: "wxpay" });', marker: 'requestPayment' },
        { platforms: ['MP-ALIPAY'], code: 'uni.requestPayment({ provider: "alipay" });', marker: 'alipay' },
    ],
};

/**
 * 生成条件编译源码。
 * 平台不在 TARGETS 内直接报错，避免「写了实现但构建矩阵里没有这个端」的静默漏配。
 */
function generate(capability: Capability, targets: readonly Platform[] = TARGETS, fallback?: string): string {
    for (const target of targets) {
        if (!TARGETS.includes(target)) throw new Error(`E_UNKNOWN_PLATFORM: ${target}`);
    }

    const blocks = MATRIX[capability];
    for (const block of blocks) {
        for (const platform of block.platforms) {
            if (!TARGETS.includes(platform)) throw new Error(`E_UNKNOWN_PLATFORM: ${platform}`);
        }
    }

    const covered = new Set(blocks.flatMap((block) => block.platforms));
    const missing = targets.filter((target) => !covered.has(target));
    if (missing.length > 0 && fallback === undefined) {
        throw new Error(`E_MISSING_IMPL: ${capability} 缺少 ${missing.join(', ')}`);
    }

    const lines: string[] = [];
    for (const block of blocks) {
        const hit = block.platforms.filter((platform) => targets.includes(platform));
        if (hit.length === 0) continue;
        lines.push(`// #ifdef ${hit.join(' || ')}`, block.code, '// #endif');
    }

    if (missing.length > 0 && fallback !== undefined) {
        // 兜底块用 #ifndef 包住「所有已有实现」，未覆盖端自动落入 fallback
        const guarded = blocks.flatMap((block) => block.platforms).filter((platform) => targets.includes(platform));
        lines.push(`// #ifndef ${guarded.join(' || ')}`, fallback, '// #endif');
    }

    return lines.join('\n');
}

/** 模拟 UniApp 编译：剥离不属于 target 的块，保留其余普通代码 */
function compileFor(source: string, target: Platform): string {
    const output: string[] = [];
    const activeStack: boolean[] = [];

    for (const line of source.split('\n')) {
        const trimmed = line.trim();
        const open = trimmed.match(/^\/\/\s*#(ifdef|ifndef)\s+(.+)$/);
        if (open) {
            const negate = open[1] === 'ifndef';
            const listed = open[2].split('||').map((item) => item.trim());
            const matched = listed.includes(target);
            activeStack.push(negate ? !matched : matched);
            continue;
        }
        if (/^\/\/\s*#endif\s*$/.test(trimmed)) {
            if (activeStack.length === 0) throw new Error('E_UNBALANCED_ENDIF');
            activeStack.pop();
            continue;
        }
        if (activeStack.every(Boolean)) output.push(line);
    }

    if (activeStack.length > 0) throw new Error('E_UNBALANCED_IFDEF');
    return output.join('\n').trim();
}

function runAssertions(): void {
    // ---------- 测试 1：矩阵全覆盖——4 个块覆盖 5 个端，指令成对 ----------
    const shareSource = generate('share');
    assert.equal((shareSource.match(/#ifdef/g) ?? []).length, 4, '5 端应合并为 4 个 ifdef 块');
    assert.equal((shareSource.match(/#endif/g) ?? []).length, 4, '#endif 必须与 #ifdef 成对');

    const shareMarkers = ['navigator.share', 'wx.shareAppMessage', 'my.share', 'uni.shareWithSystem'];
    for (const target of TARGETS) {
        const artifact = compileFor(shareSource, target);
        const hit = shareMarkers.filter((marker) => artifact.includes(marker));
        assert.equal(hit.length, 1, `${target} 应恰好命中一份实现，实际 ${hit.join(',')}`);
    }
    console.log('[1/4] 矩阵生成 OK, share: 4 块 / 5 端全覆盖');

    // ---------- 测试 2：产物隔离——各端只保留自己的调用，且指令全部剥离 ----------
    const mpArtifact = compileFor(shareSource, 'MP-WEIXIN');
    assert.ok(mpArtifact.includes('wx.shareAppMessage'));
    assert.ok(!mpArtifact.includes('navigator.share'), '小程序产物不得残留 H5 调用');
    assert.ok(!mpArtifact.includes('my.share'), '微信产物不得残留支付宝调用');
    assert.ok(!mpArtifact.includes('#ifdef') && !mpArtifact.includes('#endif'), '产物不得残留指令');
    assert.equal(mpArtifact.split('\n').length, 1, '剥离后应只剩一行有效代码');

    // 嵌套块：外层不匹配时，内层即使匹配也必须整段剥掉
    const nested = [
        '// #ifdef H5',
        '// #ifdef MP-WEIXIN',
        'inner();',
        '// #endif',
        'h5();',
        '// #endif',
    ].join('\n');
    assert.equal(compileFor(nested, 'H5'), 'h5();', 'H5 应保留外层、剥掉内层');
    assert.equal(compileFor(nested, 'MP-WEIXIN'), '', '外层不匹配时内层必须一起剥离');
    console.log('[2/4] 产物隔离 OK, MP-WEIXIN 仅保留 wx.shareAppMessage, 嵌套块正确');

    // ---------- 测试 3：缺失实现与兜底——#ifndef 只让未覆盖端命中 ----------
    const payFallback = 'throw new Error("E_PAY_UNSUPPORTED");';
    const paySource = generate('pay', TARGETS, payFallback);
    const harmonyArtifact = compileFor(paySource, 'APP-HARMONY');
    assert.ok(harmonyArtifact.includes('E_PAY_UNSUPPORTED'), 'APP-HARMONY 应落入兜底');
    assert.ok(!harmonyArtifact.includes('requestPayment'));

    const h5Artifact = compileFor(paySource, 'H5');
    assert.ok(h5Artifact.includes('payUrl'));
    assert.ok(!h5Artifact.includes('E_PAY_UNSUPPORTED'), 'H5 不应命中 #ifndef 兜底');

    assert.throws(() => generate('pay'), /E_MISSING_IMPL/, '缺实现且无兜底应直接报错');
    assert.throws(
        () => generate('pay', [...TARGETS, 'MP-BAIDU' as Platform]),
        /E_UNKNOWN_PLATFORM/,
        '构建矩阵外的平台必须拒绝',
    );
    console.log('[3/4] 兜底与缺实现 OK, APP-HARMONY 走 #ifndef 兜底');

    // ---------- 测试 4：产物校验——未闭合指令与共享实现分组 ----------
    const tampered = shareSource.replace('// #endif', '');
    assert.throws(() => compileFor(tampered, 'H5'), /E_UNBALANCED_IFDEF/, '未闭合 #ifdef 必须被校验拦截');

    const appPlus = compileFor(shareSource, 'APP-PLUS');
    const harmony = compileFor(shareSource, 'APP-HARMONY');
    assert.equal(appPlus, harmony, '同一实现组的两个端产物应一致');
    assert.ok(appPlus.includes('uni.shareWithSystem'));
    console.log('[4/4] 产物校验 OK, 未闭合 #ifdef 被拒绝');

    console.log('\n✅ 121-01 条件编译指令生成 全部断言通过');
}

runAssertions();
