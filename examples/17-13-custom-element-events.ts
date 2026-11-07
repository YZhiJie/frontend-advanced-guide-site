/**
 * 17-13 自定义元素事件与响应式 —— CustomEvent + attributeChangedCallback
 * [浏览器] 需在页面环境运行。
 */

class ToggleSwitch extends HTMLElement {
    static get observedAttributes() {
        return ['checked', 'disabled']; // 只有这些属性变化才触发 callback
    }

    private bound = false; // 防止重复绑监听

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>
                :host { display: inline-block; cursor: pointer; }
                :host([disabled]) { opacity: 0.5; cursor: not-allowed; }
                .track { width: 44px; height: 22px; background: #ccc; border-radius: 11px; position: relative; transition: 0.2s; }
                .track.on { background: #1890ff; }
                .thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: 0.2s; }
                .track.on .thumb { transform: translateX(22px); }
            </style>
            <div class="track"><div class="thumb"></div></div>
        `;
    }

    connectedCallback() {
        if (this.bound) return; // 防重复(组件可能反复挂/卸)
        this.bound = true;
        this.addEventListener('click', this.onClick);
        // ⚠️ 焦点与键盘:WCAG 要求开关可用空格/回车切换
        this.setAttribute('role', 'switch');
        this.setAttribute('tabindex', '0');
        this.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.onClick(); }
        });
    }

    disconnectedCallback() {
        // ⚠️ 用命名函数引用才能 removeEventListener —— 匿名函数永远解绑失败
        this.removeEventListener('click', this.onClick);
    }

    private onClick = () => {
        if (this.hasAttribute('disabled')) return;
        this.checked = !this.checked; // setter 会同步属性 → 触发 attributeChangedCallback
    };

    // 属性 ↔ 属性 的桥接(setter 写 attribute,callback 读 attribute)
    get checked() { return this.hasAttribute('checked'); }
    set checked(val: boolean) {
        val ? this.setAttribute('checked', '') : this.removeAttribute('checked');
    }

    attributeChangedCallback(name: string, _old: string, _new: string) {
        const track = this.shadowRoot!.querySelector('.track');
        if (name === 'checked') {
            track?.classList.toggle('on', this.checked);
            this.setAttribute('aria-checked', String(this.checked));
            // ✅ 向外发事件:CustomEvent + composed:true(穿透 Shadow DOM 边界)
            this.dispatchEvent(new CustomEvent('change', {
                detail: { checked: this.checked },
                bubbles: true,    // 冒泡到父级
                composed: true,   // 穿透 Shadow DOM —— 外部监听才能收到
            }));
        }
        if (name === 'disabled') {
            this.setAttribute('aria-disabled', String(this.hasAttribute('disabled')));
        }
    }
}

customElements.define('toggle-switch', ToggleSwitch);
export {};
