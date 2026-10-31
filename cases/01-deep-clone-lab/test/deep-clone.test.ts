// 文件: cases/01-deep-clone-lab/test/deep-clone.test.ts
// ============ deepClone 的坑位逐项回归 ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { deepClone } from "../src/deep-clone.js"

test("基本类型原样返回", () => {
    for (const value of [1, "a", true, null, undefined, 10n, Symbol("s")]) {
        assert.equal(deepClone(value), value)
    }
})

test("Date 与 RegExp 深拷贝为独立实例", () => {
    const date = new Date("2026-01-01T00:00:00Z")
    const clonedDate = deepClone(date)
    assert.ok(clonedDate instanceof Date)
    assert.notEqual(clonedDate, date)
    assert.equal(clonedDate.getTime(), date.getTime())

    const re = /ab+c/gi
    const clonedRe = deepClone(re)
    assert.ok(clonedRe instanceof RegExp)
    assert.notEqual(clonedRe, re)
    assert.equal(clonedRe.source, re.source)
    assert.equal(clonedRe.flags, re.flags)
})

test("Map 深拷贝；以对象为键时键也被克隆", () => {
    const key = { id: 1 }
    const map = new Map<object, string[]>([[key, ["x"]]])
    const cloned = deepClone(map)

    const clonedKey = [...cloned.keys()][0]
    assert.notEqual(clonedKey, key)
    assert.deepEqual(clonedKey, key)
    // 用克隆后的键也能取到值，说明键值对应关系被保留
    assert.deepEqual(cloned.get(clonedKey), ["x"])
    assert.notEqual(cloned.get(clonedKey), map.get(key))
})

test("Set 深拷贝且元素为独立对象", () => {
    const item = { n: 1 }
    const set = new Set([item, 1])
    const cloned = deepClone(set)
    const clonedItem = [...cloned].find((v) => typeof v === "object") as { n: number }
    assert.notEqual(clonedItem, item)
    assert.deepEqual(clonedItem, item)
})

test("数组深拷贝且嵌套元素不共享引用", () => {
    const arr = [1, [2, 3], { a: 4 }]
    const cloned = deepClone(arr)
    assert.notEqual(cloned, arr)
    assert.deepEqual(cloned, arr)
    assert.notEqual(cloned[1], arr[1])
    assert.notEqual(cloned[2], arr[2])
})

test("纯对象逐层深拷贝", () => {
    const source = { a: { b: { c: 1 } }, d: [{ e: 2 }] }
    const cloned = deepClone(source)
    assert.deepEqual(cloned, source)
    assert.notEqual(cloned.a, source.a)
    assert.notEqual(cloned.d[0], source.d[0])
})

test("循环引用被保留且不栈溢出", () => {
    interface Node { name: string; next?: Node }
    const a: Node = { name: "a" }
    const b: Node = { name: "b", next: a }
    a.next = b

    const cloned = deepClone(a)
    assert.notEqual(cloned, a)
    assert.notEqual(cloned.next, b)
    // 克隆体内部的循环关系与原对象一致
    assert.equal(cloned.next?.next, cloned)
})

test("Symbol 作为键也能被克隆", () => {
    const secret = Symbol("secret")
    const source = { [secret]: { value: 1 }, plain: 2 }
    const cloned = deepClone(source)
    assert.notEqual(cloned[secret], source[secret])
    assert.equal(cloned[secret].value, 1)
    assert.equal(cloned.plain, 2)
})

test("类实例的原型链被保留", () => {
    class User {
        constructor(public name: string, public tags: string[] = []) {}
        greet(): string {
            return `hi ${this.name}`
        }
    }
    const user = new User("alice", ["a"])
    const cloned = deepClone(user)
    assert.ok(cloned instanceof User)
    assert.equal(cloned.greet(), "hi alice")
    assert.notEqual(cloned.tags, user.tags)
    assert.deepEqual(cloned, user)
})

test("函数原样返回（同一引用）", () => {
    const fn = (): number => 1
    const source = { fn, n: 1 }
    const cloned = deepClone(source)
    assert.equal(cloned.fn, fn)
})

test("不可克隆的内建对象原样返回", () => {
    const weakMap = new WeakMap<object, number>()
    const promise = Promise.resolve(1)
    assert.equal(deepClone(weakMap), weakMap)
    assert.equal(deepClone(promise), promise)
})

test("克隆体与原对象相互独立", () => {
    const source = { nested: { arr: [1, 2, 3] } }
    const cloned = deepClone(source)
    cloned.nested.arr.push(4)
    assert.deepEqual(source.nested.arr, [1, 2, 3])
})
