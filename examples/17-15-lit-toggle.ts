// 文件: examples/17-15-lit-toggle.ts —— [浏览器] Lit 版的 ToggleSwitch
// @ts-nocheck —— 示意代码:实际运行需 npm i lit(本项目无依赖,故跳过类型检查)
// npm i lit
// import { LitElement, html, css } from 'lit';
// import { customElement, property } from 'lit/decorators.js';

declare const LitElement: typeof import("lit").LitElement;
declare const html: typeof import("lit").html;
declare const css: typeof import("lit").css;
// const { customElement, property } = await import('lit/decorators.js');

// @customElement('lit-toggle')  // 自动注册 <lit-toggle>
class LitToggle extends LitElement {
  // @property({ type: Boolean })  // 自动桥接 attribute ↔ property,触发 attributeChanged
  checked = false;

  // @property({ type: Boolean, reflect: true })  // reflect: 属性变化回写到 HTML attribute
  disabled = false;

  static styles = css`
    :host {
      display: inline-block;
      cursor: pointer;
    }
    .track {
      width: 44px;
      height: 22px;
      background: #ccc;
      border-radius: 11px;
      transition: 0.2s;
    }
    .track.on {
      background: #1890ff;
    }
    .thumb {
      width: 18px;
      height: 18px;
      background: #fff;
      border-radius: 50%;
      margin: 2px;
      transition: 0.2s;
    }
    .track.on .thumb {
      transform: translateX(22px);
    }
  `; // ✅ Lit 自动创建 Shadow DOM + 样式隔离,不需要手动 attachShadow

  render() {
    // ✅ html 模板自动追踪依赖,只有 checked 变了才更新 DOM(类似 Vue 的细粒度响应式)
    return html`
      <div class="track ${this.checked ? "on" : ""}" @click=${this.toggle}>
        <div class="thumb"></div>
      </div>
    `;
  }

  private toggle() {
    if (this.disabled) return;
    this.checked = !this.checked;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { checked: this.checked },
        bubbles: true,
        composed: true, // 穿透 Shadow DOM
      }),
    );
  }
}

// 对比:原生版 50+ 行(手动 attachShadow、attributeChangedCallback、observedAttributes),
// Lit 版 20 行——样板代码由框架处理,开发者只写业务逻辑
export {};
