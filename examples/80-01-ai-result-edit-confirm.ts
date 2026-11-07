// 文件: examples/80-01-ai-result-edit-confirm.ts
// ============ AI 生成结果：编辑/确认/保存 全流程 ============
// 对应 JD「AI 生成结果编辑、确认、保存」要求。
// 结果状态机 + 字段级 diff + 批量确认 + 版本快照，硬断言直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 结果状态机 ----------------
// draft(AI 生成) → reviewing(用户编辑中) → confirmed(确认) → saved(入库)
// rejected 回到 reviewing 让用户改，saved 是终态

export type ResultStatus = "draft" | "reviewing" | "confirmed" | "rejected" | "saved";

export const RESULT_TRANSITIONS: Readonly<Record<ResultStatus, readonly ResultStatus[]>> = {
  draft: ["reviewing", "rejected"],
  reviewing: ["confirmed", "rejected"],
  confirmed: ["saved", "reviewing"], // 确认后仍可撤回编辑
  rejected: ["reviewing"],
  saved: [],
};

export function canResultTransition(from: ResultStatus, to: ResultStatus): boolean {
  return RESULT_TRANSITIONS[from].includes(to);
}

// ---------------- 2. 字段级编辑与 diff ----------------

export type FieldValue = string | number | boolean | null;

export interface AiResult {
  id: string;
  status: ResultStatus;
  fields: Record<string, FieldValue>;
  /** AI 原始产出，用于对比用户改了什么 */
  originalFields: Record<string, FieldValue>;
  version: number;
  updatedAt: number;
}

/** 返回被用户修改过的字段列表（与 original 对比） */
export function diffFields(result: AiResult): string[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(result.fields), ...Object.keys(result.originalFields)]);
  for (const k of keys) {
    if (result.fields[k] !== result.originalFields[k]) changed.push(k);
  }
  return changed;
}

/** 编辑字段：只允许在 reviewing 态修改 */
export function editField(result: AiResult, key: string, value: FieldValue): void {
  if (result.status !== "reviewing") {
    throw new Error(`只允许在 reviewing 态编辑字段，当前 ${result.status}`);
  }
  result.fields[key] = value;
  result.updatedAt = Date.now();
}

/** 还原单个字段到 AI 原始值 */
export function revertField(result: AiResult, key: string): void {
  if (result.status !== "reviewing") throw new Error("只允许在 reviewing 态还原");
  if (key in result.originalFields) {
    result.fields[key] = result.originalFields[key];
  } else {
    delete result.fields[key];
  }
}

// ---------------- 3. 批量确认 + 保存 ----------------

export interface ConfirmOptions {
  /** 需要用户显式确认的敏感字段（如金额、收件人），编辑后必须二次确认 */
  sensitiveFields: string[];
}

/** 检查是否所有敏感字段都已确认（敏感字段被编辑过时需要二次确认） */
export function needsReconfirm(result: AiResult, opts: ConfirmOptions): string[] {
  const changed = new Set(diffFields(result));
  return opts.sensitiveFields.filter((f) => changed.has(f));
}

/** 保存：写入版本快照，状态 → saved */
export function saveResult(result: AiResult): AiResult {
  if (result.status !== "confirmed") {
    throw new Error(`只允许保存 confirmed 状态的结果，当前 ${result.status}`);
  }
  result.status = "saved";
  result.version += 1;
  // 保存后 original 更新为当前值（下一轮编辑的对比基准）
  result.originalFields = { ...result.fields };
  result.updatedAt = Date.now();
  return result;
}

// ---------------- 4. 版本快照与回滚 ----------------

export interface VersionSnapshot {
  version: number;
  fields: Record<string, FieldValue>;
  savedAt: number;
}

/** 版本库：保存每次 saved 时的快照，支持回滚 */
export class ResultVersionStore {
  private snapshots: VersionSnapshot[] = [];

  commit(result: AiResult): void {
    this.snapshots.push({
      version: result.version,
      fields: { ...result.fields },
      savedAt: result.updatedAt,
    });
  }

  /** 回滚到指定版本，返回新的 fields（需要重新走 reviewing→confirmed→saved） */
  rollback(version: number): Record<string, FieldValue> | null {
    const snap = this.snapshots.find((s) => s.version === version);
    return snap ? { ...snap.fields } : null;
  }

  list(): VersionSnapshot[] {
    return [...this.snapshots].reverse();
  }
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 结果状态机：draft → reviewing → confirmed → saved =====");
  let result: AiResult = {
    id: "r1",
    status: "draft",
    fields: { name: "张三", amount: 1000, email: "zhang@example.com" },
    originalFields: { name: "张三", amount: 1000, email: "zhang@example.com" },
    version: 0,
    updatedAt: Date.now(),
  };

  // draft 不能直接 save
  let threw = false;
  try { saveResult(result); } catch { threw = true; }
  assert(threw, "draft 状态不允许直接保存");

  // 正常流转
  result.status = "reviewing";
  editField(result, "amount", 1500); // 用户改了金额
  editField(result, "email", "zhang-new@example.com");
  assert(diffFields(result).length === 2, `应有 2 个字段被修改，实际 ${diffFields(result).length}`);
  console.log(`✓ 用户编辑了 ${diffFields(result).length} 个字段: ${diffFields(result).join(", ")}`);

  // 敏感字段被改 → 需要二次确认
  const opts: ConfirmOptions = { sensitiveFields: ["amount", "recipient"] };
  const needConfirm = needsReconfirm(result, opts);
  assert(needConfirm.length === 1 && needConfirm[0] === "amount", "金额被改应触发二次确认");
  console.log(`✓ 敏感字段被改 → 需二次确认: ${needConfirm.join(", ")}`);

  // 还原邮箱
  revertField(result, "email");
  assert(diffFields(result).length === 1, "还原后只剩 1 个字段被改");
  console.log("✓ 还原 email 后，只剩 amount 被修改");

  result.status = "confirmed";
  saveResult(result);
  assert(result.status === "saved", "保存后状态应为 saved");
  assert(result.version === 1, "保存后版本 +1");
  console.log(`✓ 已保存，版本号 ${result.version}`);

  console.log("\n===== 2. 版本快照与回滚 =====");
  const store = new ResultVersionStore();
  store.commit(result); // v1

  // 再编辑一轮
  result.status = "reviewing";
  result.originalFields = { ...result.fields };
  editField(result, "amount", 2000);
  result.status = "confirmed";
  saveResult(result);
  store.commit(result); // v2
  assert(result.version === 2, "第二次保存版本为 2");

  // 回滚到 v1
  const v1 = store.rollback(1);
  assert(v1 !== null && v1.amount === 1500, `回滚 v1 的 amount 应为 1500，实际 ${v1?.amount}`);
  console.log(`✓ 回滚到 v1，amount = ${v1?.amount}`);

  // 版本列表倒序
  const list = store.list();
  assert(list.length === 2 && list[0].version === 2, "版本列表按倒序排列");
  console.log(`✓ 版本库共 ${list.length} 个快照，最新 v${list[0].version}`);

  console.log("\n===== 3. 拒绝回退 =====");
  result.status = "reviewing";
  result.status = "rejected";
  // rejected 必须先回到 reviewing 才能再确认
  assert(canResultTransition("rejected", "reviewing") === true, "rejected 可回到 reviewing");
  assert(canResultTransition("rejected", "confirmed") === false, "rejected 不能直接 confirmed");
  console.log("✓ rejected → reviewing → confirmed 必须两步走");

  console.log("\n✅ AI 结果编辑/确认/保存 + 版本回滚全部断言通过");
}

main();
