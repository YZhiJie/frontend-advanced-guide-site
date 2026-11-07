/** 59-04-incident-simulator.ts —— CDN chunk 404 故障排查 */
export function chunk404(cdnSynced: boolean, htmlUpdated: boolean): boolean {
  return htmlUpdated && !cdnSynced;
}
export function runSOP(canRollback: boolean): Array<{ step: number; action: string; timeMin: number }> {
  return [
    { step: 1, action: "监控:chunk 404 P0", timeMin: 1 },
    { step: 2, action: "curl 验证 404 + HTML", timeMin: 2 },
    { step: 3, action: "CI 日志:CDN purge 未完", timeMin: 3 },
    { step: 4, action: canRollback ? "rollback 上一版本" : "等 purge 重部署", timeMin: canRollback ? 2 : 5 },
    { step: 5, action: "监控归零验证", timeMin: 5 },
    { step: 6, action: "RCA + 预防措施", timeMin: 15 },
  ];
}
console.assert(chunk404(false, true), "应触发 404");
console.assert(!chunk404(true, true), "正常部署不触发");
const steps = runSOP(true);
const total = steps.reduce((s, x) => s + x.timeMin, 0);
const stop = steps.slice(0, 4).reduce((s, x) => s + x.timeMin, 0);
console.log(`P0 止血:${stop}min, 总:${total}min`);
console.log("✅ 故障排查 SOP 模拟通过");
