// 文件: examples/50-01-ble-frame-codec.ts
// ============ BLE 帧编解码器:分包、粘包、CRC 校验一次解决 ============
// 设计要点:
// 1) BLE 单包有效载荷通常只有 20 字节(默认 MTU 23),业务帧必须自己分片;
// 2) 串口/BLE 都是字节流:一次回调可能只有半帧,也可能粘了两帧——必须有缓冲区;
// 3) CRC 不是可选项:无线链路误码率高,没有校验就会把噪声当命令执行。

const HEADER = [0xaa, 0x55] as const;
const MAX_PAYLOAD = 32;

/** CRC-8/ATM:多项式 0x07,初始值 0,足够覆盖短帧误码 */
function crc8(bytes: number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

interface Frame {
  cmd: number;
  payload: number[];
}

function encodeFrame(cmd: number, payload: number[]): number[] {
  if (payload.length > MAX_PAYLOAD) throw new Error("payload 超长");
  const len = 1 + payload.length; // 长度字段覆盖 cmd + payload
  const body = [len, cmd, ...payload];
  return [...HEADER, ...body, crc8(body)];
}

/** 按 MTU 切片:最后一包可以短,但每包都必须带完整边界(由接收端缓冲拼接) */
function splitByMtu(frame: number[], mtu = 20): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < frame.length; i += mtu)
    chunks.push(frame.slice(i, i + mtu));
  return chunks;
}

interface ParserStats {
  frames: Frame[];
  crcErrors: number;
  pendingBytes: number;
}

class FrameParser {
  private buffer: number[] = [];
  private stats: ParserStats = { frames: [], crcErrors: 0, pendingBytes: 0 };

  feed(chunk: number[]): ParserStats {
    this.buffer.push(...chunk);
    // 循环解析:一次 feed 可能产出一帧以上(粘包)
    for (;;) {
      const start = this.findHeader();
      if (start === -1) break;
      if (start > 0) this.buffer.splice(0, start); // 丢弃帧头前的噪声
      if (this.buffer.length < 4) break; // 还不够读 len + crc
      const len = this.buffer[2];
      const total = 2 + 1 + len + 1; // header + len + body + crc
      if (this.buffer.length < total) break; // 半帧,等下一包
      const body = this.buffer.slice(3, 3 + len);
      const expect = this.buffer[3 + len];
      const actual = crc8([len, ...body]);
      if (actual !== expect) {
        this.stats.crcErrors++;
        this.buffer.splice(0, 2); // 只跳过帧头,继续找下一帧
        continue;
      }
      this.stats.frames.push({ cmd: body[0], payload: body.slice(1) });
      this.buffer.splice(0, total);
    }
    this.stats.pendingBytes = this.buffer.length;
    return { ...this.stats, frames: [...this.stats.frames] };
  }

  private findHeader(): number {
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === HEADER[0] && this.buffer[i + 1] === HEADER[1])
        return i;
    }
    return -1;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:两帧、按 20 字节切片、逐包喂入 ----------------
const f1 = encodeFrame(0x01, [0x10, 0x20, 0x30]);
const f2 = encodeFrame(
  0x02,
  Array.from({ length: 20 }, (_, i) => i),
);
console.log("帧 1:", f1.map((b) => b.toString(16).padStart(2, "0")).join(" "));
console.log(
  "帧 2 长度:",
  f2.length,
  "切片:",
  splitByMtu(f2).map((c) => c.length),
);

const parser = new FrameParser();
const stream = [...f1, ...f2];
for (const chunk of splitByMtu(stream, 20)) {
  const s = parser.feed(chunk);
  console.log(
    `喂入 ${chunk.length} 字节 → 已解析 ${s.frames.length} 帧,待拼 ${s.pendingBytes} 字节`,
  );
}
const result = parser.feed([]);
assert(result.frames.length === 2, "两帧都应被解析出来");
assert(
  result.frames[0].cmd === 0x01 && result.frames[0].payload.length === 3,
  "帧 1 内容错误",
);
assert(result.frames[1].payload.length === 20, "帧 2 的 20 字节载荷应完整重组");

// ---------------- 场景 2:半帧 ----------------
const half = new FrameParser();
const part1 = f1.slice(0, 4);
const s1 = half.feed(part1);
assert(s1.frames.length === 0 && s1.pendingBytes === 4, "半帧不应被误解析");
const s2 = half.feed(f1.slice(4));
assert(s2.frames.length === 1, "补齐后应解析出完整帧");

// ---------------- 场景 3:CRC 损坏 ----------------
const broken = [...f1];
broken[broken.length - 1] ^= 0xff;
const bad = new FrameParser();
const s3 = bad.feed(broken);
assert(
  s3.frames.length === 0 && s3.crcErrors === 1,
  "CRC 错误必须被丢弃并计数",
);

// ---------------- 场景 4:帧头前噪声 ----------------
const noisy = [0x00, 0xff, ...f1];
const s4 = new FrameParser().feed(noisy);
assert(s4.frames.length === 1, "噪声应被跳过,后续帧仍可解析");

console.log(
  "\n编解码通过:分包重组、半帧缓冲、CRC 校验、噪声跳过全部有确定行为。",
);

// 标记为模块,避免与其它示例的顶层变量重名
export {};
