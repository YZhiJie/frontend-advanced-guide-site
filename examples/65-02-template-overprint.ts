/** 65-02-template-overprint.ts —— 套打模板引擎：字段坐标映射 + mm 定位 + 数据填充 + 越界检测 */

// 套打场景：在预印制单据（发票/快递单/证书）的指定位置精准落字
// 模板用 mm 坐标定义字段框,数据填充时逐字段渲染到绝对定位层

interface FieldBox {
  key: string;
  xMm: number; // 距纸张左缘
  yMm: number; // 距纸张上缘
  wMm: number;
  hMm: number;
  fontSizePt?: number;
  align?: "left" | "center" | "right";
  maxChars?: number; // 超长截断（套打框是物理边界,溢出会压到下一个印刷区）
  format?: (v: unknown) => string; // 字段格式化（日期/金额大写）
}
interface Template {
  paper: { widthMm: number; heightMm: number };
  fields: FieldBox[];
}

// 模板自检：所有字段框必须在纸张内,不得互相重叠（重叠=印刷事故）
function validateTemplate(t: Template): string[] {
  const errors: string[] = [];
  for (const f of t.fields) {
    if (f.xMm < 0 || f.yMm < 0) errors.push(`${f.key}: 坐标为负`);
    if (f.xMm + f.wMm > t.paper.widthMm) errors.push(`${f.key}: 横向越界`);
    if (f.yMm + f.hMm > t.paper.heightMm) errors.push(`${f.key}: 纵向越界`);
    if (f.maxChars !== undefined && f.maxChars <= 0) errors.push(`${f.key}: maxChars 必须为正`);
  }
  // 两两重叠检测（矩形相交）
  for (let i = 0; i < t.fields.length; i++) {
    for (let j = i + 1; j < t.fields.length; j++) {
      const a = t.fields[i];
      const b = t.fields[j];
      const overlap =
        a.xMm < b.xMm + b.wMm && b.xMm < a.xMm + a.wMm &&
        a.yMm < b.yMm + b.hMm && b.yMm < a.yMm + a.hMm;
      if (overlap) errors.push(`${a.key} 与 ${b.key} 坐标重叠`);
    }
  }
  return errors;
}

// 数据填充：逐字段取值 → 格式化 → 截断 → 输出定位渲染指令
interface RenderCmd {
  key: string;
  text: string;
  xMm: number;
  yMm: number;
  align: "left" | "center" | "right";
  fontSizePt: number;
  truncated: boolean; // 被截断的字段要标记,打印预览时高亮警告
}
function renderTemplate(
  t: Template,
  data: Record<string, unknown>,
): { cmds: RenderCmd[]; missing: string[] } {
  const cmds: RenderCmd[] = [];
  const missing: string[] = [];
  for (const f of t.fields) {
    const raw = data[f.key];
    if (raw === undefined || raw === null) {
      missing.push(f.key); // 缺数据字段：不渲染空串,记录待人工确认
      continue;
    }
    let text = f.format ? f.format(raw) : String(raw);
    let truncated = false;
    if (f.maxChars !== undefined && text.length > f.maxChars) {
      text = text.slice(0, f.maxChars);
      truncated = true;
    }
    cmds.push({
      key: f.key,
      text,
      xMm: f.xMm,
      yMm: f.yMm,
      align: f.align ?? "left",
      fontSizePt: f.fontSizePt ?? 10.5, // 五号字是中文单据默认
      truncated,
    });
  }
  return { cmds, missing };
}

// ---- 断言 ----
const invoiceTpl: Template = {
  paper: { widthMm: 210, heightMm: 140 },
  fields: [
    { key: "title", xMm: 85, yMm: 10, wMm: 40, hMm: 8, align: "center", fontSizePt: 16 },
    { key: "no", xMm: 160, yMm: 12, wMm: 40, hMm: 6 },
    { key: "amount", xMm: 50, yMm: 80, wMm: 60, hMm: 8, format: (v) => `¥${Number(v).toFixed(2)}` },
    { key: "buyer", xMm: 30, yMm: 30, wMm: 80, hMm: 6, maxChars: 20 },
  ],
};
console.assert(validateTemplate(invoiceTpl).length === 0, "合法模板零错误");

const badTpl: Template = {
  paper: { widthMm: 100, heightMm: 100 },
  fields: [
    { key: "a", xMm: 90, yMm: 10, wMm: 20, hMm: 10 }, // 横向越界
    { key: "b", xMm: 10, yMm: 10, wMm: 30, hMm: 10 },
    { key: "c", xMm: 25, yMm: 15, wMm: 30, hMm: 10 }, // 与 b 重叠
  ],
};
const errs = validateTemplate(badTpl);
console.assert(
  errs.some((e) => e.includes("横向越界")) && errs.some((e) => e.includes("重叠")),
  "越界与重叠均被检出",
);

// 填充：格式化 + 截断 + 缺数检测
const { cmds, missing } = renderTemplate(invoiceTpl, {
  title: "增值税专用发票",
  no: "INV-2026-1028",
  amount: 1234.5,
  buyer: "这是一个非常非常长的购货单位名称需要被截断处理了", // 22 字 > maxChars 20
});
console.assert(cmds.find((c) => c.key === "amount")!.text === "¥1234.50", "金额格式化");
const buyer = cmds.find((c) => c.key === "buyer")!;
console.assert(buyer.text.length === 20 && buyer.truncated, "超长截断并标记");
console.assert(cmds.find((c) => c.key === "title")!.align === "center", "对齐随模板");

const r2 = renderTemplate(invoiceTpl, { title: "测试" });
console.assert(
  r2.missing.join() === "no,amount,buyer" && r2.cmds.length === 1,
  "缺数据字段记入 missing 不渲染空串",
);

console.log("✅ 模板自检 / 越界重叠检测 / 格式化截断 / 缺数检测全部通过");
