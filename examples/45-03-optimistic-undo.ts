// 文件: examples/45-03-optimistic-undo.ts
// ============ 乐观更新与撤销栈：先给反馈，失败能回滚 ============
// 两个容易混在一起的能力：
//   1) 乐观更新：先把 UI 改成“成功后的样子”，请求失败再回滚；
//   2) 撤销/重做：只记录“已经成功”的状态，失败的操作不该进入历史。
// 关键约束：
//   - 乐观更新必须串行执行，否则后一个操作的 before 快照会包含前一个未确认的修改；
//   - 回滚要回到“本次操作前”的快照，而不是简单地把字段取反；
//   - 新操作会清空 redo 栈，这是撤销栈的标准语义。
// 运行：npx tsx examples/45-03-optimistic-undo.ts

interface Task {
  id: string;
  title: string;
  done: boolean;
}

interface State {
  tasks: Task[];
  revision: number;
}

type StateUpdater = (state: State) => State;

class OptimisticStore {
  private state: State;
  private tail: Promise<void> = Promise.resolve();

  constructor(initial: State) {
    this.state = initial;
  }

  get(): State {
    return this.state;
  }

  /** 撤销/重做回放时使用；正常业务写入请走 mutate */
  replace(next: State): void {
    this.state = next;
  }

  /**
   * 乐观更新：
   *   同步应用 optimistic（UI 立刻变），commit 串行执行；
   *   失败时只有“当前状态仍是本次乐观结果”才回滚，避免覆盖后续操作。
   */
  mutate(options: {
    optimistic: StateUpdater;
    commit: () => Promise<State>;
  }): Promise<State> {
    const before = this.state;
    const after = options.optimistic(before);
    this.state = after;

    const run = this.tail
      .then(() => options.commit())
      .then(
        (server) => {
          this.state = server;
          return server;
        },
        (error) => {
          if (this.state === after) this.state = before;
          throw error;
        },
      );
    // 队列本身不能因为某次失败而断掉
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

class UndoStack<S> {
  private past: S[] = [];
  private future: S[] = [];

  constructor(
    private current: S,
    private readonly limit = 50,
  ) {}

  push(next: S): void {
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
  }

  undo(): S {
    const previous = this.past.pop();
    if (!previous) return this.current;
    this.future.push(this.current);
    this.current = previous;
    return this.current;
  }

  redo(): S {
    const next = this.future.pop();
    if (!next) return this.current;
    this.past.push(this.current);
    this.current = next;
    return this.current;
  }

  get(): S {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

const toggle =
  (id: string): StateUpdater =>
  (state) => ({
    revision: state.revision, // 乐观阶段沿用旧 revision，服务端确认后再更新
    tasks: state.tasks.map((task) =>
      task.id === id ? { ...task, done: !task.done } : task,
    ),
  });

// ============ 演示：一次成功、一次失败，再撤销/重做 ============

async function main(): Promise<void> {
  let server: State = {
    revision: 1,
    tasks: [
      { id: "t1", title: "写周报", done: false },
      { id: "t2", title: "修线上白屏", done: false },
    ],
  };
  let failNext = false;

  const commitToggle = async (id: string): Promise<State> => {
    await Promise.resolve(); // 模拟一次网络往返
    if (failNext) {
      failNext = false;
      throw new Error("网络中断，服务端未写入");
    }
    server = {
      revision: server.revision + 1,
      tasks: server.tasks.map((task) =>
        task.id === id ? { ...task, done: !task.done } : task,
      ),
    };
    return structuredClone(server);
  };

  const store = new OptimisticStore(structuredClone(server));
  const history = new UndoStack<State>(structuredClone(server));

  // 1) 成功的乐观更新：调用后立刻能看到 UI 变化
  const pending = store.mutate({
    optimistic: toggle("t1"),
    commit: () => commitToggle("t1"),
  });
  if (!store.get().tasks[0].done) throw new Error("乐观阶段应立即显示已完成");

  const confirmed = await pending;
  history.push(structuredClone(confirmed));
  if (confirmed.tasks[0].done !== true)
    throw new Error("服务端确认后应为已完成");
  if (history.canUndo !== true) throw new Error("成功操作应进入撤销栈");

  // 2) 失败的乐观更新：先变 UI，再回滚到操作前
  failNext = true;
  const before = structuredClone(store.get());
  const failing = store.mutate({
    optimistic: toggle("t2"),
    commit: () => commitToggle("t2"),
  });
  if (!store.get().tasks[1].done) throw new Error("失败前也应先显示乐观结果");

  let failed = false;
  try {
    await failing;
  } catch (error) {
    failed = true;
    if (!(error as Error).message.includes("网络中断"))
      throw new Error("错误信息不应被吞掉");
  }
  if (!failed) throw new Error("这次提交本应失败");
  if (store.get().tasks[1].done !== before.tasks[1].done)
    throw new Error("失败后必须回滚到操作前状态");
  if (history.get().tasks[1].done !== false)
    throw new Error("失败的操作不能进入历史");

  // 3) 撤销 / 重做：只回放已确认的状态
  const undone = history.undo();
  store.replace(structuredClone(undone));
  if (store.get().tasks[0].done !== false)
    throw new Error("撤销后应回到未完成");

  const redone = history.redo();
  store.replace(structuredClone(redone));
  if (store.get().tasks[0].done !== true) throw new Error("重做后应恢复已完成");

  // 4) 新操作清空 redo 栈
  history.push(structuredClone(store.get()));
  if (history.canRedo) throw new Error("新操作后 redo 栈必须清空");

  console.log(
    "\n✓ 乐观更新与撤销栈演示通过：成功入栈、失败回滚、撤销/重做与 redo 清空均正确",
  );
}

main().catch((error) => {
  console.error(error);
  throw error;
});

export {};
