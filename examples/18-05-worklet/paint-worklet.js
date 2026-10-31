// 文件: examples/18-05-worklet/paint-worklet.js
// PaintWorklet：通过 registerPaint 注册一个可被 CSS paint() 引用的绘制类。
// 运行在绘制管线中，ctx 是受限版 Canvas 2D 上下文，无 DOM/window。

class CornerBeads {
    // 声明依赖的自定义属性：属性变化时浏览器自动使对应元素重绘
    static get inputProperties() {
        return ['--bead-color', '--bead-count'];
    }

    paint(ctx, size, properties) {
        const count = parseInt(properties.get('--bead-count').toString(), 10) || 8;
        ctx.fillStyle = (properties.get('--bead-color') || '#3b82f6').toString();

        const r = 4;
        // 底边一排均匀分布的小圆点（可替换为网格/噪声/棋盘等程序化纹理）
        for (let i = 0; i < count; i++) {
            const x = count === 1 ? size.width / 2 : (size.width / (count - 1)) * i;
            ctx.beginPath();
            ctx.arc(x, size.height - r - 2, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

registerPaint('corner-beads', CornerBeads);
