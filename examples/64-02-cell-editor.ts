/** 64-02-cell-editor.ts —— 可编辑表格：单元格编辑状态机 + 脏检查 + Excel 式粘贴填充解析 */

// --- 单元格状态机：view → editing → validating → saving → view ---
// 非法迁移直接抛错（如 saving 中再进 editing）
type CellState = "view" | "editing" | "validating" | "saving" | "error";
const TRANSITIONS: Record<CellState, CellState[]> = {
  view: ["editing"],
  editing: ["validating", "view"], // 提交校验 or Esc 取消
  validating: ["saving", "error"],
  saving: ["view", "error"],
  error: ["editing", "view"], // 修改重试 or 放弃
};
function transition(from: CellState, to: CellState): CellState {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`非法迁移: ${from} → ${to}`);
  }
  return to;
}

// --- 脏检查与增量提交：只提交被改过的单元格 ---
interface CellKey {
  row: number;
  col: string;
}
class DirtyTracker {
  private original = new Map<string, unknown>(); // "row:col" → 原始值
  private draft = new Map<string, unknown>();
  setOriginal(key: CellKey, value: unknown) {
    const k = `${key.row}:${key.col}`;
    if (!this.original.has(k)) this.original.set(k, value);
  }
  setDraft(key: CellKey, value: unknown) {
    const k = `${key.row}:${key.col}`;
    this.setOriginal(key, this.original.get(k)); // 首次编辑时快照原值
    this.draft.set(k, value);
  }
  dirtyEntries(): { key: CellKey; value: unknown }[] {
    const out: { key: CellKey; value: unknown }[] = [];
    for (const [k, v] of this.draft) {
      if (!Object.is(this.original.get(k), v)) {
        const [row, col] = k.split(":");
        out.push({ key: { row: Number(row), col }, value: v });
      }
    }
    return out; // 改回原值的格子不算脏（A→B→A 不提交）
  }
  commit() {
    // 提交成功后：草稿转正,基线推进
    for (const [k, v] of this.draft) this.original.set(k, v);
    this.draft.clear();
  }
  rollback() {
    this.draft.clear();
  }
}

// --- Excel 式粘贴：TSV 解析 + 目标区域填充 ---
// 剪贴板文本是制表符分隔列、换行分隔行
function parseTSV(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n") // Windows/Mac 换行归一
    .replace(/\n$/, "") // 末尾换行是复制器带的,不是空行
    .split("\n")
    .map((line) => line.split("\t"));
}
// 从锚点单元格开始按矩形填充,返回受影响的格子键;越界行数可扩展、列越界截断
function pasteRegion(opts: {
  anchor: CellKey;
  data: string[][];
  maxCol: string[]; // 列定义,决定横向边界
  rowCount: number;
  extendRows?: boolean; // 行不够时是否自动追加
}): CellKey[] {
  const { anchor, data, maxCol, extendRows = false } = opts;
  const colIdx = maxCol.indexOf(anchor.col);
  if (colIdx === -1) throw new Error("锚点列不存在");
  const affected: CellKey[] = [];
  data.forEach((rowCells, r) => {
    const targetRow = anchor.row + r;
    if (targetRow >= opts.rowCount && !extendRows) return; // 行越界且不扩展 → 截断
    rowCells.forEach((_, c) => {
      const targetCol = maxCol[colIdx + c];
      if (targetCol === undefined) return; // 列越界截断
      affected.push({ row: targetRow, col: targetCol });
    });
  });
  return affected;
}

// ---- 断言 ----
// 状态机
console.assert(transition("view", "editing") === "editing", "进入编辑");
console.assert(transition("editing", "validating") === "validating", "提交校验");
console.assert(transition("validating", "saving") === "saving", "校验通过保存");
console.assert(transition("saving", "view") === "view", "保存完成回视图");
console.assert(transition("error", "editing") === "editing", "错误后修改重试");
let illegal = false;
try {
  transition("saving", "editing");
} catch {
  illegal = true;
}
console.assert(illegal, "saving 中禁止再进 editing");

// 脏检查
const dt = new DirtyTracker();
dt.setOriginal({ row: 0, col: "price" }, 100);
dt.setDraft({ row: 0, col: "price" }, 120);
dt.setDraft({ row: 1, col: "name" }, "新名");
console.assert(dt.dirtyEntries().length === 2, "两处修改都脏");
dt.setDraft({ row: 0, col: "price" }, 100); // 改回原值
console.assert(
  dt.dirtyEntries().length === 1 && dt.dirtyEntries()[0].key.col === "name",
  "A→B→A 不算脏",
);
dt.commit();
console.assert(dt.dirtyEntries().length === 0, "提交后基线推进,无脏数据");
dt.setDraft({ row: 1, col: "name" }, "又改");
dt.rollback();
console.assert(dt.dirtyEntries().length === 0, "回滚清空草稿");

// TSV 粘贴
const grid = parseTSV("a1\tb1\r\na2\tb2\n");
console.assert(
  JSON.stringify(grid) === '[["a1","b1"],["a2","b2"]]',
  "TSV 解析：CRLF 归一 + 末尾换行剥离",
);
const cells = pasteRegion({
  anchor: { row: 1, col: "b" },
  data: grid,
  maxCol: ["a", "b", "c"],
  rowCount: 2,
  extendRows: true,
});
console.assert(
  cells.length === 4 &&
    cells.some((k) => k.row === 2 && k.col === "c") &&
    cells.some((k) => k.row === 1 && k.col === "b"),
  "锚点矩形填充：行扩展 + 列顺延",
);
const clipped = pasteRegion({
  anchor: { row: 1, col: "b" },
  data: grid,
  maxCol: ["a", "b", "c"],
  rowCount: 2,
});
console.assert(clipped.length === 2 && clipped.every((k) => k.row === 1), "不扩展时行越界截断");

console.log("✅ 编辑状态机 / 脏检查 / TSV 粘贴填充全部通过");
