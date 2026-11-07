// 文件: examples/117-03-safe-area-1px.ts
// 安全区与 1px：env(safe-area-inset-*) 的布局换算、DPR 取整与 hairline 物理像素对齐
// 目标：导航/底栏高度含安全区、内容不被刘海遮挡、1px 边框在任何 DPR 下都是 1 物理像素

import assert from 'node:assert';

interface SafeAreaInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface ContentPadding {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 顶部导航总高 = 视觉高度 + 状态栏/刘海安全区 */
function navHeight(baseHeight: number, insets: SafeAreaInsets): number {
    return baseHeight + insets.top;
}

/** 底部标签栏总高 = 按钮区高度 + Home Indicator 安全区 */
function tabBarHeight(baseHeight: number, insets: SafeAreaInsets): number {
    return baseHeight + insets.bottom;
}

/** 滚动内容四向内边距：左右安全区用于横屏刘海，底部额外留白给吸底按钮 */
function contentPadding(insets: SafeAreaInsets, extraBottom = 0): ContentPadding {
    return {
        top: insets.top,
        right: insets.right,
        bottom: insets.bottom + extraBottom,
        left: insets.left,
    };
}

/** 把 CSS 长度对齐到设备物理像素栅格（避免浏览器二次取整产生 1.5 物理像素） */
function snapToDevicePixel(cssPx: number, dpr: number): number {
    return Math.round(cssPx * dpr) / dpr;
}

/** hairline：无论 DPR 多少，画出来恰好是 1 个物理像素 */
function hairline(dpr: number, physicalPx = 1): number {
    return snapToDevicePixel(physicalPx / dpr, dpr);
}

function runAssertions() {
    // ---------- 测试 1：无刘海 Android——安全区为 0，布局不应凭空加高 ----------
    assert.equal(navHeight(44, ZERO_INSETS), 44);
    assert.equal(tabBarHeight(56, ZERO_INSETS), 56);
    assert.deepEqual(contentPadding(ZERO_INSETS), { top: 0, right: 0, bottom: 0, left: 0 });
    console.log('[1/4] 零安全区 OK, 导航:', navHeight(44, ZERO_INSETS));

    // ---------- 测试 2：iPhone 刘海屏——导航/底栏/内容三处都要吃安全区 ----------
    const iphone: SafeAreaInsets = { top: 47, right: 0, bottom: 34, left: 0 };
    assert.equal(navHeight(44, iphone), 91, '导航 44 + 状态栏 47');
    assert.equal(tabBarHeight(49, iphone), 83, '标签栏 49 + Home Indicator 34');
    assert.deepEqual(contentPadding(iphone, 12), { top: 47, right: 0, bottom: 46, left: 0 });
    // 横屏时刘海移到左右，必须补 left/right，否则文字钻到刘海下面
    const landscape: SafeAreaInsets = { top: 0, right: 47, bottom: 21, left: 47 };
    assert.deepEqual(contentPadding(landscape), { top: 0, right: 47, bottom: 21, left: 47 });
    console.log('[2/4] 刘海屏安全区 OK, 底栏:', tabBarHeight(49, iphone));

    // ---------- 测试 3：hairline 在不同 DPR 下都是 1 物理像素 ----------
    const h1 = hairline(1);
    const h2 = hairline(2);
    const h3 = hairline(3);
    assert.equal(h1, 1, 'DPR 1 时 1px 就是 1 CSS px');
    assert.equal(h2, 0.5, 'DPR 2 时应为 0.5 CSS px');
    assert.equal(h3, 1 / 3, 'DPR 3 时应为 1/3 CSS px');
    assert.ok(Math.abs(h2 * 2 - 1) < 1e-9, 'DPR 2 下物理宽度应为 1');
    assert.ok(Math.abs(h3 * 3 - 1) < 1e-9, 'DPR 3 下物理宽度应为 1');
    console.log('[3/4] hairline OK, DPR2:', h2, 'DPR3:', h3.toFixed(4));

    // ---------- 测试 4：任意小数边框对齐物理像素栅格，不产生 1.5 物理像素 ----------
    assert.equal(snapToDevicePixel(0.5, 3), 2 / 3, '0.5 CSS px @3x 对齐到 2 物理像素');
    assert.equal(snapToDevicePixel(1.234, 2), 1, '1.234 CSS px @2x 对齐到 2 物理像素（1 CSS px）');
    assert.ok(Math.abs(snapToDevicePixel(0.5, 3) * 3 - 2) < 1e-9);
    const tripleHairline = hairline(3) * 3 * 3;
    assert.ok(Math.abs(tripleHairline - 3) < 1e-9, '三条 hairline 合计 3 个物理像素');
    console.log('[4/4] DPR 对齐 OK, 0.5@3x 物理像素:', snapToDevicePixel(0.5, 3) * 3);

    console.log('\n✅ 117-03 安全区与 1px 计算 全部断言通过');
}

runAssertions();
