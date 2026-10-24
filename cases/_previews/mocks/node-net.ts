/**
 * 08-mini-network-stack-lab 的 node:* 模块浏览器 shim。
 *
 * sse.ts / cache.ts 顶层 `import { fetch as defaultFetch } from "./fetch.js"`，
 * fetch.ts 又 import node:http/https/url/buffer——demo 全部走注入式 fetcher，
 * 不会真正调用这些模块，因此 http/https 给「一调就抛错」的 stub 即可；
 * Buffer 是 http-parser 的真实依赖（demo 的报文解析演示会用到），给最小实现。
 */

const encoder = new TextEncoder();
const decoderUtf8 = new TextDecoder("utf-8");

function decodeAscii(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

function toBytes(input: string, enc?: string): Uint8Array {
  if (enc === "ascii" || enc === "latin1" || enc === "binary") {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff;
    return out;
  }
  return encoder.encode(input);
}

/** 最小 Buffer：覆盖 http-parser 实际用到的方法面 */
export class MiniBuffer extends Uint8Array {
  static from(
    input: string | Uint8Array | MiniBuffer | number[],
    enc?: string,
  ): MiniBuffer {
    const bytes =
      typeof input === "string" ? toBytes(input, enc) : new Uint8Array(input);
    const out = new MiniBuffer(bytes.length);
    out.set(bytes);
    return out;
  }

  static alloc(size: number, fill: number | string = 0): MiniBuffer {
    const out = new MiniBuffer(size);
    if (typeof fill === "number") out.fill(fill);
    else out.set(toBytes(fill).slice(0, size));
    return out;
  }

  static concat(list: Array<Uint8Array | MiniBuffer>): MiniBuffer {
    const total = list.reduce((s, b) => s + b.length, 0);
    const out = new MiniBuffer(total);
    let off = 0;
    for (const b of list) {
      out.set(b, off);
      off += b.length;
    }
    return out;
  }

  static isBuffer(v: unknown): v is MiniBuffer {
    return v instanceof MiniBuffer;
  }

  get length(): number {
    return this.byteLength;
  }

  toString(enc = "utf8"): string {
    if (enc === "ascii" || enc === "latin1" || enc === "binary")
      return decodeAscii(this);
    return decoderUtf8.decode(this);
  }

  subarray(start?: number, end?: number): MiniBuffer {
    const u8 = super.subarray(start, end);
    const out = new MiniBuffer(u8.length);
    out.set(u8);
    return out;
  }

  slice(start?: number, end?: number): MiniBuffer {
    return this.subarray(start, end);
  }

  indexOf(needle: string | number | Uint8Array, byteOffset = 0): number {
    if (typeof needle === "number")
      return super.indexOf(needle as never, byteOffset);
    const hay = typeof needle === "string" ? toBytes(needle) : needle;
    outer: for (let i = byteOffset; i <= this.length - hay.length; i++) {
      for (let j = 0; j < hay.length; j++)
        if (this[i + j] !== hay[j]) continue outer;
      return i;
    }
    return -1;
  }
}

function stub(name: string): { createConnection(): never; request(): never } {
  return {
    createConnection() {
      throw new Error(
        `demo 不支持真实网络：${name} 已被浏览器 shim 替换（预览走注入式 fetcher）`,
      );
    },
    request() {
      throw new Error(
        `demo 不支持真实网络：${name} 已被浏览器 shim 替换（预览走注入式 fetcher）`,
      );
    },
  };
}

export const http = stub("node:http");
export const https = stub("node:https");

// `import http from "node:http"` / `import https from "node:https"`：默认导出同一个 stub 面
export default { ...http, ...https };

// `import { Buffer } from "node:buffer"`：类型来自 @types/node，运行时被 esbuild alias 指到这里
export { MiniBuffer as Buffer };

// `import { URL } from "node:url"` 的浏览器语义：全局 URL 本身就是 WHATWG 实现
const GlobalURL = URL;
export { GlobalURL as URL };
