// 文件: examples/119-03-release-checklist.ts
// 发布检查清单引擎：构建/测试/体积/兼容/回滚逐条判定，缺项或未确认一律阻断
// 目标：门禁结论可复现；缺项、超预算、未确认项都无法被“跳过”或“口头通过”

import assert from 'node:assert';

type Category = 'build' | 'test' | 'size' | 'compat' | 'rollback';
type CheckStatus = 'pass' | 'fail' | 'unknown';

interface CheckItem {
    id: string;
    category: Category;
    title: string;
    required: boolean;
    status: CheckStatus;
    detail?: string;
    sizeKB?: number;
}

interface ReleasePolicy {
    maxBundleKB: number;
    requiredCategories: Category[];
    requiredChecks: string[];
}

interface Blocker {
    code: string;
    message: string;
}

interface ReleaseDecision {
    decision: 'release' | 'block';
    blockers: Blocker[];
    warnings: string[];
}

/** required = 缺项即阻断；unknown 视同未通过，不视同“差不多可以发” */
function evaluateRelease(items: CheckItem[], policy: ReleasePolicy): ReleaseDecision {
    const blockers: Blocker[] = [];
    const warnings: string[] = [];
    const byId = new Map(items.map((item) => [item.id, item]));

    for (const checkId of policy.requiredChecks) {
        const item = byId.get(checkId);
        if (!item) {
            blockers.push({ code: `missing:${checkId}`, message: `缺少必检项 ${checkId}` });
            continue;
        }
        if (item.status !== 'pass') {
            const detail = item.detail ? `：${item.detail}` : '';
            blockers.push({
                code: `check:${checkId}`,
                message: `${item.title} 未通过（${item.status}）${detail}`,
            });
        }
        if (item.category === 'size' && item.sizeKB !== undefined && item.sizeKB > policy.maxBundleKB) {
            blockers.push({
                code: `size:${checkId}`,
                message: `${item.title} 体积 ${item.sizeKB}KB 超过预算 ${policy.maxBundleKB}KB`,
            });
        }
    }

    // 分类覆盖是第二道闸：漏建“回滚演练”这类整类检查，比单条失败更危险
    for (const category of policy.requiredCategories) {
        const hasRequired = items.some((item) => item.category === category && item.required);
        if (!hasRequired) {
            blockers.push({
                code: `missing-category:${category}`,
                message: `分类 ${category} 没有任何必检项`,
            });
        }
    }

    // 可选检查失败只告警，不阻断发布；否则门禁会被无关项拖死
    for (const item of items) {
        if (!item.required && item.status !== 'pass') {
            warnings.push(`${item.title}: ${item.status}`);
        }
    }

    const unique = new Map(blockers.map((blocker) => [`${blocker.code}|${blocker.message}`, blocker]));
    return {
        decision: unique.size > 0 ? 'block' : 'release',
        blockers: [...unique.values()],
        warnings,
    };
}

const policy: ReleasePolicy = {
    maxBundleKB: 260,
    requiredCategories: ['build', 'test', 'size', 'compat', 'rollback'],
    requiredChecks: [
        'build-app',
        'unit-tests',
        'e2e-checkout',
        'bundle-budget',
        'compat-matrix',
        'rollback-plan',
        'rollback-drill',
    ],
};

function makeItems(): CheckItem[] {
    return [
        { id: 'build-app', category: 'build', title: 'PC/H5 双端构建', required: true, status: 'pass' },
        { id: 'unit-tests', category: 'test', title: '领域层单测', required: true, status: 'pass' },
        { id: 'e2e-checkout', category: 'test', title: '结账主链路 E2E', required: true, status: 'pass' },
        {
            id: 'bundle-budget',
            category: 'size',
            title: 'H5 首屏 JS',
            required: true,
            status: 'pass',
            sizeKB: 240,
        },
        { id: 'compat-matrix', category: 'compat', title: 'iOS/Android 兼容矩阵', required: true, status: 'pass' },
        { id: 'rollback-plan', category: 'rollback', title: '回滚方案与负责人', required: true, status: 'pass' },
        { id: 'rollback-drill', category: 'rollback', title: '回滚演练', required: true, status: 'pass' },
        { id: 'visual-diff', category: 'test', title: '视觉回归', required: false, status: 'fail', detail: '2 处字体差异' },
    ];
}

function runAssertions() {
    // ---------- 测试 1：全绿发布，可选失败只告警 ----------
    const green = evaluateRelease(makeItems(), policy);
    assert.equal(green.decision, 'release');
    assert.equal(green.blockers.length, 0);
    assert.equal(green.warnings.length, 1, '可选视觉回归失败不应阻断');
    assert.ok(green.warnings[0].includes('视觉回归'));
    console.log('[1/4] 全绿放行 OK, 告警:', green.warnings.join('; '));

    // ---------- 测试 2：缺少回滚方案——缺项即阻断 ----------
    const noRollbackPlan = makeItems().filter((item) => item.id !== 'rollback-plan');
    const missing = evaluateRelease(noRollbackPlan, policy);
    assert.equal(missing.decision, 'block');
    assert.equal(missing.blockers.length, 1, '回滚演练仍在，分类覆盖不应重复告警');
    assert.equal(missing.blockers[0].code, 'missing:rollback-plan');
    assert.ok(missing.blockers[0].message.includes('缺少必检项'));
    console.log('[2/4] 缺项阻断 OK:', missing.blockers[0].message);

    // ---------- 测试 3：体积超预算单独阻断 ----------
    const oversized = makeItems().map((item) =>
        item.id === 'bundle-budget' ? { ...item, sizeKB: 318 } : item,
    );
    const sizeDecision = evaluateRelease(oversized, policy);
    assert.equal(sizeDecision.decision, 'block');
    assert.equal(sizeDecision.blockers.length, 1);
    assert.equal(sizeDecision.blockers[0].code, 'size:bundle-budget');
    assert.ok(sizeDecision.blockers[0].message.includes('318KB'));
    assert.ok(sizeDecision.blockers[0].message.includes('260KB'));
    console.log('[3/4] 体积门禁 OK:', sizeDecision.blockers[0].message);

    // ---------- 测试 4：失败 + 未确认 + 可选告警，结论仍然阻断 ----------
    const risky = makeItems().map((item) => {
        if (item.id === 'e2e-checkout') return { ...item, status: 'fail' as CheckStatus, detail: '支付回调超时' };
        if (item.id === 'compat-matrix') return { ...item, status: 'unknown' as CheckStatus, detail: '缺少 Android 12 真机' };
        return item;
    });
    const riskyDecision = evaluateRelease(risky, policy);
    assert.equal(riskyDecision.decision, 'block');
    assert.equal(riskyDecision.blockers.length, 2, 'e2e 失败 + 兼容未确认');
    assert.ok(riskyDecision.blockers.some((item) => item.code === 'check:e2e-checkout' && item.message.includes('fail')));
    assert.ok(riskyDecision.blockers.some((item) => item.code === 'check:compat-matrix' && item.message.includes('unknown')));
    assert.equal(riskyDecision.warnings.length, 1, '视觉回归可选失败只进告警');
    console.log('[4/4] 多违规阻断 OK, 阻断数:', riskyDecision.blockers.length);

    console.log('\n✅ 119-03 发布检查清单引擎 全部断言通过');
}

runAssertions();
