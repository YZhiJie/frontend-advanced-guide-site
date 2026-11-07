// 26.4 mini-websocket: 手写 WebSocket 客户端
import * as net from "node:net";
import * as crypto from "node:crypto";
import { URL } from "node:url";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPCODE_TEXT = 0x01;
const OPCODE_BINARY = 0x02;
const OPCODE_CLOSE = 0x08;
const OPCODE_PING = 0x09;
const OPCODE_PONG = 0x0a;

export class MiniWebSocket extends EventTarget {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private url: string;
  private connected = false;
  private closed = false;

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MiniWebSocket.CONNECTING;

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.connect();
  }

  private connect() {
    const url = new URL(this.url);
    const key = crypto.randomBytes(16).toString("base64");

    const headers = [
      `GET ${url.pathname || "/"} HTTP/1.1`,
      `Host: ${url.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "\r\n",
    ].join("\r\n");

    this.socket = net.connect(
      {
        host: url.hostname,
        port: url.port || (url.protocol === "wss:" ? 443 : 80),
      },
      () => {
        this.socket!.write(headers);
      },
    );

    let handshakeDone = false;
    this.socket.on("data", (chunk: Buffer) => {
      if (!handshakeDone) {
        // 找 \r\n\r\n 结束 header
        const idx = chunk.indexOf("\r\n\r\n");
        if (idx === -1) {
          // 可能 header 还没收完，这里简单处理一次
          return;
        }
        const resp = chunk.subarray(0, idx).toString("ascii");
        // 验证 101 Switching Protocols
        if (!resp.includes("101 Switching Protocols")) {
          this.dispatchEvent(new Event("error"));
          this.socket!.destroy();
          return;
        }
        // 验证 Sec-WebSocket-Accept
        const acceptMatch = resp.match(/Sec-WebSocket-Accept:\s*(\S+)/i);
        if (!acceptMatch) {
          this.dispatchEvent(new Event("error"));
          this.socket!.destroy();
          return;
        }
        const expected = crypto
          .createHash("sha1")
          .update(key + WS_MAGIC)
          .digest("base64");
        if (acceptMatch[1] !== expected) {
          console.error(`Accept mismatch: got ${acceptMatch[1]}, expected ${expected}`);
          this.dispatchEvent(new Event("error"));
          this.socket!.destroy();
          return;
        }

        handshakeDone = true;
        this.connected = true;
        this.readyState = MiniWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));

        // 剩下的数据可能已经有帧了
        this.buffer = chunk.subarray(idx + 4);
        this.parseFrames();
      } else {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.parseFrames();
      }
    });

    this.socket.on("close", () => {
      if (!this.closed) {
        this.readyState = MiniWebSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
      }
    });
    this.socket.on("error", () => {
      this.dispatchEvent(new Event("error"));
    });
  }

  private parseFrames() {
    while (this.buffer.length >= 2) {
      const byte0 = this.buffer[0];
      const byte1 = this.buffer[1];
      const fin = (byte0 & 0x80) !== 0;
      const opcode = byte0 & 0x0f;
      const masked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLen = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) return;
        // 简化:如果超长报错
        const hi = this.buffer.readUInt32BE(offset);
        if (hi !== 0) throw new Error("Too large payload");
        payloadLen = this.buffer.readUInt32BE(offset + 4);
        offset += 8;
      }

      let maskKey: Buffer | null = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) return;

      let payload = this.buffer.subarray(offset, offset + payloadLen);
      if (masked && maskKey) {
        const out = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          out[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = out;
      }

      this.buffer = this.buffer.subarray(offset + payloadLen);
      void fin; // fragment 暂不支持

      switch (opcode) {
        case OPCODE_TEXT: {
          const ev = new MessageEvent("message", { data: payload.toString("utf-8") });
          this.dispatchEvent(ev);
          break;
        }
        case OPCODE_BINARY: {
          const ev = new MessageEvent("message", { data: payload });
          this.dispatchEvent(ev);
          break;
        }
        case OPCODE_CLOSE: {
          this.readyState = MiniWebSocket.CLOSED;
          this.socket?.destroy();
          break;
        }
        case OPCODE_PING: {
          this.sendPong(payload);
          break;
        }
        case OPCODE_PONG:
          break;
        default:
          console.warn(`Unknown opcode ${opcode}`);
      }
    }
  }

  private sendPong(data: Buffer) {
    if (!this.socket) return;
    const frame = Buffer.alloc(2 + data.length);
    frame[0] = 0x80 | OPCODE_PONG;
    frame[1] = data.length;
    data.copy(frame, 2);
    this.socket.write(frame);
  }

  send(data: string | Buffer) {
    if (this.readyState !== MiniWebSocket.OPEN) throw new Error("Not open");
    const isText = typeof data === "string";
    const payload = isText ? Buffer.from(data, "utf-8") : data;
    const opcode = isText ? OPCODE_TEXT : OPCODE_BINARY;

    // 构造带 mask 的 frame (client → server 必须 mask)
    const maskKey = crypto.randomBytes(4);
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.alloc(2 + 4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | payload.length;
      maskKey.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4 + 4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      maskKey.copy(header, 4);
    } else {
      throw new Error("Payload too large (max 64KB in this mini impl)");
    }

    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ maskKey[i % 4];
    }
    this.socket!.write(Buffer.concat([header, masked]));
  }

  close(code = 1000, reason?: string) {
    if (!this.socket) return;
    this.readyState = MiniWebSocket.CLOSING;
    const reasonBuf = reason ? Buffer.from(reason, "utf-8") : Buffer.alloc(0);
    const frame = Buffer.alloc(2 + 2 + reasonBuf.length);
    frame[0] = 0x80 | OPCODE_CLOSE;
    frame[1] = 2 + reasonBuf.length;
    frame.writeUInt16BE(code, 2);
    reasonBuf.copy(frame, 4);
    this.socket.write(frame, () => this.socket!.destroy());
    this.closed = true;
  }

  addEventListener(type: string, listener: (e: any) => void): void {
    super.addEventListener(type, listener as any);
  }
}
