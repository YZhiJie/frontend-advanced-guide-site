// 文件: cases/08-mini-network-stack-lab/src/http-parser.ts
// ============ 手写 HTTP/1.1 报文解析器 ============
//
// 提供 parse(buf) 从 Buffer 里顺序切出一个完整的请求或响应，返回结构化对象
// 以及下一条报文的起始偏移。支持：
// - Content-Length 定长 body
// - Transfer-Encoding: chunked 分块 body
// - 连接复用 / 管道化（一个 Buffer 多条报文连续排列）

export type HttpMethod =
    | "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
    | "HEAD" | "OPTIONS" | "TRACE" | "CONNECT"

export interface HttpRequest {
    kind: "request"
    method: HttpMethod
    path: string
    /** 原始 HTTP 版本字符串，例如 "HTTP/1.1" */
    version: string
    headers: Record<string, string>
    body: Buffer
    /** 下一条报文在原始 Buffer 里的起始偏移；-1 表示 Buffer 不完整 */
    nextOffset: number
}

export interface HttpResponse {
    kind: "response"
    /** 状态码，例如 200、404 */
    statusCode: number
    /** 状态行 reason phrase，例如 "OK" */
    reasonPhrase: string
    version: string
    headers: Record<string, string>
    body: Buffer
    nextOffset: number
}

export type HttpMessage = HttpRequest | HttpResponse

const CRLF = "\r\n"
const CRLF_BUF = Buffer.from(CRLF)

/**
 * 从 Buffer 里解析出一条完整的 HTTP 报文。
 *
 * - 不完整报文（header 未到齐 / body 未读完）返回 nextOffset = -1
 * - 完整报文返回结构化对象 + nextOffset，调用方可以直接 buf.slice(nextOffset)
 *   把剩余字节继续喂给 parse 来支持管道化
 */
export function parse(buf: Buffer): HttpMessage {
    // ---- 1) 找到 header 与 body 的分界空行 ----
    const headerEnd = indexOfDoubleCRLF(buf)
    if (headerEnd === -1) {
        // 整个 header 都还没收齐（或者完全没有 CRLF）
        return partial("request")
    }

    const headerSection = buf.subarray(0, headerEnd)
    const bodyStart = headerEnd + 4 // 跳过 \r\n\r\n

    // ---- 2) 解析 header 行 ----
    const lines = headerSection.toString("ascii").split(CRLF)
    const startLine = lines[0]!
    const headers = parseHeaderLines(lines.slice(1))
    const isRequest = startLine.includes(" ") && !startLine.startsWith("HTTP/")

    if (isRequest) {
        const parts = startLine.split(" ")
        if (parts.length !== 3) {
            throw new Error(`非法请求行: ${startLine}`)
        }
        const method = parts[0]! as HttpMethod
        const path = parts[1]!
        const version = parts[2]!
        const bodyResult = extractBody(buf, bodyStart, headers)
        return {
            kind: "request",
            method,
            path,
            version,
            headers,
            body: bodyResult.body,
            nextOffset: bodyResult.complete ? bodyStart + bodyResult.consumed : -1,
        }
    } else {
        // 响应行：HTTP/1.1 200 OK
        const parts = startLine.split(" ")
        const version = parts[0]!
        const statusCode = Number(parts[1])
        const reasonPhrase = parts.slice(2).join(" ")
        if (!version.startsWith("HTTP/") || Number.isNaN(statusCode)) {
            throw new Error(`非法响应行: ${startLine}`)
        }
        const bodyResult = extractBody(buf, bodyStart, headers)
        return {
            kind: "response",
            statusCode,
            reasonPhrase,
            version,
            headers,
            body: bodyResult.body,
            nextOffset: bodyResult.complete ? bodyStart + bodyResult.consumed : -1,
        }
    }

    function partial(_kind: "request" | "response"): HttpMessage {
        // 不完整 header，返回一个占位对象 —— 调用方通过 nextOffset === -1 判断
        return {
            kind: "request",
            method: "GET",
            path: "",
            version: "",
            headers: {},
            body: Buffer.alloc(0),
            nextOffset: -1,
        }
    }
}

/**
 * 在 buf 里找到 `\r\n\r\n` 的起始位置；没找到返回 -1。
 * 纯 Buffer 搜索，比转字符串再 indexOf 更快。
 */
function indexOfDoubleCRLF(buf: Buffer): number {
    // 从头逐字节扫描：找 \r，再确认后续是 \n\r\n
    for (let i = 0; i <= buf.length - 4; i++) {
        if (buf[i] === 0x0D && buf[i + 1] === 0x0A
            && buf[i + 2] === 0x0D && buf[i + 3] === 0x0A) {
            return i
        }
    }
    return -1
}

/** 把多行 header 字符串解析为 record；后续同名 header 用逗号合并（符合 HTTP 规范） */
function parseHeaderLines(lines: string[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const line of lines) {
        if (line.length === 0) continue
        const colonIdx = line.indexOf(":")
        if (colonIdx === -1) continue // 跳过畸形行
        const name = line.slice(0, colonIdx).trim().toLowerCase()
        const value = line.slice(colonIdx + 1).trim()
        if (name in result) {
            result[name] = result[name] + ", " + value
        } else {
            result[name] = value
        }
    }
    return result
}

interface BodyResult {
    body: Buffer
    consumed: number
    complete: boolean
}

/**
 * 根据 Content-Length 或 Transfer-Encoding 从 buf[bodyStart..] 切出 body。
 * 没声明长度则返回空 body（多数 GET / HEAD 响应）。
 */
function extractBody(
    buf: Buffer,
    bodyStart: number,
    headers: Record<string, string>,
): BodyResult {
    const transferEncoding = (headers["transfer-encoding"] ?? "").toLowerCase()
    if (transferEncoding.includes("chunked")) {
        return parseChunkedBody(buf, bodyStart)
    }

    const contentLengthStr = headers["content-length"]
    if (contentLengthStr !== undefined) {
        const contentLength = Number(contentLengthStr)
        if (Number.isNaN(contentLength) || contentLength < 0) {
            throw new Error(`非法 Content-Length: ${contentLengthStr}`)
        }
        const available = buf.length - bodyStart
        if (available >= contentLength) {
            return {
                body: buf.subarray(bodyStart, bodyStart + contentLength),
                consumed: contentLength,
                complete: true,
            }
        }
        // body 还没收齐
        return { body: Buffer.alloc(0), consumed: 0, complete: false }
    }

    // 没有 body
    return { body: Buffer.alloc(0), consumed: 0, complete: true }
}

/**
 * 解析 chunked 格式：
 *   <size-in-hex>\r\n
 *   <data>\r\n
 *   ...
 *   0\r\n  [可选 trailer]\r\n
 */
function parseChunkedBody(buf: Buffer, bodyStart: number): BodyResult {
    let pos = bodyStart
    const chunks: Buffer[] = []

    while (true) {
        // 读下一行 chunk size
        const lineEnd = buf.indexOf(CRLF_BUF, pos)
        if (lineEnd === -1) {
            return { body: Buffer.alloc(0), consumed: 0, complete: false }
        }
        const sizeLine = buf.subarray(pos, lineEnd).toString("ascii").trim()
        // size 之后可以带扩展名（如 ";foo=bar"），分号前才是真正长度
        const semicolon = sizeLine.indexOf(";")
        const sizeHex = semicolon === -1 ? sizeLine : sizeLine.slice(0, semicolon)
        const size = parseInt(sizeHex, 16)
        if (Number.isNaN(size)) {
            throw new Error(`非法 chunk size: ${sizeLine}`)
        }
        pos = lineEnd + 2

        if (size === 0) {
            // 结束块；跳过 trailer 里可能存在的头部行，直到遇见空行
            while (true) {
                const trailerEnd = buf.indexOf(CRLF_BUF, pos)
                if (trailerEnd === -1) {
                    return { body: Buffer.alloc(0), consumed: 0, complete: false }
                }
                if (trailerEnd === pos) {
                    pos += 2
                    break
                }
                pos = trailerEnd + 2
            }
            return {
                body: Buffer.concat(chunks),
                consumed: pos - bodyStart,
                complete: true,
            }
        }

        // 需要 size + 2 字节（chunk 数据 + 尾部 CRLF）
        const dataEnd = pos + size
        const chunkEnd = dataEnd + 2
        if (buf.length < chunkEnd) {
            return { body: Buffer.alloc(0), consumed: 0, complete: false }
        }
        chunks.push(buf.subarray(pos, dataEnd))
        pos = chunkEnd
    }
}

/**
 * 便捷函数：解析一段可能含多条报文的 Buffer，返回所有完整报文。
 * 常用于管道化场景一次性把所有就绪的报文切出来。
 */
export function parseAll(buf: Buffer): HttpMessage[] {
    const messages: HttpMessage[] = []
    let offset = 0
    while (offset < buf.length) {
        const sliced = buf.subarray(offset)
        const msg = parse(sliced)
        if (msg.nextOffset === -1) break // 不完整
        messages.push(msg)
        offset += msg.nextOffset
    }
    return messages
}

/** 把一个结构体重新序列化为 Buffer（主要用于测试 / 反向场景） */
export function serialize(msg: HttpMessage): Buffer {
    const lines: string[] = []
    if (msg.kind === "request") {
        lines.push(`${msg.method} ${msg.path} ${msg.version}`)
    } else {
        lines.push(`${msg.version} ${msg.statusCode} ${msg.reasonPhrase}`)
    }
    for (const [key, value] of Object.entries(msg.headers)) {
        lines.push(`${key}: ${value}`)
    }
    lines.push("")
    const headerBuf = Buffer.from(lines.join(CRLF) + CRLF, "ascii")
    const bodyBuf = msg.body ?? Buffer.alloc(0)
    return Buffer.concat([headerBuf, bodyBuf])
}
