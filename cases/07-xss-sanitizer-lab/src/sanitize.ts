// 文件: cases/07-xss-sanitizer-lab/src/sanitize.ts
// ============ 手写前端 XSS 防御工具箱：转义 + URL 协议白名单 + 实体解码 + allowlist 清洗 ============

// ---------- 一、HTML 文本 / 属性转义 ----------

/** escapeHtml 选项 */
export interface EscapeHtmlOptions {
    /** 是否额外转义 `/`（默认 false） */
    escapeSlash?: boolean
}

const HTML_ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#47;",
}

/**
 * 转义 HTML 文本：`& < > " '`，可选追加 `/`。
 * 单次正则替换、`&` 与其它字符同批处理，不会把结果里的 `&` 二次转义成 `&amp;lt;`。
 */
export function escapeHtml(str: string, opts: EscapeHtmlOptions = {}): string {
    const pattern = opts.escapeSlash ? /[&<>"'\/]/g : /[&<>"']/g
    return str.replace(pattern, (char) => HTML_ESCAPE_MAP[char] ?? char)
}

const ATTR_ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
    "<": "&lt;",
    ">": "&gt;",
}

/**
 * 属性值专用转义：把值放进双引号属性时，至少挡住 `"` 与 `&` 的逃逸。
 * 这里连 `< > '` 一并转义，避免单引号包裹或 HTML 解析器宽容解析带来的边界问题。
 */
export function escapeAttr(str: string): string {
    return str.replace(/[&"'<>]/g, (char) => ATTR_ESCAPE_MAP[char] ?? char)
}

// ---------- 二、HTML 实体解码 ----------

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00A0",
}

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g

/**
 * 把常见 HTML 实体解码回字符：命名实体 `&amp; &lt; &gt; &quot; &apos;`、
 * 十进制 `&#39;` 与十六进制 `&#x27;` 数字实体，供「解码回环」校验与绕过检测复用。
 * 单次替换：`&amp;#39;` 只会解出字面量 `&#39;`，与浏览器一次性解析行为一致。
 */
export function decodeEntities(str: string): string {
    return str.replace(ENTITY_RE, (match, body: string) => {
        if (body[0] === "#") {
            const isHex = body[1] === "x" || body[1] === "X"
            const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
            // 非法码位（越界 / 代理区）原样保留，避免 String.fromCodePoint 抛错
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
            if (code >= 0xd800 && code <= 0xdfff) return match
            return String.fromCodePoint(code)
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match
    })
}

// ---------- 三、URL 协议白名单 ----------

/** sanitizeUrl 选项 */
export interface SanitizeUrlOptions {
    /** 允许的协议（小写、含冒号），默认 ["http:", "https:", "mailto:", "tel:"] */
    allowedProtocols?: readonly string[]
    /** 是否放行相对路径 / 锚点（默认 true） */
    allowRelative?: boolean
    /** 判定为不安全时返回的占位值（默认 "#"） */
    fallback?: string
}

const DEFAULT_PROTOCOLS: readonly string[] = ["http:", "https:", "mailto:", "tel:"]

/** 浏览器在解析 URL 前会剥离 ASCII 控制字符（\t \n \r NUL 等），攻击者正是借此绕过朴素关键词匹配 */
function stripControl(url: string): string {
    return url.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

/**
 * URL 协议白名单校验：仅放行 http/https/mailto/tel 与相对路径、锚点、协议相对地址。
 * 默认拒绝一切未列出的协议，拦截 `javascript:` / `data:` / `vbscript:`，并覆盖
 * 大小写混写、首尾空白、制表符/换行、HTML 实体编码等多种真实绕过手法。
 */
export function sanitizeUrl(url: string, opts: SanitizeUrlOptions = {}): string {
    const protocols = opts.allowedProtocols ?? DEFAULT_PROTOCOLS
    const fallback = opts.fallback ?? "#"
    if (typeof url !== "string" || url === "") return fallback
    const normalized = stripControl(url)
    if (normalized === "") return fallback
    // 属性值在 HTML 解析阶段会被实体解码，这里先解码再做协议判定，堵住 &#106;avascript: 之类
    const decoded = decodeEntities(normalized)
    // 协议候选 = 「第一个 / ? # 之前」再取「首个冒号之前」的部分
    const firstSegment = decoded.split(/[/?#]/, 1)[0] ?? ""
    const colon = firstSegment.indexOf(":")
    if (colon >= 0) {
        const scheme = firstSegment.slice(0, colon).replace(/\s+/g, "").toLowerCase() + ":"
        if (!protocols.includes(scheme)) return fallback
        return decoded
    }
    // 无协议：相对路径 / 锚点 / 协议相对地址，按需放行
    if (opts.allowRelative === false) return fallback
    return decoded
}

// ---------- 四、allowlist HTML 清洗 ----------

/** 默认白名单标签 */
export const DEFAULT_ALLOWED_TAGS: readonly string[] = [
    "p",
    "br",
    "strong",
    "em",
    "a",
    "ul",
    "ol",
    "li",
    "code",
    "pre",
]

/** 默认属性白名单：仅 a 保留 href / title，其余标签无属性 */
export const DEFAULT_ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
    a: ["href", "title"],
}

/** sanitizeHtml 选项 */
export interface SanitizeHtmlOptions {
    /** 允许保留的标签名（小写），默认 DEFAULT_ALLOWED_TAGS */
    allowedTags?: readonly string[]
    /** 标签 → 允许属性名，键 "*" 表示所有标签共用；默认 DEFAULT_ALLOWED_ATTRIBUTES */
    allowedAttributes?: Readonly<Record<string, readonly string[]>>
}

const TAG_RE = /<[^>]*>/g
const TAG_PARSE_RE = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)\s*\/?>$/
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const URL_ATTRIBUTES = new Set(["href", "src"])

/** 清洗单个标签：白名单内重建安全标签，白名单外整体转义为文本 */
function sanitizeTag(
    tag: string,
    allowedTags: Set<string>,
    allowedAttributes: Readonly<Record<string, readonly string[]>>,
): string {
    const parsed = TAG_PARSE_RE.exec(tag)
    if (parsed === null) return escapeHtml(tag)
    const name = parsed[2].toLowerCase()
    // 未知标签整体按文本转义：既消灭执行能力，又不丢内容
    if (!allowedTags.has(name)) return escapeHtml(tag)
    if (parsed[1] === "/") return `</${name}>`
    const attrs = parsed[3]
    const allowed = allowedAttributes[name] ?? allowedAttributes["*"] ?? []
    const allowedSet = new Set(allowed.map((attr) => attr.toLowerCase()))
    const safeAttrs: string[] = []
    ATTR_RE.lastIndex = 0
    let attrMatch: RegExpExecArray | null
    while ((attrMatch = ATTR_RE.exec(attrs)) !== null) {
        const attrName = attrMatch[1].toLowerCase()
        if (attrName.startsWith("on")) continue // 事件属性一律剥离
        if (attrName === "style") continue // 内联样式一律剥离
        if (!allowedSet.has(attrName)) continue // 不在白名单的属性丢弃
        const rawValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? ""
        if (URL_ATTRIBUTES.has(attrName)) {
            const safeUrl = sanitizeUrl(rawValue, { fallback: "" })
            if (safeUrl === "") continue // 危险协议：连属性一起丢弃
            safeAttrs.push(`${attrName}="${escapeAttr(safeUrl)}"`)
        } else {
            safeAttrs.push(`${attrName}="${escapeAttr(rawValue)}"`)
        }
    }
    return safeAttrs.length > 0 ? `<${name} ${safeAttrs.join(" ")}>` : `<${name}>`
}

/**
 * 极简 allowlist 清洗器：白名单标签重建保留，其余标签按文本转义（不删内容丢信息）；
 * 剥离所有 `on*` 事件属性与 `style`，并对 `href` / `src` 做 URL 协议白名单二次校验。
 * 标签之间的文本同样转义，堵住未闭合的 `<img ...` 在 EOF 处被宽容解析成真标签。
 */
export function sanitizeHtml(html: string, opts: SanitizeHtmlOptions = {}): string {
    const allowedTags = new Set(
        (opts.allowedTags ?? DEFAULT_ALLOWED_TAGS).map((tag) => tag.toLowerCase()),
    )
    const allowedAttributes = opts.allowedAttributes ?? DEFAULT_ALLOWED_ATTRIBUTES
    let result = ""
    let cursor = 0
    TAG_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TAG_RE.exec(html)) !== null) {
        result += escapeHtml(html.slice(cursor, match.index))
        result += sanitizeTag(match[0], allowedTags, allowedAttributes)
        cursor = match.index + match[0].length
    }
    result += escapeHtml(html.slice(cursor))
    return result
}
