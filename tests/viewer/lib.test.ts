// @ts-expect-error — plain JS module imported without types
import { findPriorWithRoute, imgUrl, escapeHtml, rel } from "../../src/viewer/public/views/lib.js";
import { describe, it, expect } from "vitest";

type Cap = { route: string; file: string; width: number; height: number };
type Snap = { sha: string; message: string; timestamp: number; captures: Cap[] };

const cap = (route: string): Cap => ({
  route,
  file: route === "/" ? "_root.png" : route.replace(/^\//, "") + ".png",
  width: 1280,
  height: 800,
});

describe("findPriorWithRoute", () => {
  it("returns null when no prior snapshot has the route", () => {
    const snaps: Snap[] = [
      { sha: "c", message: "c", timestamp: 3, captures: [cap("/")] },
    ];
    expect(findPriorWithRoute(snaps, 0, "/")).toBeNull();
  });

  it("returns the immediately prior snapshot when it has the route", () => {
    const snaps: Snap[] = [
      { sha: "c", message: "c", timestamp: 3, captures: [cap("/")] },
      { sha: "b", message: "b", timestamp: 2, captures: [cap("/")] },
    ];
    expect(findPriorWithRoute(snaps, 0, "/")?.sha).toBe("b");
  });

  it("walks past intermediate snapshots that lack the route (regression)", () => {
    // Three commits: rev 1 captures both /, /dashboard. rev 2 only /dashboard.
    // rev 3 only /. Asking 'before' for / on rev 3 must skip rev 2 → return rev 1.
    const snaps: Snap[] = [
      { sha: "rev3", message: "redesigned hero", timestamp: 3, captures: [cap("/")] },
      { sha: "rev2", message: "dashboard tweak", timestamp: 2, captures: [cap("/dashboard")] },
      { sha: "rev1", message: "initial", timestamp: 1, captures: [cap("/"), cap("/dashboard")] },
    ];
    expect(findPriorWithRoute(snaps, 0, "/")?.sha).toBe("rev1");
    expect(findPriorWithRoute(snaps, 0, "/dashboard")?.sha).toBe("rev2");
  });

  it("scans only forward (older) — never the same or newer index", () => {
    const snaps: Snap[] = [
      { sha: "c", message: "c", timestamp: 3, captures: [cap("/")] },
      { sha: "b", message: "b", timestamp: 2, captures: [cap("/")] },
    ];
    // idx 1 (oldest) has no prior — null even if newer ones have route
    expect(findPriorWithRoute(snaps, 1, "/")).toBeNull();
  });
});

describe("imgUrl", () => {
  it("encodes / as _root", () => {
    expect(imgUrl("hash", "abc", "/")).toBe("/snapshots/hash/abc/_root.png");
  });
  it("encodes /a/b as a_b", () => {
    expect(imgUrl("hash", "abc", "/a/b")).toBe("/snapshots/hash/abc/a_b.png");
  });
});

describe("escapeHtml", () => {
  it("escapes the five common chars", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("rel", () => {
  it("never for missing timestamp", () => {
    expect(rel(undefined)).toBe("never");
    expect(rel(0)).toBe("never");
  });
  it("returns seconds/minutes/hours/days", () => {
    const now = Date.now();
    expect(rel(now - 5_000)).toMatch(/^\d+s ago$/);
    expect(rel(now - 5 * 60_000)).toMatch(/^\d+m ago$/);
    expect(rel(now - 5 * 3_600_000)).toMatch(/^\d+h ago$/);
    expect(rel(now - 5 * 86_400_000)).toMatch(/^\d+d ago$/);
  });
});
