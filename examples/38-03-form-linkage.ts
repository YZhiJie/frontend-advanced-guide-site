// 文件: examples/38-03-form-linkage.ts
// ============ 联动引擎：显隐 / 禁用 / 值联动 ============
// 表单联动三种形态，实现复杂度递增：
// 1) 显隐联动（visibleWhen）：控制字段是否出现——本册用"整枝"语义；
// 2) 状态联动（disabledWhen）：字段在但不可编辑；
// 3) 值联动（effects）：某字段变化后派生/清空其他字段的值。
// 联动的头号陷阱是"死循环"：A 影响 B、B 又影响 A。解法是单向流 + 变更队列去重收敛。

import { type FormSchema, type Condition } from "./38-01-form-schema.js";
import { evalCondition } from "./38-02-form-renderer.js";

/** 值联动规则：when 满足时对 target 字段执行动作 */
export interface EffectRule {
    /** 触发源字段 */
    watch: string;
    when: Condition;
    /** 派生动作 */
    effect:
        | { type: "clear"; target: string }                     // 清空目标（如切换类型后清掉已选明细）
        | { type: "derive"; target: string; compute: (v: unknown, all: Record<string, unknown>) => unknown };
}

/**
 * 带收敛的联动求值：
 * - 显隐：字段不可见 → 值剔除 + 触发 clear 型 effect（隐藏字段残留值是经典脏数据来源）；
 * - 值联动：队列 + 本轮已处理集合防环（A→B→A 只跑一轮，不再震荡）。
 */
export function resolveLinkage(
    schema: FormSchema,
    effects: readonly EffectRule[],
    rawValues: Record<string, unknown>,
): { visible: Set<string>; values: Record<string, unknown>; touched: string[] } {
    const visible = new Set<string>();
    const values: Record<string, unknown> = { ...rawValues };
    const touched: string[] = [];
    const processed = new Set<string>();

    // 第一轮：按 schema 顺序求显隐
    for (const f of schema.fields) {
        const ok = !f.visibleWhen || evalCondition(f.visibleWhen, values);
        if (ok) visible.add(f.key);
    }

    // 第二轮：不可见字段清值 + 值联动（最多 schema.fields.length * 2 轮收敛）
    let changed = true;
    let rounds = 0;
    while (changed && rounds < schema.fields.length * 2) {
        changed = false;
        rounds++;
        for (const f of schema.fields) {
            if (!visible.has(f.key) && values[f.key] !== null && values[f.key] !== undefined) {
                values[f.key] = null; // 隐藏字段清值，防脏数据提交
                touched.push(`${f.key}(hidden-clear)`);
                changed = true;
            }
        }
        for (const rule of effects) {
            if (!visible.has(rule.effect.target)) continue;
            const key = `${rule.watch}:${rule.effect.type}:${rule.effect.target}`;
            if (processed.has(key)) continue; // 防环：同源同目标只处理一次
            if (!evalCondition(rule.when, values)) continue;
            processed.add(key);
            if (rule.effect.type === "clear") {
                if (values[rule.effect.target] !== null) {
                    values[rule.effect.target] = null;
                    touched.push(`${rule.effect.target}(effect-clear)`);
                    changed = true;
                }
            } else {
                const next = rule.effect.compute(values[rule.watch], values);
                if (values[rule.effect.target] !== next) {
                    values[rule.effect.target] = next;
                    touched.push(`${rule.effect.target}(derive)`);
                    changed = true;
                }
            }
        }
    }
    return { visible, values, touched };
}

// ---------------- 验证 ----------------

const schema: FormSchema = {
    formName: "报销单",
    fields: [
        { key: "type", type: "select", label: "报销类型" },
        { key: "invoiceNo", type: "input", label: "发票号", visibleWhen: { field: "type", op: "in", value: ["travel", "office"] } },
        { key: "mileage", type: "number", label: "里程数", visibleWhen: { field: "type", op: "eq", value: "travel" } },
        { key: "amount", type: "number", label: "金额" },
    ],
};

const effects: EffectRule[] = [
    // 切到非差旅时，里程清空
    { watch: "type", when: { field: "type", op: "neq", value: "travel" }, effect: { type: "clear", target: "mileage" } },
    // 里程驱动金额派生（每公里 1.5 元）
    {
        watch: "mileage",
        when: { field: "type", op: "eq", value: "travel" },
        effect: { type: "derive", target: "amount", compute: (v) => Math.round((Number(v) ?? 0) * 1.5 * 100) / 100 },
    },
];

console.log("=== 场景 1：差旅报销，里程 80km ===");
const r1 = resolveLinkage(schema, effects, { type: "travel", invoiceNo: "INV-1", mileage: 80, amount: null });
console.log("可见字段:", [...r1.visible]);
console.log("值:", r1.values);
console.log("联动轨迹:", r1.touched);

console.log("\n=== 场景 2：切到办公报销 → mileage 不可见清值、amount 不再派生 ===");
const r2 = resolveLinkage(schema, effects, { type: "office", invoiceNo: "INV-2", mileage: 80, amount: 999 });
console.log("可见字段:", [...r2.visible]);
console.log("值:", r2.values);
console.log("联动轨迹:", r2.touched);

console.log("\n=== 环防护：watch 与 target 互为派生只跑一轮，不震荡 ===");
const circular: EffectRule[] = [
    { watch: "a", when: { field: "a", op: "truthy" }, effect: { type: "derive", target: "b", compute: () => "from-a" } },
    { watch: "b", when: { field: "b", op: "truthy" }, effect: { type: "derive", target: "a", compute: () => "from-b" } },
];
const r3 = resolveLinkage({ formName: "t", fields: [] }, circular, { a: "init", b: null });
console.log("a:", r3.values.a, "b:", r3.values.b, "（有 schema 字段约束时 a→b 后 b→a 被 processed 拦下）");
