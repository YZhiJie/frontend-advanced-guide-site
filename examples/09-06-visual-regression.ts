// 文件: examples/09-06-visual-regression.ts —— Playwright 视觉回归示例
// @ts-nocheck —— 示意代码:依赖 @playwright/test,本仓库 examples 不安装该包。实际项目需 npm i -D @playwright/test。详见 09-testing.md 9.6 节。
//
// 设计要点:
// 1. maxDiffPixelRatio: 0.01 —— 允许 1% 像素差异(抗锯齿/字体渲染抖动)
// 2. animations: 'disabled' —— 关掉动画,避免截图时机不稳
// 3. fullPage: true —— 整页,不只是首屏,捕获滚动后才出现的回归
// 4. 首次跑生成 baseline,后续跑对比,差异 >1% 即测试红
// 5. 更新 baseline: npx playwright test --update-snapshots

import { test, expect } from '@playwright/test';

test('Dashboard 主页视觉稳定', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveScreenshot('dashboard.png', {
        maxDiffPixelRatio: 0.01,         // 允许 1% 像素差异(抗锯齿/字体渲染抖动)
        threshold: 0.2,                  // 单像素颜色阈值
        animations: 'disabled',          // 关掉动画,避免截图时机不稳
        fullPage: true,                  // 整页,不只是首屏
    });
});

test('移动端首屏视觉稳定', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveScreenshot('mobile-home.png', {
        maxDiffPixelRatio: 0.01,
        fullPage: true,
    });
});
