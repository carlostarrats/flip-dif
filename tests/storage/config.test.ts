import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../../src/storage/config.js";

let HOME: string;
beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-cfg-"));
});

describe("config", () => {
  it("returns DEFAULT when missing", () => {
    expect(loadConfig(HOME)).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips", () => {
    saveConfig(HOME, { historyLimit: 50 });
    expect(loadConfig(HOME)).toEqual({ historyLimit: 50 });
  });

  it("merges partial config with defaults", () => {
    saveConfig(HOME, { historyLimit: 5 });
    const cfg = loadConfig(HOME);
    expect(cfg.historyLimit).toBe(5);
  });
});
