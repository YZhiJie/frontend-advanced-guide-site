// 文件: cases/07-xss-sanitizer-lab/test/sanitize.test.ts
// ============ XSS 清洗与转义工具箱回归（node:test + node:assert/strict） ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { decodeEntities, escapeAttr, escapeHtml, sanitizeHtml, sanitizeUrl } from "../src/sanitize.js"
import type { SanitizeUrlOptions } from "../src/sanitize.js"

test("escapeHtml 转义 & < > \" ' 五个核心字符", () => {
    assert.equal(
        escapeHtml("5 < 6 & \"q\" 'a'"),
        "5 &lt; 6 &amp; &quot;q&quot; &#39;a&#39;",
    )
})

test("escapeHtml 可选额外转义 `/`", () => {
    assert.equal(escapeHtml("a/b"), "a/b")
    assert.equal(escapeHtml("a/b", { escapeSlash: true }), "a&#47;b")
})

test("escapeHtml 单次替换，结果不出现二次转义", () => {
    assert.equal(escapeHtml("<"), "&lt;")
    assert.equal(escapeHtml("&"), "&amp;")
})

test("escapeAttr 转义属性值，防属性逃逸", () => {
    assert.equal(escapeAttr("\" onmouseover=\"alert(1)"), "&quot; onmouseover=&quot;alert(1)")
    assert.equal(escapeAttr("a&b"), "a&amp;b")
})

test("decodeEntities 解码命名实体", () => {
    assert.equal(decodeEntities("&amp;&lt;&gt;&quot;&apos;"), "&<>\"'")
    assert.equal(decodeEntities("&unknown;"), "&unknown;")
})

test("decodeEntities 解码十进制与十六进制数字实体", () => {
    assert.equal(decodeEntities("&#39;&#x27;&#65;&#x41;"), "''AA")
    // 非法码位原样保留，不抛错
    assert.equal(decodeEntities("&#xD800;"), "&#xD800;")
})

test("escapeHtml 与 decodeEntities 构成编码/解码回环", () => {
    const raw = "5 < 6 & \"q\" 'a'"
    assert.equal(decodeEntities(escapeHtml(raw)), raw)
})

test("sanitizeUrl 放行白名单协议", () => {
    assert.equal(sanitizeUrl("https://example.com/a?b=1&c=2"), "https://example.com/a?b=1&c=2")
    assert.equal(sanitizeUrl("http://example.com"), "http://example.com")
    assert.equal(sanitizeUrl("mailto:a@b.com"), "mailto:a@b.com")
    assert.equal(sanitizeUrl("tel:+8613800138000"), "tel:+8613800138000")
    assert.equal(sanitizeUrl("  https://example.com  "), "https://example.com")
})

test("sanitizeUrl 放行相对路径 / 锚点 / 协议相对地址", () => {
    assert.equal(sanitizeUrl("/docs/guide"), "/docs/guide")
    assert.equal(sanitizeUrl("./a"), "./a")
    assert.equal(sanitizeUrl("../a"), "../a")
    assert.equal(sanitizeUrl("#top"), "#top")
    assert.equal(sanitizeUrl("//cdn.example.com/x"), "//cdn.example.com/x")
})

test("sanitizeUrl 拦截 javascript: 及其大小写混写", () => {
    assert.equal(sanitizeUrl("javascript:alert(1)"), "#")
    assert.equal(sanitizeUrl("JaVaScRiPt:alert(1)"), "#")
    assert.equal(sanitizeUrl("JAVASCRIPT:alert(1)"), "#")
})

test("sanitizeUrl 拦截制表符 / 换行 / 首尾空白绕过", () => {
    assert.equal(sanitizeUrl("java\tscript:alert(1)"), "#")
    assert.equal(sanitizeUrl("java\nscript:alert(1)"), "#")
    assert.equal(sanitizeUrl("  JaVaScRiPt:alert(1)  "), "#")
})

test("sanitizeUrl 拦截 data: 与 vbscript:", () => {
    assert.equal(sanitizeUrl("data:text/html,<script>alert(1)</script>"), "#")
    assert.equal(sanitizeUrl("data:image/svg+xml;base64,PHN2Zz4="), "#")
    assert.equal(sanitizeUrl("vbscript:msgbox(1)"), "#")
})

test("sanitizeUrl 拦截实体编码伪装的 scheme", () => {
    assert.equal(sanitizeUrl("&#106;avascript:alert(1)"), "#")
    assert.equal(sanitizeUrl("&#x6a;avascript:alert(1)"), "#")
})

test("sanitizeUrl 支持自定义协议白名单与占位值", () => {
    const opts: SanitizeUrlOptions = { allowedProtocols: ["https:", "mailto:"], fallback: "" }
    assert.equal(sanitizeUrl("https://a.com", opts), "https://a.com")
    assert.equal(sanitizeUrl("mailto:a@b.com", opts), "mailto:a@b.com")
    assert.equal(sanitizeUrl("http://a.com", opts), "")
    assert.equal(sanitizeUrl("javascript:alert(1)", opts), "")
})

test("sanitizeHtml 保留白名单标签", () => {
    assert.equal(sanitizeHtml("<p>Hello <strong>world</strong></p>"), "<p>Hello <strong>world</strong></p>")
    assert.equal(sanitizeHtml("<ul><li>a</li><li>b</li></ul>"), "<ul><li>a</li><li>b</li></ul>")
})

test("sanitizeHtml 把危险标签整体转义为文本", () => {
    assert.equal(sanitizeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;")
})

test("sanitizeHtml 剥离 on* 事件属性", () => {
    assert.equal(sanitizeHtml("<p onmouseover=\"x()\">t</p>"), "<p>t</p>")
    assert.equal(sanitizeHtml("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;")
})

test("sanitizeHtml 剥离 style 属性", () => {
    assert.equal(sanitizeHtml("<p style=\"color:red\">t</p>"), "<p>t</p>")
})

test("sanitizeHtml 对 href 做协议白名单：危险协议剥离、安全链接保留", () => {
    assert.equal(sanitizeHtml("<a href=\"javascript:alert(1)\">x</a>"), "<a>x</a>")
    assert.equal(
        sanitizeHtml("<a href=\"https://example.com/a\">x</a>"),
        "<a href=\"https://example.com/a\">x</a>",
    )
    assert.equal(sanitizeHtml("<a href=\"data:text/html;base64,PHN2Zz4=\">x</a>"), "<a>x</a>")
})

test("sanitizeHtml 转义属性值中的引号，防属性逃逸", () => {
    assert.equal(
        sanitizeHtml(`<a href="https://x.com" title='" onmouseover="alert(1)'>link</a>`),
        `<a href="https://x.com" title="&quot; onmouseover=&quot;alert(1)">link</a>`,
    )
})

test("sanitizeHtml 支持自定义 allowlist", () => {
    assert.equal(sanitizeHtml("<b>bold</b>"), "&lt;b&gt;bold&lt;/b&gt;")
    assert.equal(sanitizeHtml("<b>bold</b>", { allowedTags: ["b"] }), "<b>bold</b>")
})

test("sanitizeHtml 转义未闭合的伪标签，避免 EOF 宽容解析", () => {
    const out = sanitizeHtml("ok<img src=x onerror=alert(1)")
    assert.equal(out, "ok&lt;img src=x onerror=alert(1)")
    assert.ok(!out.includes("<img"))
})
