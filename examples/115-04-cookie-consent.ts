// 文件: examples/115-04-cookie-consent.ts
// Cookie 同意决策：地域判定、同意分级、脚本延迟加载与非同意回撤
// 目标：GDPR 默认全拒（opt-in）、CCPA 默认允许但可 opt-out、GPC 信号优先、旧版本同意失效

import assert from 'node:assert';

type Regime = 'gdpr' | 'ccpa' | 'lgpd' | 'strict';
type Category = 'necessary' | 'analytics' | 'marketing';

const EU_EEA = new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
]);

/** 地域 → 合规模型；未知地域按最严格处理，绝不默认放行 */
function resolveRegime(country: string, region?: string): Regime {
    const code = country.trim().toUpperCase();
    if (EU_EEA.has(code) || code === 'GB') return 'gdpr';
    if (code === 'BR') return 'lgpd';
    if (code === 'US' && region?.trim().toUpperCase() === 'CA') return 'ccpa';
    return 'strict';
}

const POLICY_VERSION = 2;
const CONSENT_TTL_MS = 180 * 24 * 3600_000; // GDPR 实践常用的再征询周期

interface ConsentRecord {
    regime: Regime;
    policyVersion: number;
    granted: Category[];
    decidedAt: number;
}

function makeConsent(regime: Regime, granted: Category[], decidedAt: number, policyVersion = POLICY_VERSION): ConsentRecord {
    return { regime, policyVersion, granted, decidedAt };
}

function hasValidConsent(record: ConsentRecord | null, regime: Regime, now: number): record is ConsentRecord {
    if (!record) return false;
    if (record.regime !== regime) return false;
    if (record.policyVersion !== POLICY_VERSION) return false; // 隐私政策改版后旧同意作废
    return record.decidedAt <= now && now - record.decidedAt <= CONSENT_TTL_MS;
}

type Banner = 'opt-in' | 'opt-out' | 'opt-out-gpc' | 'none';

/** 是否展示同意横幅：opt-out 地区即使默认允许，也必须给“拒绝出售/共享”的入口 */
function bannerFor(regime: Regime, record: ConsentRecord | null, now: number, gpc = false): Banner {
    if (hasValidConsent(record, regime, now)) return 'none';
    if (regime === 'ccpa') return gpc ? 'opt-out-gpc' : 'opt-out';
    return 'opt-in';
}

/** 某类脚本此刻是否允许加载；necessary 永远允许 */
function categoryAllowed(
    category: Category,
    regime: Regime,
    record: ConsentRecord | null,
    now: number,
    gpc = false,
): boolean {
    if (category === 'necessary') return true;
    const valid = hasValidConsent(record, regime, now);
    if (regime === 'ccpa') {
        if (category === 'marketing' && gpc) return false; // 全局隐私控制信号等同 opt-out
        return valid ? record.granted.includes(category) : true;
    }
    return valid ? record.granted.includes(category) : false;
}

class ConsentGate {
    private readonly loaded = new Set<Category>();

    constructor(
        private readonly onLoad: (category: Category) => void,
        private readonly onRevoke: (category: Category) => void,
    ) {
        this.loaded.add('necessary');
        this.onLoad('necessary'); // 必要 Cookie 不需要同意，但要在页面启动时立即可用
    }

    get loadedCategories(): Category[] {
        return [...this.loaded];
    }

    /** 按当前同意状态对齐脚本：新授权则加载，撤销则卸载并清 Cookie */
    sync(regime: Regime, record: ConsentRecord | null, now: number, gpc = false): void {
        for (const category of ['analytics', 'marketing'] as const) {
            const allowed = categoryAllowed(category, regime, record, now, gpc);
            if (allowed && !this.loaded.has(category)) {
                this.loaded.add(category);
                this.onLoad(category);
            } else if (!allowed && this.loaded.has(category)) {
                this.loaded.delete(category);
                this.onRevoke(category);
            }
        }
    }
}

function runAssertions() {
    const now = Date.UTC(2026, 10, 3, 8, 0);

    // ---------- 测试 1：地域映射——英国走 UK GDPR，美国只有加州是 opt-out ----------
    assert.equal(resolveRegime('DE'), 'gdpr');
    assert.equal(resolveRegime('FR'), 'gdpr');
    assert.equal(resolveRegime('GB'), 'gdpr', '英国适用 UK GDPR');
    assert.equal(resolveRegime('US', 'CA'), 'ccpa');
    assert.equal(resolveRegime('US', 'NY'), 'strict', '未覆盖的州按最严格处理');
    assert.equal(resolveRegime('BR'), 'lgpd');
    assert.equal(resolveRegime('JP'), 'strict');
    assert.equal(resolveRegime('ZZ'), 'strict', '未知地域不得默认放行');
    console.log('[1/4] 地域判定 OK, US-CA →', resolveRegime('US', 'CA'));

    // ---------- 测试 2：横幅策略——opt-in / opt-out / GPC / 已有有效同意 ----------
    assert.equal(bannerFor('gdpr', null, now), 'opt-in');
    assert.equal(bannerFor('gdpr', makeConsent('gdpr', ['analytics'], now - 1000), now), 'none');
    assert.equal(bannerFor('ccpa', null, now), 'opt-out');
    assert.equal(bannerFor('ccpa', null, now, true), 'opt-out-gpc', 'GPC 必须自动生效');
    assert.equal(bannerFor('ccpa', makeConsent('ccpa', ['analytics'], now - 1000), now), 'none');
    console.log('[2/4] 横幅策略 OK, CCPA 无同意 → opt-out');

    // ---------- 测试 3：脚本门禁——默认不加载、部分授权只加载对应类、撤销即卸载 ----------
    const events: string[] = [];
    const gate = new ConsentGate(
        (category) => events.push(`load:${category}`),
        (category) => events.push(`revoke:${category}`),
    );
    gate.sync('gdpr', null, now);
    assert.deepEqual(gate.loadedCategories, ['necessary'], '未同意前只允许必要脚本');
    assert.deepEqual(events, ['load:necessary']);

    gate.sync('gdpr', makeConsent('gdpr', ['analytics'], now - 60_000), now);
    assert.deepEqual(gate.loadedCategories, ['necessary', 'analytics']);
    assert.ok(events.includes('load:analytics'));
    assert.equal(events.includes('load:marketing'), false, '未授权营销脚本绝不能加载');

    gate.sync('gdpr', makeConsent('gdpr', [], now), now);
    assert.deepEqual(gate.loadedCategories, ['necessary'], '撤销同意后必须卸载');
    assert.ok(events.includes('revoke:analytics'));
    console.log('[3/4] 脚本门禁 OK, 事件:', events.join(','));

    // ---------- 测试 4：同意有效期 / 版本失效 / CCPA 默认允许与 opt-out ----------
    const stale = makeConsent('gdpr', ['analytics'], now - CONSENT_TTL_MS - 1);
    assert.equal(hasValidConsent(stale, 'gdpr', now), false, '超过 180 天需重新征询');
    const oldPolicy = makeConsent('gdpr', ['marketing'], now - 1000, 1);
    assert.equal(hasValidConsent(oldPolicy, 'gdpr', now), false, '隐私政策版本变更使旧同意失效');
    assert.equal(categoryAllowed('marketing', 'gdpr', oldPolicy, now), false);
    assert.equal(categoryAllowed('marketing', 'ccpa', null, now), true, 'CCPA 默认允许出售/共享');
    assert.equal(categoryAllowed('marketing', 'ccpa', null, now, true), false, 'GPC 等同 opt-out');
    const optedOut = makeConsent('ccpa', ['analytics'], now);
    assert.equal(categoryAllowed('marketing', 'ccpa', optedOut, now), false, '明确 opt-out 后禁止营销');
    assert.equal(categoryAllowed('analytics', 'ccpa', optedOut, now), true, 'analytics 不受出售定义影响');
    console.log('[4/4] 同意有效期/CCPA OK, 过期记录有效?', hasValidConsent(stale, 'gdpr', now));

    console.log('\n✅ 115-04 Cookie 同意决策 全部断言通过');
}

runAssertions();
