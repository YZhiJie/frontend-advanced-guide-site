/**
 * 第 93 部分 · obs-websocket 与数字人音视频
 * JD 需求点：数字人直播控台 JD 要求 obs-websocket 控制 OBS（场景/源/推流）、
 *   TRTC/火山引擎实时音视频、flv.js 直播流播放、数字人 TTS 口型驱动、多路混流。
 * 本示例在 Node 环境模拟：
 *   1) obs-websocket 请求/响应协议（SetCurrentProgramScene/StartStopStreaming）
 *   2) 直播流协议选型（RTMP/FLV/HLS/WebRTC 按场景路由）
 *   3) 数字人口型同步（TTS 音频时长 → 音素序列 → 驱动虚拟形象）
 *   4) 音视频质量 QoS 监控（码率/帧率/丢包 → 健康分）
 * 运行：npx tsx examples/93-01-obs-digital-human-av.ts
 */
import assert from "node:assert";

// ---------- 1. obs-websocket 协议模拟 ----------
// obs-websocket v5 协议：客户端发 Request(op, data)，服务端回 Response(op, status)
type ObsRequest = {
  requestType: string;
  requestData?: Record<string, unknown>;
};
type ObsResponse = {
  requestType: string;
  requestStatus: { result: boolean; code: number; comment?: string };
  responseData?: Record<string, unknown>;
};

// 模拟 OBS 状态
interface ObsState {
  scenes: string[];
  currentScene: string;
  streaming: boolean;
  sources: Record<string, { visible: boolean; muted: boolean }>;
}

function createObsState(): ObsState {
  return {
    scenes: ["直播主场景", "待机画面", "商品展示"],
    currentScene: "待机画面",
    streaming: false,
    sources: {
      "摄像头": { visible: true, muted: false },
      "数字人": { visible: true, muted: false },
      "背景图": { visible: true, muted: true },
    },
  };
}

// 处理 obs-websocket 请求
function handleObsRequest(state: ObsState, req: ObsRequest): ObsResponse {
  switch (req.requestType) {
    case "SetCurrentProgramScene": {
      const name = req.requestData?.sceneName as string;
      if (!state.scenes.includes(name)) {
        return { requestType: req.requestType, requestStatus: { result: false, code: 600, comment: "场景不存在" } };
      }
      state.currentScene = name;
      return { requestType: req.requestType, requestStatus: { result: true, code: 100 } };
    }
    case "StartStopStreaming": {
      state.streaming = !state.streaming;
      return {
        requestType: req.requestType,
        requestStatus: { result: true, code: 100 },
        responseData: { streaming: state.streaming },
      };
    }
    case "SetInputMute": {
      const name = req.requestData?.inputName as string;
      const muted = req.requestData?.inputMuted as boolean;
      if (!state.sources[name]) {
        return { requestType: req.requestType, requestStatus: { result: false, code: 601, comment: "源不存在" } };
      }
      state.sources[name].muted = muted;
      return { requestType: req.requestType, requestStatus: { result: true, code: 100 } };
    }
    case "SetInputVisibility": // v5 中是 SetSceneItemEnabled
    default:
      return { requestType: req.requestType, requestStatus: { result: false, code: 900, comment: "未知请求" } };
  }
}

// ---------- 2. 直播流协议选型路由 ----------
type StreamProtocol = "RTMP" | "HTTP-FLV" | "HLS" | "WebRTC";
interface StreamScene {
  latency: "ultra-low" | "low" | "normal"; // 超低延迟/低延迟/常规
  audience: "one-to-one" | "few" | "mass";  // 一对一/少量/海量
  platform: "pc" | "mobile" | "all";
}

function selectProtocol(scene: StreamScene): StreamProtocol {
  // 实时互动（连麦/数字人驱动）→ WebRTC
  if (scene.latency === "ultra-low") return "WebRTC";
  // 直播推拉流 → RTMP
  if (scene.latency === "low" && scene.audience !== "mass") return "RTMP";
  // 海量观众 + 移动端 → HLS
  if (scene.audience === "mass" && scene.platform !== "pc") return "HLS";
  // 海量观众 + PC → HTTP-FLV（flv.js）
  return "HTTP-FLV";
}

// ---------- 3. 数字人口型同步 ----------
// 文本 → TTS 音频 → 音素序列 → 驱动口型（简化：按字符切分，映射到基础口型）
type Viseme = "A" | "E" | "I" | "O" | "U" | "F" | "M" | "SIL"; // 口型基元

interface TTSResult {
  audioUrl: string;
  duration: number; // 秒
  words: { text: string; start: number; end: number }[];
}

// 简易 TTS：按字数估算时长（中文每秒 4 字）
function fakeTTS(text: string): TTSResult {
  const chars = text.replace(/\s/g, "");
  const perChar = 0.25; // 每字 0.25s
  const duration = chars.length * perChar;
  const words = chars.split("").map((c, i) => ({
    text: c,
    start: i * perChar,
    end: (i + 1) * perChar,
  }));
  return { audioUrl: `tts://${encodeURIComponent(text)}`, duration, words };
}

// 字符 → 口型（粗略映射）
function charToViseme(ch: string): Viseme {
  if (/[aeiou]/i.test(ch)) return ch.toLowerCase() as Viseme;
  if (/[bpm]/i.test(ch)) return "M";
  if (/[fv]/i.test(ch)) return "F";
  if (/[，。、,.!?！？]/.test(ch)) return "SIL";
  return "A"; // 默认开口
}

// 生成口型时间轴
function generateVisemeTimeline(tts: TTSResult): { viseme: Viseme; start: number; end: number }[] {
  return tts.words.map((w) => ({
    viseme: charToViseme(w.text),
    start: w.start,
    end: w.end,
  }));
}

// ---------- 4. 音视频 QoS 健康分 ----------
interface AVStats {
  bitrate: number;    // kbps
  fps: number;
  packetLoss: number; // %
  rtt: number;        // ms
}

function avHealthScore(s: AVStats): number {
  // 码率 1500~4000 满分，< 500 很差
  const bitrateScore = s.bitrate < 500 ? 30 : s.bitrate > 4000 ? 80 : 100;
  // 帧率 >= 24 满分，< 10 很差
  const fpsScore = s.fps >= 24 ? 100 : s.fps >= 15 ? 70 : 30;
  // 丢包 0 满分，> 5 很差
  const lossScore = s.packetLoss === 0 ? 100 : s.packetLoss < 2 ? 70 : 30;
  // 延迟 < 100 满分，> 300 很差
  const rttScore = s.rtt < 100 ? 100 : s.rtt < 300 ? 70 : 30;
  return Math.round((bitrateScore + fpsScore + lossScore + rttScore) / 4);
}

// ===================== 运行断言 =====================
console.log("===== 1. obs-websocket 协议 =====");
const obs = createObsState();
const r1 = handleObsRequest(obs, { requestType: "SetCurrentProgramScene", requestData: { sceneName: "直播主场景" } });
assert(r1.requestStatus.result === true, "切换到存在的场景应成功");
assert(obs.currentScene === "直播主场景", "当前场景应为直播主场景");

const r2 = handleObsRequest(obs, { requestType: "SetCurrentProgramScene", requestData: { sceneName: "不存在" } });
assert(r2.requestStatus.result === false, "切换到不存在的场景应失败");

const r3 = handleObsRequest(obs, { requestType: "StartStopStreaming" });
assert(obs.streaming === true, "StartStopStreaming 应开启推流");
const r4 = handleObsRequest(obs, { requestType: "StartStopStreaming" });
assert(obs.streaming === false, "再次调用应关闭推流");
console.log("✓ 场景切换 + 推流开关 + 错误码全部正确");

console.log("\n===== 2. 直播流协议选型 =====");
assert(selectProtocol({ latency: "ultra-low", audience: "one-to-one", platform: "all" }) === "WebRTC", "超低延迟→WebRTC");
assert(selectProtocol({ latency: "low", audience: "few", platform: "pc" }) === "RTMP", "低延迟少量→RTMP");
assert(selectProtocol({ latency: "normal", audience: "mass", platform: "mobile" }) === "HLS", "海量移动端→HLS");
assert(selectProtocol({ latency: "normal", audience: "mass", platform: "pc" }) === "HTTP-FLV", "海量PC→HTTP-FLV");
console.log("✓ 协议选型：WebRTC/RTMP/HLS/HTTP-FLV 路由正确");

console.log("\n===== 3. 数字人口型同步 =====");
const tts = fakeTTS("你好世界");
assert(tts.duration === 1.0, `4 字应 1.0 秒，实际 ${tts.duration}`);
assert(tts.words.length === 4, "应有 4 个词元");
const timeline = generateVisemeTimeline(tts);
assert(timeline.length === 4, "口型时间轴应有 4 段");
assert(timeline[0].viseme === "A", "中文默认开口 A");
console.log(`✓ TTS 时长=${tts.duration}s，口型段数=${timeline.length}`);

console.log("\n===== 4. 音视频 QoS 健康分 =====");
const excellent = avHealthScore({ bitrate: 2500, fps: 30, packetLoss: 0, rtt: 50 });
assert(excellent >= 90, `优秀网络应≥90分，实际 ${excellent}`);
const bad = avHealthScore({ bitrate: 300, fps: 8, packetLoss: 8, rtt: 400 });
assert(bad <= 40, `差网络应≤40分，实际 ${bad}`);
console.log(`✓ 健康分：优秀=${excellent}，差=${bad}`);

console.log("\n✅ obs-websocket + 协议选型 + 口型同步 + QoS 监控全部通过");
