// 文件: examples/109-04-scene-stack.ts
// 场景管理栈：大厅 → 对局 → 结算 的 push/pop/replace 与生命周期编排
// 目标：生命周期调用顺序严格可断言——pause/resume 成对、enter/exit 成对

import assert from "node:assert";

interface Scene {
  readonly name: string;
  onEnter(): void; // 成为栈顶时调用
  onExit(): void; // 离开栈时调用（销毁）
  onPause(): void; // 被新场景压栈时调用（未销毁，音乐/动画暂停）
  onResume(): void; // 上方场景弹出、重新可见时调用
}

class SceneManager {
  private stack: Scene[] = [];
  readonly log: string[] = []; // 生命周期轨迹，测试断言用

  private track(scene: Scene, hook: keyof Scene): void {
    if (hook === "name") return;
    this.log.push(`${scene.name}.${hook}`);
  }

  get top(): Scene | null {
    return this.stack[this.stack.length - 1] ?? null;
  }
  get depth(): number {
    return this.stack.length;
  }

  push(scene: Scene): void {
    const top = this.top;
    if (top) {
      top.onPause();
      this.track(top, "onPause");
    }
    this.stack.push(scene);
    scene.onEnter();
    this.track(scene, "onEnter");
  }

  pop(): Scene {
    const top = this.stack.pop();
    assert.ok(top, "栈空时禁止 pop");
    top.onExit();
    this.track(top, "onExit");
    const newTop = this.top;
    if (newTop) {
      newTop.onResume();
      this.track(newTop, "onResume");
    }
    return top;
  }

  /** 替换栈顶：旧场景销毁、新场景进场，下层不动 */
  replace(scene: Scene): void {
    const top = this.stack.pop();
    if (top) {
      top.onExit();
      this.track(top, "onExit");
    }
    this.stack.push(scene);
    scene.onEnter();
    this.track(scene, "onEnter");
  }

  /** 每帧只驱动栈顶场景 */
  update(dt: number, tick: (scene: Scene, dt: number) => void): void {
    if (this.top) tick(this.top, dt);
  }
}

/** 测试用场景：生命周期只打日志 */
function makeScene(name: string): Scene {
  return {
    name,
    onEnter() {},
    onExit() {},
    onPause() {},
    onResume() {},
  };
}

function runAssertions() {
  // ---------- 测试 1：push 三层——pause/enter 交错顺序 ----------
  const mgr = new SceneManager();
  const lobby = makeScene("lobby");
  const battle = makeScene("battle");
  const result = makeScene("result");
  mgr.push(lobby);
  mgr.push(battle);
  mgr.push(result);
  assert.deepEqual(mgr.log, [
    "lobby.onEnter",
    "lobby.onPause",
    "battle.onEnter",
    "battle.onPause",
    "result.onEnter",
  ]);
  console.log("[1/4] push 顺序 OK:", mgr.log.join(" → "));

  // ---------- 测试 2：pop 回大厅——exit/resume 成对 ----------
  mgr.pop(); // result 出栈
  mgr.pop(); // battle 出栈
  assert.deepEqual(mgr.log.slice(-4), [
    "result.onExit",
    "battle.onResume",
    "battle.onExit",
    "lobby.onResume",
  ]);
  assert.equal(mgr.depth, 1);
  assert.equal(mgr.top?.name, "lobby");
  console.log("[2/4] pop 回退 OK, 深度:", mgr.depth);

  // ---------- 测试 3：replace——下层不 pause ----------
  mgr.push(battle); // lobby.pause, battle.enter
  const logBefore = mgr.log.length;
  mgr.replace(result); // battle.exit, result.enter（lobby 不动）
  assert.deepEqual(mgr.log.slice(logBefore), ["battle.onExit", "result.onEnter"]);
  assert.equal(mgr.depth, 2, "replace 深度不变");
  console.log("[3/4] replace OK, 深度:", mgr.depth);

  // ---------- 测试 4：守卫与栈顶驱动 ----------
  mgr.pop();
  mgr.pop();
  assert.equal(mgr.depth, 0);
  assert.throws(() => mgr.pop(), /禁止 pop/, "空栈 pop 应抛错");
  let ticked = "";
  mgr.update(0.016, (s) => (ticked = s.name));
  assert.equal(ticked, "", "空栈不驱动任何场景");
  mgr.push(lobby);
  mgr.push(battle);
  mgr.update(0.016, (s) => (ticked = s.name));
  assert.equal(ticked, "battle", "每帧只驱动栈顶");
  console.log("[4/4] 守卫与栈顶驱动 OK");

  console.log("\n✅ 109-04 场景管理栈 全部断言通过");
}

runAssertions();
