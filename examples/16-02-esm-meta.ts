// 文件: examples/16-02-esm-meta.ts —— ESM 环境下替代 __dirname / __filename
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM 中没有 __dirname(它是 CJS 的包装变量),标准替代:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log('当前目录:', __dirname);

// 环境变量:12-Factor 的配置原则 —— 配置全部来自环境,代码不分环境
const PORT = Number(process.env.PORT ?? 3000);
const NODE_ENV = process.env.NODE_ENV ?? 'development';
console.log(`启动配置: env=${NODE_ENV}, port=${PORT}`);

// 💡 顶层 await 在 ESM 中合法(浏览器 module 脚本同理),CJS 不行
const exists = fs.existsSync(__dirname);
console.log('目录存在:', exists);
