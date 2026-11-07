// 文件: examples/18-05-worklet/audio-main.js
// 主线程：加载 AudioWorklet 模块，把麦克风接入 vumeter 节点，接收音量值更新 UI。

document.querySelector('#mic').addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        await ctx.audioWorklet.addModule('./vumeter-processor.js'); // 必须先加载

        const source = ctx.createMediaStreamSource(stream);
        const meter = new AudioWorkletNode(ctx, 'vumeter');
        source.connect(meter);
        // 注意：不 connect(ctx.destination)，只分析不播放，避免麦克风回授啸叫

        const levelEl = document.querySelector('#level');
        meter.port.onmessage = (e) => {
            levelEl.style.width = `${Math.min(100, e.data * 140).toFixed(1)}%`;
        };
        document.querySelector('#mic').textContent = '✅ 正在监听，对着麦克风说话';
    } catch (err) {
        alert('麦克风不可用或被拒绝：' + err.message);
    }
});
