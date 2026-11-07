# EP.67 数字人直播的嘴型密码

> 对应正文：[93-obs-digital-human-av.md](../93-obs-digital-human-av.md)（93.1 obs-websocket / 93.2 协议选型 / 93.3 口型同步 / 93.5 QoS）· 示例：`examples/93-01-obs-digital-human-av.ts`

## 剧情回顾

- **第 1 格**：数字人声音和嘴型对不上，观众出戏。
- **第 2 格**：码叔揭秘 TTS 音素时间轴——文本→音频→音素→口型，每步带时间戳。
- **第 3 格**：像素酱实证直播协议选型——WebRTC 超低延迟适合数字人互动。
- **第 4 格**：码叔结案——obs-websocket 控制 OBS + QoS 监控码率帧率丢包。

## 知识点拆解

### 第 1 格 · 口型同步的核心

- 数字人嘴型必须与音频精确对齐；
- 用 setTimeout 驱动口型会漂移；
- 必须用 `audio.currentTime` 驱动。

### 第 2 格 · TTS 音素时间轴

```
文本 → TTS(音频+音素时间戳) → 音素→口型映射 → blendshape 驱动
```

- TTS 必须返回每个音素的 start/end 时间；
- 基础口型：A E I O U F M SIL；
- Three.js 用 `morphTargetInfluences` 驱动口型。

### 第 3 格 · 直播协议选型

| 协议 | 延迟 | 场景 |
|---|---|---|
| WebRTC | <500ms | 数字人互动、连麦 |
| RTMP | 1-3s | 推流 |
| HTTP-FLV | 1-3s | PC 海量播放 |
| HLS | 5-30s | 移动端海量 |

数字人实时互动必须用 WebRTC（TRTC/火山引擎）。

### 第 4 格 · obs-websocket 与 QoS

- obs-websocket v5 请求-响应协议，控制 OBS 场景/推流/静音；
- QoS 指标：码率、帧率、丢包率、RTT；
- 弱网降级：降分辨率→降帧率→关摄像头。

## 坑点清单

> 🔗 正文对照：[《93.7 本章避坑清单》](../93-obs-digital-human-av#_93-7-本章避坑清单)

1. 用 setTimeout 驱动口型 → 漂移，应用 audio.currentTime；
2. 数字人用 HLS → 延迟 5s+，应用 WebRTC；
3. flv.js 延迟越来越大 → 设 isLive:true，超阈值重连。

## 自测 3 题（含答案）

1. 数字人口型同步的完整链路？——**文本→TTS(带时间戳)→音素→口型→blendshape 驱动**。
2. 数字人实时互动用什么直播协议？——**WebRTC（TRTC/火山引擎），延迟<500ms**。
3. obs-websocket 切换场景和开关推流的请求类型？——**SetCurrentProgramScene / StartStopStreaming**。
