import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { detectFramework } from "../../src/detect/framework.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  resolve(__dirname, "../fixtures/projects", name);

describe("detectFramework", () => {
  it("Next.js App Router", () => {
    expect(detectFramework(fixture("nextjs-app"))).toEqual({
      kind: "next",
      router: "app",
    });
  });

  it("Next.js Pages Router", () => {
    expect(detectFramework(fixture("nextjs-pages"))).toEqual({
      kind: "next",
      router: "pages",
    });
  });

  it("Vite + React", () => {
    expect(detectFramework(fixture("vite-react"))).toEqual({
      kind: "vite",
      flavor: "react",
    });
  });

  it("SvelteKit", () => {
    expect(detectFramework(fixture("sveltekit"))).toEqual({ kind: "sveltekit" });
  });

  it("Astro", () => {
    expect(detectFramework(fixture("astro"))).toEqual({ kind: "astro" });
  });

  it("Remix", () => {
    expect(detectFramework(fixture("remix"))).toEqual({ kind: "remix" });
  });

  it("plain HTML when no package.json", () => {
    expect(detectFramework(fixture("plain-html"))).toEqual({ kind: "plain" });
  });

  it("returns 'unknown' when nothing matches", () => {
    expect(detectFramework(fixture("unknown"))).toEqual({ kind: "unknown" });
  });
});
