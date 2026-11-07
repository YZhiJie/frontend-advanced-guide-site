// 文件: examples/ai-interview/sse-fetch-client.ts —— 生产级 SSE 客户端（POST/鉴权头/残帧缓冲/可中止）
// 运行方式: 浏览器环境调用；Node 18+ 亦可配合本目录 sse-server-node.mjs 验证（全局 fetch/TextDecoder）
// 关联文档: 21-frontend-ai-interview.md 21.1.4
export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface SseHandlers {
  onEvent?: (event: SseEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export interface StreamChatOptions {
  url: string;
  body: unknown;
  token: string; // 鉴权头——EventSource 做不到，fetch 可以
  signal?: AbortSignal;
}

/**
 * 用 fetch 消费 SSE：LLM 场景需要 POST + Authorization + AbortController，
 * 原生 EventSource 三者都不支持，协议格式仍按 text/event-stream 手动解析。
 */
export async function streamSSE(
  opts: StreamChatOptions,
  handlers: SseHandlers = {},
): Promise<void> {
  const { url, body, token, signal } = opts;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  // 非 200：先读出错误体再抛分类错误（流接口的 4xx/5xx 往往是 JSON）
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`SSE HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ""; // 残帧缓冲：网络 chunk 边界与协议帧边界毫无关系

  const dispatch = (block: string): void => {
    const evt: SseEvent = { event: "message", data: "" };
    const dataLines: string[] = [];
    for (const rawLine of block.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith(":"))
        continue; // 注释/心跳
      else if (line.startsWith("data:"))
        dataLines.push(line.slice(5).replace(/^ /, ""));
      else if (line.startsWith("event:")) evt.event = line.slice(6).trim();
      else if (line.startsWith("id:")) evt.id = line.slice(3).trim();
    }
    if (dataLines.length) {
      evt.data = dataLines.join("\n"); // 多行 data 分发时用 \n 拼接
      handlers.onEvent?.(evt);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // stream: true —— 多字节 UTF-8（半个汉字）跨 chunk 时保留残字节，否则乱码
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // 空行（\n\n）结束一帧；最后一段可能是残帧，留到下次
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawBlock = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatch(rawBlock);
      }
    }
    if (buffer.trim()) dispatch(buffer); // 宽容服务端漏发最后空行
    handlers.onClose?.();
  } catch (err) {
    // 用户主动停止不算错误：不弹提示、不自动重连
    if ((err as Error).name === "AbortError") {
      handlers.onClose?.();
      return;
    }
    handlers.onError?.(err as Error);
  }
}

// ---- 使用方式（在浏览器/业务代码中）----
// const controller = new AbortController();
// streamSSE(
//     { url: '/api/chat', body: { messages: [] }, token: userToken, signal: controller.signal },
//     {
//         onEvent: (e) => {
//             if (e.event === 'done') return;
//             const delta = JSON.parse(e.data).delta as string;
//             console.log('增量：', delta);
//         },
//     },
// );
// 停止生成：controller.abort();
