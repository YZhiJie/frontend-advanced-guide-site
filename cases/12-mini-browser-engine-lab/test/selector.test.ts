// selector.test.ts — 10+ 用例

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDomTree,
  matches,
  queryAll,
  parseSelector,
} from "../src/selector.js";
import type { DomNode } from "../src/selector.js";

function makeDom(): DomNode[] {
  // <html><head></head><body><div id="root" class="container"><p class="a b" data-x="1">Hello</p><p class="c">World</p><ul><li>1</li><li>2</li></ul></div></body></html>
  const li1: DomNode = { tag: "li", children: [] };
  const li2: DomNode = { tag: "li", children: [] };
  const ul: DomNode = { tag: "ul", children: [li1, li2] };
  const p1: DomNode = {
    tag: "p",
    className: "a b",
    attrs: { "data-x": "1" },
    children: [],
  };
  const p2: DomNode = { tag: "p", className: "c", children: [] };
  const div: DomNode = {
    tag: "div",
    id: "root",
    className: "container",
    children: [p1, p2, ul],
  };
  const body: DomNode = { tag: "body", children: [div] };
  const head: DomNode = { tag: "head", children: [] };
  const html: DomNode = { tag: "html", children: [head, body] };
  buildDomTree([html]);
  return [html];
}

describe("selector: basic", () => {
  it("matches tag selector", () => {
    const [html] = makeDom();
    const ps = queryAll(html, "p");
    assert.equal(ps.length, 2);
  });

  it("matches id selector", () => {
    const [html] = makeDom();
    const roots = queryAll(html, "#root");
    assert.equal(roots.length, 1);
    assert.equal(roots[0].tag, "div");
  });

  it("matches class selector", () => {
    const [html] = makeDom();
    const cs = queryAll(html, ".container");
    assert.equal(cs.length, 1);
    const ps = queryAll(html, ".a");
    assert.equal(ps.length, 1);
  });

  it("matches compound tag+class", () => {
    const [html] = makeDom();
    const ps = queryAll(html, "p.a");
    assert.equal(ps.length, 1);
    assert.equal(ps[0].className, "a b");
  });
});

describe("selector: combinators", () => {
  it("descendant combinator (space)", () => {
    const [html] = makeDom();
    const ps = queryAll(html, "div p");
    assert.equal(ps.length, 2);
  });

  it("child combinator (>)", () => {
    const [html] = makeDom();
    // div > p 只匹配直接子节点的 p（div 有 p1, p2, ul 三个子节点）
    const ps = queryAll(html, "div > p");
    assert.equal(ps.length, 2);
    // body > p 不匹配（body 的直接子节点是 div）
    const ps2 = queryAll(html, "body > p");
    assert.equal(ps2.length, 0);
  });

  it("adjacent sibling combinator (+)", () => {
    const [html] = makeDom();
    // p.a + p.c 应该匹配 p.c
    const ps = queryAll(html, "p.a + p.c");
    assert.equal(ps.length, 1);
    assert.equal(ps[0].className, "c");
  });

  it("general sibling combinator (~)", () => {
    const [html] = makeDom();
    const ps = queryAll(html, "p.a ~ p.c");
    assert.equal(ps.length, 1);
  });
});

describe("selector: attribute selectors", () => {
  it("[attr] presence", () => {
    const [html] = makeDom();
    const ps = queryAll(html, "[data-x]");
    assert.equal(ps.length, 1);
  });

  it("[attr=value] exact match", () => {
    const [html] = makeDom();
    const ps = queryAll(html, '[data-x="1"]');
    assert.equal(ps.length, 1);
    const ps2 = queryAll(html, '[data-x="2"]');
    assert.equal(ps2.length, 0);
  });

  it("[attr~=value] word match", () => {
    const [html] = makeDom();
    const ps = queryAll(html, 'p[class~="b"]');
    assert.equal(ps.length, 1);
  });

  it("[attr*=value] substring", () => {
    const [html] = makeDom();
    // p1.className = 'a b'，包含 'b'
    const ps = queryAll(html, 'p[class*="b"]');
    assert.equal(ps.length, 1);
  });
});

describe("selector: pseudo-classes", () => {
  it(":first-child / :last-child", () => {
    const [html] = makeDom();
    const firsts = queryAll(html, "li:first-child");
    assert.equal(firsts.length, 1);
    assert.equal(
      firsts[0],
      html.children![1].children![0].children![2].children![0],
    );

    const lasts = queryAll(html, "li:last-child");
    assert.equal(lasts.length, 1);
  });

  it(":nth-child(2)", () => {
    const [html] = makeDom();
    const seconds = queryAll(html, "li:nth-child(2)");
    assert.equal(seconds.length, 1);
  });

  it("compound selector list (comma)", () => {
    const [html] = makeDom();
    const all = queryAll(html, "p, li");
    assert.equal(all.length, 4);
  });

  it("matches() on specific node", () => {
    const [html] = makeDom();
    const div = html.children![1].children![0]; // div#root
    assert.equal(matches(div, "div"), true);
    assert.equal(matches(div, "#root"), true);
    assert.equal(matches(div, "p"), false);
    assert.equal(matches(div, "body > div#root.container"), true);
  });
});
