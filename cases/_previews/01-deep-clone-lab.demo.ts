// 01-deep-clone-lab 在线预览：演示循环引用 / Map / Set / RegExp / Date 的深克隆
import { deepClone } from "../01-deep-clone-lab/src/deep-clone.ts";
import { section, button, buttonRow, output, pre, table } from "./shared.ts";

const sec = section("深克隆演示", "示例对象包含 Date、RegExp、Map（含对象键）、Set、Symbol 键与循环引用");

const out = output(sec);

function makeSample(): Record<PropertyKey, unknown> {
    const obj: Record<PropertyKey, unknown> = {
        name: "sample",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        pattern: /a+b/gi,
        tags: new Set(["a", "b"]),
        meta: new Map<unknown, unknown>([["k", 1]]),
    };
    obj.self = obj; // 循环引用
    obj[Symbol("id")] = "sym";
    return obj;
}

let last: { src: unknown; dst: unknown } | null = null;

buttonRow(sec);
button(sec, "▶ 克隆示例对象", () => {
    const src = makeSample();
    const dst = deepClone(src) as typeof src;
    last = { src, dst };
    table(out, [
        ["Date 保留类型", dst.createdAt instanceof Date],
        ["RegExp 保留类型", dst.pattern instanceof RegExp],
        ["Map / Set 克隆", dst.meta instanceof Map && dst.tags instanceof Set],
        ["循环引用保持", (dst.self as Record<PropertyKey, unknown>) === dst],
        ["原对象循环引用", (src.self as Record<PropertyKey, unknown>) === src],
        ["Symbol 键复制", Object.getOwnPropertySymbols(dst).length >= 1],
        ["克隆 ≠ 原引用", dst !== src],
    ]);
});

button(sec, "Map 键为对象：引用一致性", () => {
    const key = { id: 1 };
    const src = new Map([[key, "v"]]);
    const dst = deepClone(src) as Map<unknown, unknown>;
    pre(out, { "原 Map 键是同一引用": [...src.keys()][0] === key, "克隆后键已被克隆（≠ 原键）": [...dst.keys()][0] !== key, "克隆 Map 值": [...dst.values()][0] });
});
