<!--
  11-09 Vue 3 接入 EventBus —— 组合式 API 的生命周期对齐
  [Vue 3.4+] 需放入 Vue 项目(Vite)运行;本文件为示意代码,以阅读理解为主。
-->
<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
// (bus 定义同 11-04,示意)

const count = ref(0);
// ✅ 订阅回调里只改 ref,模板自动响应 —— Vue 的响应式天然就是观察者模式的产物
// const off = bus.on('cart:changed', (p) => { count.value = p.count; });
// onUnmounted(off); // 卸载解绑,防止泄漏

// ⚠️ 坑:handler 若是每次渲染重建的函数,off 会失败 —— 处理器定义在 setup 顶层即天然稳定
// ⚠️ 坑:watchEffect 里 emit 同源事件会造成无限循环 —— 事件方向:emit 向外、watch 向内,别闭环
</script>

<template>
    <span>购物车({{ count }})</span>
</template>
