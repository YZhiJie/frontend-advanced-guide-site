// css-parser.test.ts — 12+ 用例

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStylesheet, flattenDeclarations } from "../src/css-parser.js";

describe("css-parser: simple rule", () => {
  it("parses a basic rule with one declaration", () => {
    const ss = parseStylesheet("div { color: red; }");
    assert.equal(ss.children.length, 1);
    const rule = ss.children[0];
    assert.equal(rule.type, "rule");
    if (rule.type === "rule") {
      assert.deepEqual(rule.selectors, ["div"]);
      assert.equal(rule.declarations.length, 1);
      assert.equal(rule.declarations[0].property, "color");
      assert.equal(rule.declarations[0].value, "red");
      assert.equal(rule.declarations[0].important, false);
    }
  });

  it("parses multiple declarations and selectors", () => {
    const ss = parseStylesheet("h1, h2 { margin: 0; padding: 8px 16px; }");
    assert.equal(ss.children.length, 1);
    const rule = ss.children[0];
    assert.equal(rule.type, "rule");
    if (rule.type === "rule") {
      assert.deepEqual(rule.selectors, ["h1", "h2"]);
      assert.equal(rule.declarations.length, 2);
      assert.equal(rule.declarations[1].value, "8px 16px");
    }
  });

  it("handles multiple rules in one sheet", () => {
    const ss = parseStylesheet("a { color: blue; } b { font-size: 14px; }");
    assert.equal(ss.children.length, 2);
    assert.equal(ss.children[0].type, "rule");
    assert.equal(ss.children[1].type, "rule");
  });
});

describe("css-parser: @at-rules", () => {
  it("parses @media with nested rules", () => {
    const ss = parseStylesheet("@media screen { div { color: red; } }");
    assert.equal(ss.children.length, 1);
    const at = ss.children[0];
    assert.equal(at.type, "atrule");
    if (at.type === "atrule") {
      assert.equal(at.name, "media");
      assert.equal(at.prelude, "screen");
      assert.equal(at.children.length, 1);
      assert.equal(at.children[0].type, "rule");
    }
  });

  it("parses @keyframes with multiple stops", () => {
    const ss = parseStylesheet(
      "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }",
    );
    assert.equal(ss.children.length, 1);
    const at = ss.children[0];
    assert.equal(at.type, "atrule");
    if (at.type === "atrule") {
      assert.equal(at.name, "keyframes");
      assert.equal(at.prelude, "fade");
      assert.equal(at.children.length, 2);
    }
  });

  it("parses @import (no block)", () => {
    const ss = parseStylesheet('@import "fonts.css";');
    assert.equal(ss.children.length, 1);
    const at = ss.children[0];
    assert.equal(at.type, "atrule");
    if (at.type === "atrule") {
      assert.equal(at.name, "import");
    }
  });

  it("parses @charset", () => {
    const ss = parseStylesheet('@charset "UTF-8";');
    assert.equal(ss.children.length, 1);
    const at = ss.children[0];
    assert.equal(at.type, "atrule");
    if (at.type === "atrule") {
      assert.equal(at.name, "charset");
    }
  });
});

describe("css-parser: declarations", () => {
  it("detects !important", () => {
    const ss = parseStylesheet(".foo { color: red !important; }");
    const rule = ss.children[0];
    assert.equal(rule.type, "rule");
    if (rule.type === "rule") {
      assert.equal(rule.declarations[0].important, true);
      assert.equal(rule.declarations[0].value, "red");
    }
  });

  it("handles numeric values", () => {
    const ss = parseStylesheet(".a { width: 100px; opacity: 0.5; }");
    const rule = ss.children[0];
    assert.equal(rule.type, "rule");
    if (rule.type === "rule") {
      assert.equal(rule.declarations[0].value, "100px");
      assert.equal(rule.declarations[1].value, "0.5");
    }
  });

  it("handles calc() and function-like values", () => {
    const ss = parseStylesheet(".a { width: calc(100% - 20px); }");
    const rule = ss.children[0];
    assert.equal(rule.type, "rule");
    if (rule.type === "rule") {
      assert.equal(rule.declarations[0].value, "calc(100% - 20px)");
    }
  });
});

describe("css-parser: nested media", () => {
  it("supports nested @media queries", () => {
    const css = `
      @media screen {
        @media (max-width: 600px) {
          .a { color: red; }
        }
      }
    `;
    const ss = parseStylesheet(css);
    assert.equal(ss.children.length, 1);
    const outer = ss.children[0];
    assert.equal(outer.type, "atrule");
    if (outer.type === "atrule") {
      assert.equal(outer.children.length, 1);
      const inner = outer.children[0];
      assert.equal(inner.type, "atrule");
      if (inner.type === "atrule") {
        assert.equal(inner.name, "media");
        assert.equal(inner.children.length, 1);
      }
    }
  });
});

describe("css-parser: edge cases", () => {
  it("skips comments", () => {
    const ss = parseStylesheet("/* hello */ .a { color: red; } /* world */");
    assert.equal(ss.children.length, 1);
  });

  it("handles whitespace-heavy input", () => {
    const ss = parseStylesheet("   div   {   color   :   red   ;   }   ");
    assert.equal(ss.children.length, 1);
  });

  it("flattenDeclarations extracts all declarations deeply", () => {
    const ss = parseStylesheet(`
      @media screen {
        .a { color: red; }
        .b { font-size: 12px; }
      }
    `);
    const all = flattenDeclarations(ss.children[0]);
    assert.equal(all.length, 2);
  });
});
