/**
 * 57-03-event-bus-memory-leak.ts —— EventBus 内存泄漏演示
 * 运行方式: npx tsx examples/57-03-event-bus-memory-leak.ts
 */
import { EventEmitter } from "node:events";
const bus = new EventEmitter();
function mountComponentA() {
  const handler = (data: string) => { console.log("A:", data); };
  bus.on("refresh", handler);
}
function unmountComponentA() {}
for (let i = 0; i < 100; i++) { mountComponentA(); unmountComponentA(); }
const count = bus.listenerCount("refresh");
console.log(`listener 数量: ${count} (应有 100, 证明泄漏)`);
function mountComponentB() {
  const handler = (data: string) => { console.log("B:", data); };
  bus.on("refresh", handler);
  return () => bus.off("refresh", handler);
}
const cleanup = mountComponentB();
cleanup();
console.log("✅ EventBus 内存泄漏演示完成");
