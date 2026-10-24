// 文件: examples/25-05-url-pitfalls.ts —— URL / URLSearchParams 的四个高频坑
// ============ URL 拼接从来不是字符串加法,Node 18+ 原生可跑============

// ── 坑一:encodeURIComponent vs encodeURI 用错位 ──
// encodeURI 保留 URL 结构字符(&=?#),适合「整个地址」;
// encodeURIComponent 适合「参数值」,连 & = 都转义,否则值里的 & 会被当分隔符
const val = "a=1&b=中文";
console.log("坑一 encodeURI  保留结构:", encodeURI(val)); // a=1&b=中文  —— & 未转义,参数被劈开
console.log("坑一 encodeURIC 全转义:", encodeURIComponent(val)); // a%3D1%26b%3D… —— 作为值是安全的

// ── 坑二:手拼 + 号空格 —— 服务端把 + 解析成空格,值就变了 ──
// 历史包袱:application/x-www-form-urlencoded 里 + 代表空格;fetch/URLSearchParams
// 会把空格编码成 %20 或 +,但你自己手拼 "q=" + keyword 时没有这层保护
console.log("坑二 searchParams 自动编码:", new URLSearchParams({ q: "react hooks" }).toString());
console.log("坑二 手拼字符串:", "q=" + "react hooks"); // 空格裸奔,服务端可能解析错

// ── 坑三:searchParams 读取时自动解码,重复键取第一个 ──
const u = new URL("https://api.example.com/search?q=a&q=b&tag=%E5%89%8D%E7%AB%AF");
console.log("坑三 重复键 getAll:", u.searchParams.getAll("q"), " get 取第一个:", u.searchParams.get("q"));
console.log("坑三 自动解码 tag:", u.searchParams.get("tag"));

// ── 坑四:相对路径解析与「开放重定向」防护 —— new URL 必须带 base 或协议 ──
// 用户传入的跳转地址,用 new URL 校验协议 + origin,一行挡掉 //evil.com 与 javascript: 伪协议
function safeRedirect(input: string, base: string): string | null {
  try {
    const target = new URL(input, base); // 无协议的相对路径按 base 解析
    if (target.origin !== new URL(base).origin) return null; // 跨站跳转拒绝
    if (target.protocol !== "https:" && target.protocol !== "http:") return null;
    return target.href;
  } catch {
    return null; // 非法 URL
  }
}
console.log("坑四 合法内链:", safeRedirect("/dashboard?tab=1", "https://app.example.com"));
console.log("坑四 双斜杠外站:", safeRedirect("//evil.example.com", "https://app.example.com"));
console.log("坑四 伪协议:", safeRedirect("javascript:alert(1)", "https://app.example.com"));

// 附:URL 修改是链式的、不可变的字符串不动,searchParams 改动要「用回」返回的实例
const fixed = new URL("https://a.com/list?size=10");
fixed.searchParams.set("size", "50");
fixed.searchParams.delete("debug");
console.log("附 searchParams 链式修改:", fixed.href);
