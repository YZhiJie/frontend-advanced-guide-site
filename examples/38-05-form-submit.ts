// 文件: examples/38-05-form-submit.ts
// ============ 提交管道：裁剪 → 校验 → 脏检查 → 草稿 ============
// Schema 表单的提交不是"拿 values 发请求"，而是一条固定管道：
//   ① 显隐裁剪：不可见字段从提交体剔除（38-03 已清值，这里双保险）
//   ② 全量校验：有错则终止并聚焦第一个错误字段
//   ③ 脏检查：与初始快照对比，只提交变更字段（可按业务选全量/增量）
//   ④ 草稿恢复：localStorage 快照 + 版本号（schema 变更后旧草稿作废）
// 管道每一步都是纯函数，可单测、可组合。

import { type FormSchema } from "./38-01-form-schema.js";
import { evalCondition } from "./38-02-form-renderer.js";
import { validateForm } from "./38-04-form-validation.js";

/** ① 裁剪：只保留当前可见字段 */
export function pruneInvisible(
  schema: FormSchema,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (!f.visibleWhen || evalCondition(f.visibleWhen, values)) {
      out[f.key] = values[f.key];
    }
  }
  return out;
}

/** ③ 脏检查：返回发生变化的字段与增量体 */
export function diffValues(
  initial: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(current)) {
    if (JSON.stringify(initial[k]) !== JSON.stringify(current[k]))
      patch[k] = current[k];
  }
  return patch;
}

/** ④ 草稿：版本化的 localStorage 快照（schema 改版后旧草稿自动作废） */
const DRAFT_PREFIX = "form-draft:";

export function saveDraft(
  schemaVersion: string,
  formName: string,
  values: Record<string, unknown>,
): void {
  localStorage.setItem(
    `${DRAFT_PREFIX}${formName}`,
    JSON.stringify({ schemaVersion, values, savedAt: Date.now() }),
  );
}

export function loadDraft(
  schemaVersion: string,
  formName: string,
):
  | { ok: true; values: Record<string, unknown>; savedAt: number }
  | { ok: false; reason: "none" | "stale" } {
  const raw =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(`${DRAFT_PREFIX}${formName}`)
      : null;
  if (!raw) return { ok: false, reason: "none" };
  const draft = JSON.parse(raw) as {
    schemaVersion: string;
    values: Record<string, unknown>;
    savedAt: number;
  };
  if (draft.schemaVersion !== schemaVersion)
    return { ok: false, reason: "stale" };
  return { ok: true, values: draft.values, savedAt: draft.savedAt };
}

/** 完整提交管道 */
export type SubmitResult =
  | { ok: true; body: Record<string, unknown>; patch: Record<string, unknown> }
  | { ok: false; stage: "validate"; errors: Record<string, string[]> }
  | { ok: false; stage: "empty" };

export function submitForm(
  schema: FormSchema,
  initial: Record<string, unknown>,
  current: Record<string, unknown>,
  mode: "full" | "patch" = "full",
): SubmitResult {
  const pruned = pruneInvisible(schema, current);
  const errors = validateForm(schema, current); // 校验用全量值（联动条件依赖完整上下文）
  if (Object.keys(errors).length > 0)
    return { ok: false, stage: "validate", errors };

  const patch = diffValues(initial, pruned);
  if (mode === "patch" && Object.keys(patch).length === 0)
    return { ok: false, stage: "empty" };
  return { ok: true, body: mode === "patch" ? patch : pruned, patch };
}

// ---------------- 验证（用内存 stub 模拟 localStorage） ----------------

const store = new Map<string, string>();
const localStorageStub = {
  setItem: (k: string, v: string) => void store.set(k, v),
  getItem: (k: string) => store.get(k) ?? null,
};
// eslint-disable-next-line
(globalThis as Record<string, unknown>).localStorage = localStorageStub;

const schema: FormSchema = {
  formName: "请假申请",
  fields: [
    { key: "name", type: "input", label: "姓名", required: true },
    { key: "days", type: "number", label: "天数", required: true },
    {
      key: "proxy",
      type: "input",
      label: "代理人",
      visibleWhen: { field: "days", op: "gt", value: 3 },
    },
  ],
};

console.log("=== 校验拦截 ===");
const r1 = submitForm(schema, { name: "", days: 1 }, { name: "", days: 1 });
console.log(r1);

console.log("\n=== 隐藏字段被裁剪 ===");
const r2 = submitForm(
  schema,
  { name: "李四", days: 1 },
  { name: "李四", days: 1, proxy: "幽灵值" },
);
console.log("提交体:", r2.ok ? r2.body : r2); // proxy 不在提交体里

console.log("\n=== 增量模式：脏检查 ===");
const initial = { name: "李四", days: 1 };
const current = { name: "李四", days: 5, proxy: "e002" };
const r3 = submitForm(schema, initial, current, "patch");
console.log("patch:", r3.ok ? r3.body : r3);

console.log("\n=== 草稿保存与版本作废 ===");
saveDraft("v3", "请假申请", current);
const d1 = loadDraft("v3", "请假申请");
console.log("同版本恢复:", d1.ok ? { savedAt: d1.savedAt } : d1);
saveDraft("v2", "请假申请", current);
const d2 = loadDraft("v3", "请假申请");
console.log("schema 升级后:", d2.ok ? "意外恢复" : d2.reason); // stale → 旧草稿作废
