// 文件: examples/09-01-vitest-config.ts —— 生产级 vitest.config(可直接抄)
// @ts-nocheck —— 示意代码:依赖 vitest @vitejs/plugin-react,本仓库 examples 目录不安装这些包,实际项目根目录需安装。详见 09-testing.md 9.2 节。
//
// 设计要点:
// 1. environment: jsdom —— 组件测试必备,Node 默认无 DOM
// 2. globals: true —— 免 import { describe, it, expect },与 Jest 习惯一致
// 3. setupFiles —— 集中注入 jest-dom matchers 与 MSW server
// 4. coverage.provider: 'v8' —— 比 istanbul 快且零插桩
// 5. coverage.thresholds —— 覆盖率门禁,低于即 CI 失败,防止测试萎缩
// 6. pool: 'forks' —— 多进程隔离,避免原生模块/EsmModule 跨进程问题
// 7. bail: 10 —— 连续失败 10 条立即停,避免雪崩式红一片
// 8. retry: 0 —— 单测原则上不重试,flaky 必须根治(只有 E2E 才允许重试)

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [react()],
    resolve: {
        // alias 与 vite.config 一致,避免双份维护
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',                // 默认 node,组件测试切 jsdom;追求极致速度可换 happy-dom
        globals: true,                       // 免 import { describe, it, expect }
        setupFiles: ['./tests/setup.ts'],   // 每文件执行前注入:jest-dom matchers、MSW server.listen
        include: ['tests/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/e2e/**'], // e2e 走 Playwright,不混跑
        coverage: {
            provider: 'v8',                  // 比 istanbul 快、零插桩
            reporter: ['text', 'json', 'lcov', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/main.tsx'],
            thresholds: {                   // 覆盖率门禁:低于即 CI 失败
                statements: 80,
                branches: 75,
                functions: 80,
                lines: 80,
            },
        },
        pool: 'forks',                      // 多进程隔离;threads 模式更快但共享内存
        poolOptions: {
            forks: { singleFork: true },    // 用了原生模块/EsmModule 时强制单进程
        },
        retry: 0,                           // 单测原则上不重试,flaky 必须根治
        bail: 10,                           // 连续失败 10 条立即停,避免雪崩
    },
});
