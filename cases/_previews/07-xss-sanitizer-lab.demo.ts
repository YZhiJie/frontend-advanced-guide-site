// 07-xss-sanitizer-lab 在线预览：转义 / 协议白名单 / allowlist 清洗（真实攻击向量）
import { escapeHtml, sanitizeUrl, sanitizeHtml, decodeEntities } from "../07-xss-sanitizer-lab/src/sanitize.ts";
import { section, button, buttonRow, textarea, output, log, pre } from "./shared.ts";

const sec = section("XSS 防御工具箱", "预填常见攻击向量，可随意改写输入；输出是清洗后的**文本原样**（不会被执行）");
const out = output(sec);

const ta = textarea(
    sec,
    [
        '<img src=x onerror="alert(1)">',
        '<a href="javascript:alert(1)">点我</a>',
        '<a href=" &#106;avascript:alert(1)">实体编码绕过</a>',
        "<p>正常<b>加粗</b><script>alert(1)</script></p>",
    ].join("\n"),
    7,
);

const row = buttonRow(sec);
button(row, "▶ escapeHtml（全文转义）", () => {
    pre(out, escapeHtml(ta.value), "ok");
});
button(row, "▶ sanitizeUrl（逐行协议白名单）", () => {
    for (const line of ta.value.split("\n")) {
        const m = line.match(/href="([^"]*)"/);
        if (!m) continue;
        const safe = sanitizeUrl(m[1]!);
        log(out, `${JSON.stringify(m[1])} → ${JSON.stringify(safe)}`, safe === "#" ? "err" : "ok");
    }
    log(out, "提示：javascript: 与实体编码变体都会被拦成 #（控制字符与实体先解码再判定）", "info");
});
button(row, "▶ sanitizeHtml（allowlist 清洗）", () => {
    for (const line of ta.value.split("\n")) {
        pre(out, sanitizeHtml(line), "ok");
    }
    log(out, "观察：未知标签（img/script）整体转义为文本，on* 与 style 属性被剥离，白名单标签原样保留", "info");
});
button(row, "▶ decodeEntities（解码回环）", () => {
    const raw = escapeHtml("<a href=\"x\">&amp;</a>");
    log(out, `转义：${raw}`, "dim");
    log(out, `解码：${decodeEntities(raw)}（单次替换不会二次解码）`, "ok");
});
