// 文件: examples/120-04-delivery-frequency.ts
// 投放频控：人群命中 + 频次上限 + 时间窗口 + 预算扣减（含曝光幂等）
// 目标：不该投的人不投、投够次数就停、超窗/超预算即拒，重复曝光不重复扣预算

import assert from 'node:assert';

interface UserProfile {
    id: string;
    country: string;
    tier: 'new' | 'active' | 'loyal';
    tags: string[];
}

interface AudienceRule {
    countries: string[];
    tiers: UserProfile['tier'][];
    /** 任一标签命中即算命中（OR 语义），空数组表示不限 */
    anyTags: string[];
}

function matchAudience(user: UserProfile, rule: AudienceRule): boolean {
    if (!rule.countries.includes(user.country)) return false;
    if (!rule.tiers.includes(user.tier)) return false;
    if (rule.anyTags.length > 0 && !rule.anyTags.some((tag) => user.tags.includes(tag))) return false;
    return true;
}

interface CampaignConfig {
    /** 活动起止时间，单位：分钟（演示用，真实项目用 UTC 时间戳） */
    startMinute: number;
    endMinute: number;
    /** 每日可投放时段，左闭右开，如 9 点 ~ 22 点 */
    dailyStartHour: number;
    dailyEndHour: number;
    /** 单用户每天最多曝光次数 */
    maxPerDay: number;
    /** 活动总预算可承载的曝光次数 */
    budget: number;
    audience: AudienceRule;
}

type DecisionReason = 'ok' | 'audience' | 'window' | 'frequency' | 'budget' | 'duplicate';

interface Decision {
    served: boolean;
    reason: DecisionReason;
    /** 幂等重放时返回首次结论，便于上游重试 */
    duplicate?: boolean;
}

const DAY_MINUTES = 24 * 60;

/** 投放闸门：所有状态都在服务端，前端只展示结论 */
class DeliveryGate {
    private readonly dayCount = new Map<string, number>(); // `${userId}:${day}` -> 已曝光次数
    private readonly seen = new Map<string, Decision>(); // impressionId -> 首次结论
    private remainingBudget: number;

    constructor(private readonly config: CampaignConfig) {
        this.remainingBudget = config.budget;
    }

    get budgetLeft(): number {
        return this.remainingBudget;
    }

    decide(user: UserProfile, nowMinute: number, impressionId: string): Decision {
        const cached = this.seen.get(impressionId);
        if (cached) return { ...cached, duplicate: true };
        const decision = this.evaluate(user, nowMinute);
        this.seen.set(impressionId, decision);
        if (decision.served) this.remainingBudget -= 1;
        return decision;
    }

    private evaluate(user: UserProfile, nowMinute: number): Decision {
        if (!matchAudience(user, this.config.audience)) return { served: false, reason: 'audience' };
        const { startMinute, endMinute, dailyStartHour, dailyEndHour, maxPerDay } = this.config;
        if (nowMinute < startMinute || nowMinute >= endMinute) return { served: false, reason: 'window' };
        const minuteOfDay = nowMinute % DAY_MINUTES;
        const hour = Math.floor(minuteOfDay / 60);
        if (hour < dailyStartHour || hour >= dailyEndHour) return { served: false, reason: 'window' };
        const day = Math.floor(nowMinute / DAY_MINUTES);
        const key = `${user.id}:${day}`;
        const used = this.dayCount.get(key) ?? 0;
        if (used >= maxPerDay) return { served: false, reason: 'frequency' };
        if (this.remainingBudget <= 0) return { served: false, reason: 'budget' };
        // 先扣额度再曝光：宁可少投一次，不可超发一次
        this.dayCount.set(key, used + 1);
        return { served: true, reason: 'ok' };
    }
}

const config: CampaignConfig = {
    startMinute: 0,
    endMinute: 30 * DAY_MINUTES, // 30 天活动
    dailyStartHour: 9,
    dailyEndHour: 22,
    maxPerDay: 3,
    budget: 100,
    audience: { countries: ['US', 'DE'], tiers: ['new', 'active'], anyTags: ['beauty', 'electronics'] },
};

const alice: UserProfile = { id: 'alice', country: 'US', tier: 'new', tags: ['electronics'] };
const bob: UserProfile = { id: 'bob', country: 'FR', tier: 'active', tags: ['beauty'] };
const carol: UserProfile = { id: 'carol', country: 'DE', tier: 'loyal', tags: ['beauty'] };

const atHour = (day: number, hour: number): number => day * DAY_MINUTES + hour * 60 + 1;

function runAssertions() {
    // ---------- 测试 1：人群命中——国家/分层/标签三重过滤 ----------
    assert.equal(matchAudience(alice, config.audience), true);
    assert.equal(matchAudience(bob, config.audience), false, '非目标国家应拒绝');
    assert.equal(matchAudience(carol, config.audience), false, 'loyal 不在目标分层');
    assert.equal(matchAudience({ ...carol, tier: 'active' }, config.audience), true, '改分层后应命中');
    assert.equal(matchAudience({ ...alice, tags: [] }, config.audience), false, '无命中标签应拒绝');
    const gate1 = new DeliveryGate(config);
    assert.equal(gate1.decide(bob, atHour(0, 10), 'imp_bob').reason, 'audience');
    assert.equal(gate1.budgetLeft, 100, '人群不匹配不得扣预算');
    console.log('[1/4] 人群命中 OK, 非目标人群未扣预算');

    // ---------- 测试 2：频次上限——单日 3 次后拒绝，次日恢复 ----------
    const gate2 = new DeliveryGate(config);
    const day0 = [10, 11, 12].map((hour, index) => gate2.decide(alice, atHour(0, hour), `imp_d0_${index}`));
    assert.deepEqual(day0.map((d) => d.reason), ['ok', 'ok', 'ok'], '前三次应放行');
    assert.equal(gate2.decide(alice, atHour(0, 13), 'imp_d0_3').reason, 'frequency');
    assert.equal(gate2.decide(alice, atHour(1, 10), 'imp_d1_0').reason, 'ok', '跨天后额度应重置');
    assert.equal(gate2.budgetLeft, 96, '只扣成功曝光的预算');
    console.log('[2/4] 频次上限 OK, 剩余预算:', gate2.budgetLeft);

    // ---------- 测试 3：时间窗口与预算耗尽 ----------
    const gate3 = new DeliveryGate({ ...config, budget: 2 });
    assert.equal(gate3.decide(alice, atHour(0, 8), 'imp_early').reason, 'window', '早于每日时段应拒绝');
    assert.equal(gate3.decide(alice, atHour(0, 23), 'imp_late').reason, 'window', '晚于每日时段应拒绝');
    assert.equal(gate3.decide(alice, atHour(0, 10), 'imp_ok_0').reason, 'ok');
    assert.equal(gate3.decide(alice, atHour(0, 11), 'imp_ok_1').reason, 'ok');
    assert.equal(gate3.decide(alice, atHour(0, 12), 'imp_ok_2').reason, 'budget', '预算耗尽须停投');
    assert.equal(gate3.budgetLeft, 0);
    const beforeStart = new DeliveryGate({ ...config, startMinute: 10 * DAY_MINUTES });
    assert.equal(beforeStart.decide(alice, atHour(0, 10), 'imp_too_early').reason, 'window');
    console.log('[3/4] 时间窗口与预算 OK, 预算归零后拒投');

    // ---------- 测试 4：曝光幂等——重试不重复扣预算，重放返回首次结论 ----------
    const gate4 = new DeliveryGate(config);
    const first = gate4.decide(alice, atHour(0, 10), 'imp_retry_1');
    assert.equal(first.reason, 'ok');
    const retry = gate4.decide(alice, atHour(0, 10), 'imp_retry_1');
    assert.equal(retry.reason, 'ok');
    assert.equal(retry.duplicate, true, '重复曝光须标记为幂等重放');
    assert.equal(gate4.budgetLeft, 99, '重试不得二次扣预算');
    const second = gate4.decide(alice, atHour(0, 11), 'imp_retry_2');
    assert.equal(second.reason, 'ok');
    assert.equal(gate4.budgetLeft, 98);
    console.log('[4/4] 曝光幂等 OK, 两次唯一曝光后预算:', gate4.budgetLeft);

    console.log('\n✅ 120-04 投放频控 全部断言通过');
}

runAssertions();
