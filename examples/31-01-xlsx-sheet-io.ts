// 文件: examples/31-01-xlsx-sheet-io.ts
// ============ SheetJS 三层模型：AoA ↔ 对象数组 ↔ 工作簿 ↔ 字节流 ============
// 对应 31.1「入门：工作簿三层模型」与 31.2「对象数组与工作表」：
// - aoa_to_sheet / sheet_to_json 的两种视角（对象数组、矩阵）互转；
// - 多 Sheet 工作簿写成字节流再读回，日期走 cellDates 往返仍是 Date；
// - 用 !ref 与公式单元格 .f 验证「范围是假设、公式是独立字段」。

import * as XLSX from "xlsx";

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// 1) AoA → 工作表 → 两种读法
const aoa = [
  ["姓名", "年龄"],
  ["张三", 30],
];
const sheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
const objects = XLSX.utils.sheet_to_json<{ 姓名: string; 年龄: number }>(sheet, {
  defval: null,
  raw: true,
});
const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
console.log("对象视角：", objects[0]?.["姓名"], objects[0]?.["年龄"], "| 矩阵视角：", matrix[1]?.[0], matrix[1]?.[1]);
assert(objects[0]?.["姓名"] === "张三", "对象数组应按表头行作为键");
assert(matrix[1]?.[1] === 30, "矩阵视角应保留行下标");

// 2) 公式与范围：!ref 只是范围假设，公式存在 .f 字段
const formulaSheet = XLSX.utils.aoa_to_sheet([["数值", "翻倍"]]);
formulaSheet["A2"] = { t: "n", v: 128 };
formulaSheet["B2"] = { t: "n", v: 128, f: "A2*2" };
console.log("范围：", formulaSheet["!ref"], "| B2：", formulaSheet["B2"]?.t, formulaSheet["B2"]?.v, formulaSheet["B2"]?.f);
assert(formulaSheet["B2"]?.f === "A2*2", "公式必须落在独立字段 .f");

// 3) 多 Sheet 工作簿 → 字节流 → 读回
const detailRows = [
  { 订单号: "A-001", 金额: 128, 下单时间: new Date(2026, 9, 20, 10, 30) },
  { 订单号: "A-002", 金额: 256, 下单时间: null },
];
const detailSheet = XLSX.utils.json_to_sheet(detailRows, {
  header: ["订单号", "金额", "下单时间"],
  skipHeader: false,
  cellDates: true,
});
const noteSheet = XLSX.utils.aoa_to_sheet([["版本", "生成时间"], ["v1", "2026-10-21"]]);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, detailSheet, "明细");
XLSX.utils.book_append_sheet(workbook, noteSheet, "说明");
const bytes = XLSX.write(workbook, {
  type: "buffer",
  bookType: "xlsx",
  cellDates: true,
  compression: true,
}) as Buffer;
console.log("工作表名：", workbook.SheetNames.join(", "), "| 字节数：", bytes.length);

const reloaded = XLSX.read(bytes, { type: "buffer", cellDates: true });
const detailBack = XLSX.utils.sheet_to_json<{ 订单号: string; 金额: number; 下单时间: Date | null }>(
  reloaded.Sheets["明细"]!,
  { defval: null, raw: true },
);
console.log("读回金额：", detailBack[0]?.["金额"], "| 时间类型是 Date：", detailBack[0]?.["下单时间"] instanceof Date);
assert(reloaded.SheetNames.length === 2, "读回应保留两张工作表");
assert(detailBack[0]?.["金额"] === 128, "数值往返必须无损");
assert(detailBack[0]?.["下单时间"] instanceof Date, "cellDates 下日期往返应仍是 Date");
assert(detailBack[1]?.["下单时间"] === null, "空单元格应补 null 而不是 undefined");

// 4) CSV 导出：公式注入前缀必须中和，BOM + CRLF 保证 Excel 识别
const csvRows = [{ 备注: "=HYPERLINK(\"http://evil\")", 金额: 128 }];
const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(csvRows), {
  FS: ",",
  RS: "\r\n",
  strip: true,
});
assert(csv.includes("=HYPERLINK"), "sheet_to_csv 原样保留公式开头的文本（中和需业务层前置单引号）");
console.log("CSV 首行：", csv.split("\r\n")[0]);

console.log("✓ 31-01 SheetJS 三层模型断言全部通过");
