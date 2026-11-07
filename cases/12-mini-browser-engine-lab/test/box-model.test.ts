// box-model.test.ts — 8+ 用例

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBox,
  parseCssValue,
  parseShorthand,
  layoutFlow,
} from "../src/box-model.js";
import type { LayoutContext, Box } from "../src/box-model.js";
import type { DomNode } from "../src/selector.js";

function makeCtx(): LayoutContext {
  return {
    viewportWidth: 1000,
    viewportHeight: 800,
    parentWidth: 1000,
    parentHeight: 800,
  };
}

function makeStyle(props: Record<string, string>) {
  const m = new Map<
    string,
    { type: "declaration"; property: string; value: string; important: boolean }
  >();
  for (const [k, v] of Object.entries(props)) {
    m.set(k, { type: "declaration", property: k, value: v, important: false });
  }
  return {
    properties: m as unknown as Map<
      string,
      import("../src/css-parser.js").Declaration
    >,
  };
}

function makeNode(tag: string = "div"): DomNode {
  return { tag, children: [] };
}

describe("parseCssValue", () => {
  it("parses px", () => {
    const v = parseCssValue("100px");
    assert.equal(v?.value, 100);
    assert.equal(v?.unit, "px");
  });
  it("parses %", () => {
    const v = parseCssValue("50%");
    assert.equal(v?.value, 50);
    assert.equal(v?.unit, "%");
  });
  it("parses 0", () => {
    const v = parseCssValue("0");
    assert.equal(v?.value, 0);
  });
  it("parses auto", () => {
    const v = parseCssValue("auto");
    assert.equal(v?.unit, "auto");
  });
});

describe("parseShorthand", () => {
  it("1 value", () => {
    const r = parseShorthand("8px");
    assert.equal(r[0]?.value, 8);
    assert.equal(r[1]?.value, 8);
  });
  it("2 values", () => {
    const r = parseShorthand("4px 8px");
    assert.equal(r[0]?.value, 4);
    assert.equal(r[1]?.value, 8);
    assert.equal(r[2]?.value, 4);
    assert.equal(r[3]?.value, 8);
  });
  it("4 values", () => {
    const r = parseShorthand("1px 2px 3px 4px");
    assert.equal(r[0]?.value, 1);
    assert.equal(r[1]?.value, 2);
    assert.equal(r[2]?.value, 3);
    assert.equal(r[3]?.value, 4);
  });
});

describe("box-model: content-box", () => {
  it("width = content width", () => {
    const box = computeBox(
      makeNode("div"),
      makeStyle({ width: "200px" }),
      makeCtx(),
    );
    assert.equal(box.width, 200);
    assert.equal(box.borderWidth, 200); // 无 padding/border
    assert.equal(box.marginBoxWidth, 200);
  });

  it("padding + content-box", () => {
    const box = computeBox(
      makeNode("div"),
      makeStyle({ width: "200px", padding: "10px" }),
      makeCtx(),
    );
    assert.equal(box.width, 200); // content
    assert.equal(box.paddingTop, 10);
    assert.equal(box.borderWidth, 220); // 200 + 10 + 10
  });

  it("margin 不影响 border-box", () => {
    const box = computeBox(
      makeNode("div"),
      makeStyle({ width: "200px", margin: "5px" }),
      makeCtx(),
    );
    assert.equal(box.marginBoxWidth, 210); // 200 + 5 + 5
  });
});

describe("box-model: border-box", () => {
  it("width 包含 padding 和 border", () => {
    const box = computeBox(
      makeNode("div"),
      makeStyle({
        "box-sizing": "border-box",
        width: "200px",
        padding: "10px",
        "border-width": "5px",
      }),
      makeCtx(),
    );
    // content = 200 - 10 - 10 - 5 - 5 = 170
    assert.equal(box.width, 170);
    assert.equal(box.borderWidth, 200);
  });
});

describe("box-model: percentage", () => {
  it("% width 相对于 parentWidth", () => {
    const ctx: LayoutContext = {
      viewportWidth: 1000,
      viewportHeight: 800,
      parentWidth: 400,
      parentHeight: 300,
    };
    const box = computeBox(makeNode("div"), makeStyle({ width: "50%" }), ctx);
    assert.equal(box.width, 200); // 400 * 50%
  });
});

describe("layoutFlow", () => {
  it("block flow 垂直排列", () => {
    const childBox1: Box = {
      node: { tag: "p", children: [] },
      width: 100,
      height: 20,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      borderTop: 0,
      borderRight: 0,
      borderBottom: 0,
      borderLeft: 0,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      boxSizing: "content-box",
      x: 0,
      y: 0,
      borderWidth: 100,
      borderHeight: 20,
      marginBoxWidth: 100,
      marginBoxHeight: 20,
      children: [],
      style: makeStyle({}),
    };
    const childBox2: Box = {
      ...childBox1,
      height: 30,
      borderHeight: 30,
      marginBoxHeight: 30,
    };

    const parentBox: Box = {
      node: { tag: "div", children: [] },
      width: 400,
      height: 300,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      borderTop: 0,
      borderRight: 0,
      borderBottom: 0,
      borderLeft: 0,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      boxSizing: "content-box",
      x: 0,
      y: 0,
      borderWidth: 400,
      borderHeight: 300,
      marginBoxWidth: 400,
      marginBoxHeight: 300,
      children: [childBox1, childBox2],
      style: makeStyle({}),
    };

    layoutFlow(parentBox);
    assert.equal(childBox1.y, 0);
    assert.equal(childBox2.y, 20); // 第一个高 20
  });
});
