// 文件: examples/18-01-cross-tab/app.js
// 跨 Tab 通信双通道演示：
//   通道 1：BroadcastChannel（实时广播，首选）
//   通道 2：localStorage + storage 事件（兼容老浏览器 + 天然持久化）
// 注意：写入的 Tab 自己不会收到广播/storage 事件，本地状态直接在写入处更新。

const SELF = 'tab-' + Math.random().toString(36).slice(2, 8);
document.querySelector('#self').textContent = SELF;

const CHANNEL_NAME = 'demo-cross-tab';
const STORE_KEYS = { count: 'demo.count', theme: 'demo.theme' };

const state = {
    count: Number(JSON.parse(localStorage.getItem(STORE_KEYS.count) || '{}').value || 0),
    theme: JSON.parse(localStorage.getItem(STORE_KEYS.theme) || '{}').value || 'light',
};

const logEl = document.querySelector('#log');
function render(source = '本地') {
    document.querySelector('#count').textContent = state.count;
    document.querySelector('#theme').textContent = state.theme;
    document.documentElement.dataset.theme = state.theme;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${source} → count=${state.count}, theme=${state.theme}`;
    logEl.prepend(line);
}

// ---- 通道 1：BroadcastChannel ----
let bus = null;
if ('BroadcastChannel' in window) {
    bus = new BroadcastChannel(CHANNEL_NAME);
    bus.onmessage = (e) => {
        // 其他 Tab 的写入在此接收；自己不会收到，无回声问题
        applyRemote(e.data, 'BroadcastChannel');
    };
}

// ---- 通道 2：storage 事件（BroadcastChannel 不可用时也在工作，起持久化+兜底作用）----
window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEYS.count && e.newValue) {
        const { value, ts, from } = JSON.parse(e.newValue);
        state.count = value;
        render(`storage 事件(来自 ${from})`);
    }
    if (e.key === STORE_KEYS.theme && e.newValue) {
        const { value, ts, from } = JSON.parse(e.newValue);
        state.theme = value;
        render(`storage 事件(来自 ${from})`);
    }
});

function applyRemote(msg, via) {
    if (msg.type === 'COUNT') state.count = msg.value;
    if (msg.type === 'THEME') state.theme = msg.value;
    render(`${via}(来自 ${msg.from})`);
}

// ---- 本地操作：更新本地状态 + 落盘 + 广播 ----
function emit(type, key, value) {
    const envelope = { type, value, from: SELF, ts: Date.now() };
    localStorage.setItem(key, JSON.stringify({ value, from: SELF, ts: Date.now() })); // 持久化（ts 保证每次都是新值）
    bus?.postMessage(envelope);
    render('本地操作');
}

document.querySelector('#inc').addEventListener('click', () => {
    emit('COUNT', STORE_KEYS.count, state.count + 1);
});
document.querySelector('#toggle').addEventListener('click', () => {
    emit('THEME', STORE_KEYS.theme, state.theme === 'light' ? 'dark' : 'light');
});

// 新 Tab 初始化：直接读持久层快照（BroadcastChannel 无法补发历史消息）
render('初始化读取');
