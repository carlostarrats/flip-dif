import { describe, it, expect, beforeEach } from "vitest";
import { resolveDevUrl } from "../../src/detect/url.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let HOME: string;
let CWD: string;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-home-"));
  CWD = mkdtempSync(join(tmpdir(), "flip-proj-"));
});

describe("resolveDevUrl", () => {
  it("uses --port when given", () => {
    expect(resolveDevUrl({ port: 3000, cwd: CWD, home: HOME })).toEqual({
      url: "http://localhost:3000",
      source: "port",
    });
  });

  it("reads portless manifest when no port", () => {
    mkdirSync(join(HOME, ".portless"), { recursive: true });
    writeFileSync(
      join(HOME, ".portless/projects.json"),
      JSON.stringify({ [CWD]: "myapp.localhost" }),
    );
    expect(resolveDevUrl({ port: undefined, cwd: CWD, home: HOME })).toEqual({
      url: "http://myapp.localhost",
      source: "portless",
    });
  });

  it("returns null when no port + no portless", () => {
    expect(resolveDevUrl({ port: undefined, cwd: CWD, home: HOME })).toBeNull();
  });
});
