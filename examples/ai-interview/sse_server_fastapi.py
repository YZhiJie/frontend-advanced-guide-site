# 文件: examples/ai-interview/sse_server_fastapi.py —— [Python] FastAPI 版 SSE 服务端
# 运行方式: pip install fastapi uvicorn && uvicorn sse_server_fastapi:app --reload
#           curl -N http://127.0.0.1:8000/stream
# 关联文档: 21-frontend-ai-interview.md 21.1.4
import asyncio
import json

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()


async def event_gen():
    """异步生成器：每帧 = data 行 + 空行；生产中在反向代理层关闭 buffering。"""
    tokens = ["你好", "，", "世界"]
    for i, tok in enumerate(tokens):
        payload = json.dumps({"delta": tok}, ensure_ascii=False)
        yield f"id: {i}\nevent: token\ndata: {payload}\n\n"
        await asyncio.sleep(0.2)
    yield "event: done\ndata: [DONE]\n\n"


@app.get("/stream")
async def stream():
    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 告诉 Nginx 不要缓冲本响应
        },
    )
