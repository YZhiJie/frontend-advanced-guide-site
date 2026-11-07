# case 07：手写 XSS 清洗与转义工具箱

纯 TypeScript、零运行时依赖，手写一套前端 XSS 防御工具：HTML 文本/属性转义、URL 协议白名单、HTML 实体解码，以及一个极简 allowlist 清洗器，并用真实攻击向量做回归。

## 目录结构

```
07-xss-sanitizer-lab/
├── package.json
├── tsconfig.json
├── src/
│   └── sanitize.ts        # escapeHtml / escapeAttr / sanitizeUrl / decodeEntities / sanitizeHtml
├── test/
│   └── sanitize.test.ts   # node:test 回归用例（22 个）
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts（22 个用例）
```

## 关键设计

- **转义与解码分离**：`escapeHtml` / `escapeAttr` 单次正则替换，`&` 与其它字符同批处理，结果不会二次转义；`decodeEntities` 同样单次替换，`&amp;#39;` 只解出字面量 `&#39;`，与浏览器一次性解析行为保持一致。
- **默认拒绝未知协议**：`sanitizeUrl` 先取「第一个 `/ ? #` 之前、首个冒号之前」的片段作为协议候选，只放行 `http: / https: / mailto: / tel:` 与相对路径、锚点，其余（`javascript:` / `data:` / `vbscript:`）一律返回占位值。
- **多层绕过归一化**：判定前先剥离 ASCII 控制字符并 `trim()`（挡住 `java\tscript:` / 换行 / 首尾空白），再 `decodeEntities`（挡住 `&#106;avascript:`），协议名统一小写，覆盖大小写混写。
- **allowlist 而非黑名单**：`sanitizeHtml` 只重建白名单标签，未知标签（如 `<script>`、`<img>`）整体按文本转义，既消灭执行能力又不丢内容；标签之间的文本也转义，堵住未闭合 `<img ...` 在 EOF 处被宽容解析成真标签。
- **属性最小白名单**：默认只有 `a` 保留 `href` / `title`；`on*` 事件属性与 `style` 无条件剥离，`href` / `src` 走 `sanitizeUrl` 二次校验，危险协议直接丢弃整个属性。
- **全类型导出**：`EscapeHtmlOptions` / `SanitizeUrlOptions` / `SanitizeHtmlOptions` 及默认白名单常量全部导出，`strict` 下无隐式 `any`。

## 对应章节

- [7.1 XSS 跨站脚本攻击](../07-security.md#_7-1-xss-跨站脚本攻击)
- [7.3 其他常见攻击与防御](../07-security.md#_7-3-其他常见攻击与防御)
