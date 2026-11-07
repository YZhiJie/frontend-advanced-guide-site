/** 57-05-composables.ts —— 高频 composables */
export function useCounter(initial = 0, step = 1) {
  let count = initial;
  return {
    get count() {
      return count;
    },
    increment() {
      count += step;
    },
    decrement() {
      count -= step;
    },
    reset() {
      count = initial;
    },
  };
}
export function useDebounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay = 300,
): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}
export function runComposableTests(): Promise<void> {
  return new Promise((resolve) => {
    const counter = useCounter(0, 5);
    counter.increment();
    counter.decrement();
    console.assert(counter.count === 0, "useCounter OK");
    let cc = 0;
    const db = useDebounce(() => {
      cc++;
    }, 50);
    db();
    db();
    db();
    setTimeout(() => {
      console.assert(cc === 1, "useDebounce OK");
      console.log("✅ composables 测试通过");
      resolve();
    }, 100);
  });
}

runComposableTests();
