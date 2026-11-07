// 文件: examples/16-03-stream-pipeline.ts —— 流的实战:复制 + 逐行统计(纯 Node 可运行)
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import path from 'node:path';

// ---- 场景一:大文件复制(pipeline 自动处理背压与错误传播) ----
async function copyFile(src: string, dest: string) {
    await pipeline(
        fs.createReadStream(src),          // 可读流:按 chunk 读
        fs.createWriteStream(dest),        // 可写流:按 chunk 写,写不动就通知上游暂停
    );
    console.log(`复制完成: ${src} → ${dest}`);
}

// ---- 场景二:流式处理 —— 统计文件行数,内存占用与文件大小无关 ----
function lineCounter() {
    let lines = 0;
    // 统计是"终端消费者" → 用 Writable(不需要向下传数据)
    // ⚠️ 经典坑:如果把 Transform 放在 pipeline 末端,它的 readable 侧没有消费者,
    //    'end' 永远不会触发,await pipeline 会永久挂起 —— 末端只选 Writable
    return new Writable({
        write(chunk: Buffer, _enc, callback) {
            lines += chunk.toString().split('\n').length - 1;
            callback(); // 处理完这个 chunk 了,可以给我下一个
        },
        final(callback) {           // 上游全部写完后的最后一步
            console.log(`总行数: ${lines}`);
            callback();
        },
    });
}
// 若还要继续向下加工数据,才用 Transform:transform(chunk, enc, cb) { cb(null, 加工后的chunk) }

// ---- 演示:先造一个 10 万行的文件,再流式统计 ----
const big = path.join(import.meta.dirname ?? '.', 'demo-big.log');
fs.writeFileSync(big, Array.from({ length: 100_000 }, (_, i) => `line ${i}`).join('\n'));

await copyFile(big, big + '.copy');
await pipeline(fs.createReadStream(big), lineCounter());

fs.rmSync(big, { force: true });
fs.rmSync(big + '.copy', { force: true });
