// 文件: examples/18-05-worklet/vumeter-processor.js
// AudioWorklet 处理器：运行在实时音频线程，每次 process 固定 128 个采样。
// 铁律：这里禁止分配对象/console/阻塞等待，否则爆音。

class VUMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.peak = 0;
        this.ticks = 0;
    }

    process(inputs) {
        const channel = inputs[0] && inputs[0][0]; // 第一个输入的第一个声道
        if (channel) {
            for (let i = 0; i < channel.length; i++) {
                const v = channel[i];
                if (v > this.peak) this.peak = v;
                else if (-v > this.peak) this.peak = -v;
            }
            // 每 ~8 个块（约 23ms@44.1k）上报一次，避免消息风暴
            if (++this.ticks % 8 === 0 && this.peak > 0.0005) {
                this.port.postMessage(this.peak);
            }
            this.peak *= 0.9; // 峰值回落
        }
        return true; // 返回 true 保持节点存活；false 会销毁处理器
    }
}

registerProcessor('vumeter', VUMeterProcessor);
