// 26.1 mini-http-parser: 手写 HTTP 报文解析器
// 支持 request/response line, headers, body (Content-Length + chunked), pipelining

export interface HttpRequest {
  method: string;
  path: string;
  version: string;
  headers: Record<string, string>;
  body: Buffer;
}

export interface HttpResponse {
  version: string;
  statusCode: number;
  reasonPhrase: string;
  headers: Record<string, string>;
  body: Buffer;
}

export type HttpMessage = HttpRequest | HttpResponse;

type State = "line" | "headers" | "body";

const CRLF = Buffer.from("\r\n");

export class HttpParser {
  private buffer: Buffer = Buffer.alloc(0);
  private state: State = "line";
  private current: {
    line?: Buffer;
    headers: Record<string, string>;
    body?: Buffer;
    expectedLength?: number;
    chunked?: boolean;
    chunks: Buffer[];
    isResponse?: boolean;
  } = { headers: {}, chunks: [] };

  private messages: HttpMessage[] = [];

  /** feed chunks, returns complete messages so far */
  feed(chunk: Buffer): HttpMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parseLoop();
    const out = this.messages;
    this.messages = [];
    return out;
  }

  private indexOf(needle: Buffer, from = 0): number {
    for (let i = from; i <= this.buffer.length - needle.length; i++) {
      let match = true;
      for (let j = 0; j < needle.length; j++) {
        if (this.buffer[i + j] !== needle[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  private parseLoop() {
    while (true) {
      if (this.state === "line") {
        const crlf = this.indexOf(CRLF);
        if (crlf === -1) return;
        this.current.line = this.buffer.subarray(0, crlf);
        this.buffer = this.buffer.subarray(crlf + 2);
        this.state = "headers";
      }

      if (this.state === "headers") {
        const end = this.indexOf(Buffer.from("\r\n\r\n"));
        if (end === -1) return;
        const headerBlock = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 4);

        const headerLines = headerBlock.toString("ascii").split("\r\n");
        const firstLine = this.current.line!.toString("ascii");

        // 判断 request 还是 response
        const parts = firstLine.split(" ");
        if (parts.length === 3 && /^[A-Z]+$/.test(parts[0])) {
          // Request: METHOD PATH VERSION
          const [method, path, version] = parts;
          this.current.isResponse = false;
          (this.current as any).method = method;
          (this.current as any).path = path;
          (this.current as any).version = version;
        } else {
          // Response: VERSION STATUS REASON
          this.current.isResponse = true;
          const [version, code, ...reason] = parts;
          (this.current as any).version = version;
          (this.current as any).statusCode = parseInt(code, 10);
          (this.current as any).reasonPhrase = reason.join(" ");
        }

        for (const line of headerLines) {
          const idx = line.indexOf(":");
          if (idx === -1) continue;
          const key = line.slice(0, idx).trim().toLowerCase();
          const val = line.slice(idx + 1).trim();
          this.current.headers[key] = val;
        }

        // 计算 body 大小
        const te = this.current.headers["transfer-encoding"] || "";
        const cl = this.current.headers["content-length"];
        if (te.includes("chunked")) {
          this.current.chunked = true;
          this.current.expectedLength = undefined;
        } else if (cl !== undefined) {
          this.current.expectedLength = parseInt(cl, 10);
          this.current.chunked = false;
        } else {
          // 无 body，立即完成（request 一般无 body，response 也可能无）
          this.finishMessage();
          continue;
        }

        this.state = "body";
      }

      if (this.state === "body") {
        if (this.current.chunked) {
          if (!this.parseChunked()) return;
        } else {
          const len = this.current.expectedLength!;
          if (this.buffer.length < len) return;
          this.current.body = this.buffer.subarray(0, len);
          this.buffer = this.buffer.subarray(len);
          this.finishMessage();
        }
      }
    }
  }

  private parseChunked(): boolean {
    while (true) {
      const crlf = this.indexOf(CRLF);
      if (crlf === -1) return false;
      const sizeLine = this.buffer.subarray(0, crlf).toString("ascii").split(";")[0].trim();
      const size = parseInt(sizeLine, 16);
      if (isNaN(size)) throw new Error(`Invalid chunk size: ${sizeLine}`);

      if (size === 0) {
        // 终止块 + 可能的 trailers（简单跳过）
        this.buffer = this.buffer.subarray(crlf + 2);
        // 找最后的 CRLF
        const endCrlf = this.indexOf(CRLF);
        if (endCrlf === -1) {
          // 没有 trailers，找 \r\n\r\n
          // 简化：直接读下一段
          if (this.buffer.length < 2) return false;
          // 如果开头就是 CRLF 就跳过
          if (this.buffer[0] === 0x0d && this.buffer[1] === 0x0a) {
            this.buffer = this.buffer.subarray(2);
          }
        } else {
          this.buffer = this.buffer.subarray(endCrlf + 2);
          if (this.buffer[0] === 0x0d && this.buffer[1] === 0x0a) {
            this.buffer = this.buffer.subarray(2);
          }
        }
        const total = Buffer.concat(this.current.chunks);
        this.current.body = total;
        this.finishMessage();
        return true;
      }

      const chunkEnd = crlf + 2 + size + 2; // 数据块 + 结尾 CRLF
      if (this.buffer.length < chunkEnd) return false;

      this.current.chunks.push(this.buffer.subarray(crlf + 2, crlf + 2 + size));
      this.buffer = this.buffer.subarray(chunkEnd);
    }
  }

  private finishMessage() {
    const c = this.current;
    let msg: HttpMessage;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.headers)) headers[k] = v;
    const body = c.body ?? Buffer.alloc(0);

    if (c.isResponse) {
      msg = {
        version: (c as any).version,
        statusCode: (c as any).statusCode,
        reasonPhrase: (c as any).reasonPhrase,
        headers,
        body,
      };
    } else {
      msg = {
        method: (c as any).method,
        path: (c as any).path,
        version: (c as any).version,
        headers,
        body,
      };
    }

    this.messages.push(msg);
    this.current = { headers: {}, chunks: [] };
    this.state = "line";
  }
}
