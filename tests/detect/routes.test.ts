import { describe, it, expect } from "vitest";
import { filesToRoutes } from "../../src/detect/routes.js";

describe("filesToRoutes (Next App Router)", () => {
  const fw = { kind: "next" as const, router: "app" as const };

  it("maps page.tsx files", () => {
    expect(filesToRoutes(fw, ["app/dashboard/page.tsx"])).toEqual(["/dashboard"]);
  });

  it("maps app/page.tsx → /", () => {
    expect(filesToRoutes(fw, ["app/page.tsx"])).toEqual(["/"]);
  });

  it("skips dynamic segments", () => {
    expect(filesToRoutes(fw, ["app/products/[id]/page.tsx"])).toEqual([]);
  });

  it("ignores non-page files", () => {
    expect(filesToRoutes(fw, ["app/dashboard/Header.tsx"])).toEqual([]);
  });

  it("dedupes when multiple files in same route folder change", () => {
    expect(
      filesToRoutes(fw, [
        "app/dashboard/page.tsx",
        "app/dashboard/loading.tsx",
        "app/dashboard/Header.tsx",
      ]),
    ).toEqual(["/dashboard"]);
  });
});

describe("filesToRoutes (Next Pages Router)", () => {
  const fw = { kind: "next" as const, router: "pages" as const };

  it("pages/index.tsx → /", () => {
    expect(filesToRoutes(fw, ["pages/index.tsx"])).toEqual(["/"]);
  });

  it("pages/about.tsx → /about", () => {
    expect(filesToRoutes(fw, ["pages/about.tsx"])).toEqual(["/about"]);
  });

  it("ignores _app, _document, api/*", () => {
    expect(
      filesToRoutes(fw, ["pages/_app.tsx", "pages/_document.tsx", "pages/api/x.ts"]),
    ).toEqual([]);
  });

  it("skips dynamic segments", () => {
    expect(filesToRoutes(fw, ["pages/products/[id].tsx"])).toEqual([]);
  });
});

describe("filesToRoutes (SvelteKit)", () => {
  const fw = { kind: "sveltekit" as const };

  it("src/routes/about/+page.svelte → /about", () => {
    expect(filesToRoutes(fw, ["src/routes/about/+page.svelte"])).toEqual(["/about"]);
  });

  it("src/routes/+page.svelte → /", () => {
    expect(filesToRoutes(fw, ["src/routes/+page.svelte"])).toEqual(["/"]);
  });

  it("skips [param] dirs", () => {
    expect(filesToRoutes(fw, ["src/routes/blog/[slug]/+page.svelte"])).toEqual([]);
  });
});

describe("filesToRoutes (Astro)", () => {
  const fw = { kind: "astro" as const };

  it("src/pages/about.astro → /about", () => {
    expect(filesToRoutes(fw, ["src/pages/about.astro"])).toEqual(["/about"]);
  });
});

describe("filesToRoutes (plain)", () => {
  const fw = { kind: "plain" as const };

  it("index.html → /", () => {
    expect(filesToRoutes(fw, ["index.html"])).toEqual(["/"]);
  });
  it("about.html → /about", () => {
    expect(filesToRoutes(fw, ["about.html"])).toEqual(["/about"]);
  });
});
