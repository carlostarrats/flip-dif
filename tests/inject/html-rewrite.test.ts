import { describe, it, expect } from "vitest";
import { rewriteBodyTag } from "../../src/inject/html-rewrite.js";

describe("rewriteBodyTag", () => {
  it("adds data-flip-build-id when missing", () => {
    expect(rewriteBodyTag("<html><body><h1>x</h1></body></html>", "abc")).toContain(
      'data-flip-build-id="abc"',
    );
  });

  it("replaces existing attribute", () => {
    const out = rewriteBodyTag('<html><body data-flip-build-id="old"></body></html>', "new");
    expect(out).toContain('data-flip-build-id="new"');
    expect(out).not.toContain("old");
  });

  it("keeps other attrs", () => {
    const out = rewriteBodyTag('<body class="foo">', "abc");
    expect(out).toContain('class="foo"');
    expect(out).toContain('data-flip-build-id="abc"');
  });

  it("returns input unchanged when no body tag", () => {
    expect(rewriteBodyTag("<div>fragment</div>", "abc")).toBe("<div>fragment</div>");
  });

  it("handles multi-line attrs", () => {
    const out = rewriteBodyTag('<body\n  class="foo"\n  id="x">', "abc");
    expect(out).toContain('data-flip-build-id="abc"');
  });
});
