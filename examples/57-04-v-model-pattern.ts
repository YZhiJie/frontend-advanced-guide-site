/** 57-04-v-model-pattern.ts —— v-model 数据管道验证 */
function createVModel<T>(initial: T) {
  let parentRef = initial;
  let childProps: T = parentRef;
  const childSend = (v: T) => { parentRef = v; childProps = v; };
  return { get value() { return parentRef; }, get childReceive() { return childProps; }, childSend };
}
function main() {
  const form = createVModel<string>("");
  console.assert(form.childReceive === "", "初始应为空");
  form.childSend("admin@test.com");
  console.assert(form.value === "admin@test.com", "v-model 应更新父 ref");
  form.childSend("boss@test.com");
  console.assert(form.childReceive === "boss@test.com", "新值应下发到子");
  console.log("✅ v-model 数据管道验证通过");
}
main();
