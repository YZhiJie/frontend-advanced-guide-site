# EP.52 表格那三层模型

> 对应正文：[第三十一部分 · XLSX 表格工程](../31-xlsx.md)

## 剧情回顾

- **第 1 格**：标签君困惑——前端收到一份 Excel，直接 `XLSX.read(file)` 拿到数据，但是怎么把某个 sheet 里的一列改了再写回去？社区版 XLSX 不支持样式（背景色、字体），想做个好看的导出怎么办？还有 CSV 里藏着公式 `=HYPERLINK("https://evil.com", "click")`——这不是会被执行吗？
- **第 2 格**：码叔点破——XLSX 把 Excel 拆成三层：**Workbook（整个文件）→ Worksheet（每个 sheet）→ Cell（单元格）**。社区版只支持数据，样式、合并、图片在 `xlsx-js-style` 或 pro 版本里。安全红线：CSV/TSV 导出时要给所有以 `= + - @ \t \r` 开头的字符串加前缀 `'`，防公式注入。
- **第 3 格**：像素酱实测——`XLSX.read(file, { cellStyles: true, cellFormula: true })` 读取后，`workbook.Sheets['Sheet1']` 是一个 AoA（数组套数组）。`XLSX.utils.json_to_sheet(arrayOfObjects)` 能把 JSON 直接转 sheet，再 `XLSX.utils.book_append_sheet(wb, sheet, 'Sheet2')` 追加新 sheet，最后 `XLSX.writeFile(wb, 'output.xlsx')` 一口气下载。CSV 导出时加前缀过滤公式，用正则 `/^[=+-\@\t\r]/`。
- **第 4 格**：码叔结案——三个高频坑：大数据量用 Worker 分片读写（主线程会卡爆）、CSV 公式注入必须过滤前缀、合并单元格（merges）和样式在社区版里半残。

## 知识点拆解

### 第 1 格 · 三层模型

```
Workbook  ── 整个文件
  ├── Sheet1 (Worksheet) ── 一个工作表
  │     └── A1, B1, C1... (Cell) ── 单元格
  ├── Sheet2
  └── Sheet3
```

Worksheet 本质是一个稀疏对象：`sheet['A1']` 是 `{ v: 值, t: 类型, f: 公式, s: 样式 }`。读取选项决定是否返回 `s`（样式）和 `f`（公式）。

### 第 2 格 · 读写全流程

```ts
// 读取
const wb = XLSX.read(buffer, { cellStyles: true });
const sheet = wb.Sheets["Sheet1"];
const data = XLSX.utils.sheet_to_json(sheet);

// 修改 + 追加新 sheet
const newSheet = XLSX.utils.json_to_sheet(someArray);
XLSX.utils.book_append_sheet(wb, newSheet, "汇总");

// 导出
XLSX.writeFile(wb, "output.xlsx");
```

### 第 3 格 · CSV 公式注入防御

```ts
function safeCsv(value: unknown): string {
  const str = String(value ?? "");
  // Excel 会把这些开头的当公式执行
  if (/^[=+-\@\t\r]/.test(str)) {
    return "'" + str; // 加单引号前缀，变成纯文本
  }
  return str;
}

const csv = rows
  .map((row) => row.map(safeCsv).join(","))
  .join("\n");
downloadBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), "export.csv");
// BOM 确保 Excel 正确识别 UTF-8
```

### 第 4 格 · 三个最坑

1. **大数据量主线程卡死**：几万行 × 几十列，`sheet_to_json` 同步跑直接阻塞 UI 几百 ms。解法：Worker 分片处理 + 进度条。
2. **合并单元格数据不写全**：`sheet_to_json` 默认只写左上角 A1 的值，其他合并区域的单元格都是空。需要 `{ defval: '' }` 或自行展开。
3. **样式丢失**：社区版 `xlsx` 读取时拿不到样式（要 `cellStyles: true` 才返回但不支持写回），导出带样式必须用 `xlsx-js-style` 或 `xlsx-ugnis`。

## 坑点清单

> 🔗 正文对照：[《31.7 本章避坑清单》](../31-xlsx#_31-7-本章避坑清单)

1. **大数据量主线程阻塞**：XLSX 读写是同步 CPU 密集型，10MB+ 文件主线程跑 = UI 卡死。必须用 Worker 分片处理 + 实时进度。
2. **CSV 公式注入**：Excel 把 `= + - @` 开头的单元格当公式执行。用户填 `"=HYPERLINK('https://evil.com', '点我')"` 进 CSV 被 Excel 打开 = 钓鱼钓鱼。导出 CSV/TSV 必须过滤。
3. **社区版样式支持残缺**：`xlsx` 社区版读样式要 `cellStyles: true`，但**写样式写不回去**。要带样式导出换 `xlsx-js-style`。
4. **合并单元格 + 空值策略**：`sheet_to_json` 默认 `defval: undefined`，合并区域除了左上角的单元格全部返回 undefined。如果业务需要"展开合并"，要么手动解析 `merges` 数组，要么开 `{ blankrows: true, raw: false }` 配合自定义 reducer。

## 自测 3 题

**1. 写一个安全的 CSV 导出函数，防御公式注入并正确处理 BOM。**

<details>
<summary>参考答案</summary>

```ts
export function exportSafeCsv(rows: Record<string, unknown>[], filename: string): void {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);

  const safe = (val: unknown): string => {
    const s = String(val ?? "");
    // 防 Excel/LibreOffice 公式注入
    if (/^[=+-\@\t\r]/.test(s)) return "'" + s;
    // 转义 CSV 中的双引号
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  const lines = [
    headers.map(safe).join(","),
    ...rows.map((row) => headers.map((h) => safe(row[h])).join(",")),
  ];

  const csv = lines.join("\r\n"); // Excel 友好用 \r\n
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

要点：公式前缀正则 + 双引号/逗号/换行转义 + BOM + `\r\n` 换行。

</details>

**2. XLSX 社区版和 `xlsx-js-style` 有什么核心差异？什么场景必须换？**

<details>
<summary>参考答案</summary>

| 能力 | xlsx 社区版 | xlsx-js-style |
| --- | --- | --- |
| 读写数据 | ✅ | ✅ |
| 读取样式 | 需 `cellStyles: true` | ✅ |
| 写样式 | ❌（能读不能写） | ✅ |
| 合并单元格 | ✅ | ✅ |
| 图片嵌入 | ❌ | ❌ |

必须换的场景：**要导出带颜色/加粗/背景/边框的 Excel**。社区版里你读了样式回来再写回去，样式会静默丢失——没有任何报错提示。如果业务要"美化导出"（比如高亮超标数据、表头加粗），必须上 `xlsx-js-style`。

</details>

**3. 前端收到一个 10MB 的 Excel 要解析，主线程可能卡 500ms+。如何优化？**

<details>
<summary>参考答案</summary>

两步优化：

**① 用 Web Worker 搬 CPU**

```ts
// worker.js
self.onmessage = async (e) => {
  const { buffer } = e.data;
  const XLSX = await import("xlsx"); // Worker 里动态加载
  const wb = XLSX.read(buffer, { cellStyles: true });
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  self.postMessage({ data, count: data.length });
};

// 主线程
const worker = new Worker(new URL("./excel.worker.js", import.meta.url), { type: "module" });
worker.onmessage = (e) => {
  setData(e.data.data);
  worker.terminate();
};
worker.postMessage({ buffer: fileArrayBuffer }, [fileArrayBuffer]); // 转移所有权
```

**② 分片 + 进度**：数据量大的时候（比如 >5000 行），在 Worker 内按 1000 行一批 postMessage 回主线程，主线程边收边渲染（用虚拟滚动 table），避免一次性塞 5 万行到 DOM。

关键：`postMessage(buffer, [buffer])` 是**所有权转移**，主线程把 ArrayBuffer 让给 Worker，比结构化克隆快得多。

</details>
