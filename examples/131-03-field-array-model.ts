// 文件: examples/131-03-field-array-model.ts
// 131.6 数组字段：稳定 key、移动/删除、行级错误路径。
// 真实使用 zod@3.25 的行 schema 与数组 schema，npx tsx 实跑。
import assert from "node:assert/strict";
import { z } from "zod";

const RowSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "名称必填"),
  qty: z.coerce.number().int("数量必须是整数").positive("数量必须大于 0").max(999, "单行上限 999"),
});

const CartSchema = z.object({
  items: z.array(RowSchema).min(1, "至少保留一行"),
});

export type Row = z.input<typeof RowSchema>;
type RowOutput = z.output<typeof RowSchema>;

export interface FieldArrayState {
  ok: boolean;
  rows: Record<number, Record<string, string>>;
  form?: string;
  data?: { items: RowOutput[] };
}

/**
 * 数组字段模型：只做「数据 + 操作 + 校验」，不碰 DOM。
 * 真实库里对应 RHF 的 useFieldArray 与 VeeValidate 的 useFieldArray/FieldArray。
 */
export class FieldArrayModel {
  #rows: Row[] = [];
  #seq = 0;

  /** 稳定 key：只增不减，删除后也不会复用，避免 React 复用错行 */
  #nextId(): string {
    this.#seq += 1;
    return `row_${this.#seq}`;
  }

  append(init: Partial<Omit<Row, "id">> = {}): Row {
    const row: Row = { id: this.#nextId(), name: "", qty: 1, ...init };
    this.#rows.push(row);
    return row;
  }

  insert(index: number, init: Partial<Omit<Row, "id">> = {}): Row {
    const row: Row = { id: this.#nextId(), name: "", qty: 1, ...init };
    this.#rows.splice(index, 0, row);
    return row;
  }

  remove(index: number): void {
    this.#rows.splice(index, 1);
  }

  /** 与 arrayMove 同口径：from/to 都基于「移动前」的下标 */
  move(from: number, to: number): void {
    if (from === to) return;
    const size = this.#rows.length;
    if (from < 0 || from >= size || to < 0 || to >= size) return; // 越界忽略
    const [row] = this.#rows.splice(from, 1);
    this.#rows.splice(to, 0, row);
  }

  setValue(index: number, key: "name" | "qty", value: string): void {
    const row = this.#rows[index];
    if (!row) return;
    // 输入层保留字符串（用户正在输入 "1."），校验期再交给 z.coerce
    (row as Record<string, unknown>)[key] = value;
  }

  get rows(): Row[] {
    return this.#rows.map((r) => ({ ...r }));
  }

  keys(): string[] {
    return this.#rows.map((r) => r.id);
  }

  validate(): FieldArrayState {
    const parsed = CartSchema.safeParse({ items: this.#rows });
    if (parsed.success) return { ok: true, rows: {}, data: parsed.data };

    const rows: Record<number, Record<string, string>> = {};
    let form: string | undefined;
    for (const issue of parsed.error.issues) {
      const [head, index, ...rest] = issue.path;
      if (head !== "items" || typeof index !== "number") {
        // items 数组本身的错误（min(1)）没有数字下标
        if (head === "items") form = issue.message;
        continue;
      }
      const field = rest.join(".");
      rows[index] ??= {};
      if (!(field in rows[index])) rows[index][field] = issue.message;
    }
    return { ok: false, rows, form };
  }
}

// ---------------- 断言 ----------------
const cart = new FieldArrayModel();
const a = cart.append({ name: "键盘", qty: 2 });
const b = cart.append({ name: "鼠标", qty: 1 });
const c = cart.append({ name: "显示器", qty: 1 });
assert.deepEqual(cart.keys(), [a.id, b.id, c.id]);

// 1) 移动后 id 顺序变化，但 id 本身不重排、不重生
cart.move(0, 2);
assert.deepEqual(cart.keys(), [b.id, c.id, a.id]);
assert.deepEqual(cart.rows.map((r) => r.name), ["鼠标", "显示器", "键盘"]);
assert.equal(new Set(cart.keys()).size, 3, "key 全局唯一");

// 2) 删除中间行后，后续行的错误下标会「前移」，靠 id 定位行
cart.remove(1); // 删掉显示器
assert.deepEqual(cart.keys(), [b.id, a.id]);

// 3) 行级校验：错误挂在 items.<index>.<field>
cart.setValue(0, "name", "  ");
cart.setValue(1, "qty", "0");
const failed = cart.validate();
assert.equal(failed.ok, false);
assert.deepEqual(failed.rows[0], { name: "名称必填" });
assert.deepEqual(failed.rows[1], { qty: "数量必须大于 0" });
assert.equal(failed.form, undefined, "有行时不触发数组级错误");

// 4) 修好之后重新校验通过，且 coerce 生效
cart.setValue(0, "name", " 鼠标 ");
cart.setValue(1, "qty", "3");
const passed = cart.validate();
assert.equal(passed.ok, true);
assert.deepEqual(passed.data?.items.map((r) => [r.name, r.qty]), [["鼠标", 1], ["键盘", 3]]);
assert.equal(typeof passed.data?.items[1].qty, "number");

// 5) 空数组触发数组级错误，且不产生行错误
const empty = new FieldArrayModel();
const emptyResult = empty.validate();
assert.equal(emptyResult.ok, false);
assert.equal(emptyResult.form, "至少保留一行");
assert.deepEqual(emptyResult.rows, {});

// 6) 删除后新增：id 不复用，避免「删了第 2 行又新增，React 认为还是原来那行」
const before = cart.keys();
cart.remove(0);
const d = cart.append({ name: "耳机", qty: 1 });
assert.equal(before.includes(d.id), false, "新 id 不与历史 id 冲突");
assert.deepEqual(cart.keys(), [a.id, d.id]);

// 7) 越界操作安全：不抛错、不改数据
cart.move(5, 0);
cart.remove(99);
cart.setValue(99, "name", "x");
assert.deepEqual(cart.keys(), [a.id, d.id], "越界操作被忽略");

console.log("✓ 131-03 数组字段稳定 key、移动/删除与行级错误路径断言全部通过");
