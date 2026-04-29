import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  registerProject,
  listProjects,
  getProject,
  type ProjectMeta,
} from "../../src/storage/projects.js";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-proj-test-"));
});

const baseMeta = (cwd: string): ProjectMeta => ({
  cwd,
  name: basename(cwd),
  framework: "next-app",
  lastSeen: 1000,
  url: "http://localhost:3000",
});

describe("projects registry", () => {
  it("registers and reads back a project", () => {
    const cwd = "/tmp/foo";
    registerProject(HOME, cwd, baseMeta(cwd));
    const got = getProject(HOME, cwd);
    expect(got?.cwd).toBe(cwd);
    expect(got?.name).toBe("foo");
  });

  it("returns null for unregistered cwd", () => {
    expect(getProject(HOME, "/nope")).toBeNull();
  });

  it("listProjects returns all registered", () => {
    registerProject(HOME, "/tmp/a", baseMeta("/tmp/a"));
    registerProject(HOME, "/tmp/b", baseMeta("/tmp/b"));
    const list = listProjects(HOME);
    expect(list.map((p) => p.cwd).sort()).toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("re-registering updates lastSeen but preserves name", () => {
    const cwd = "/tmp/foo";
    const m = baseMeta(cwd);
    registerProject(HOME, cwd, { ...m, name: "custom-name" });
    registerProject(HOME, cwd, { ...m, lastSeen: 5000 });
    const got = getProject(HOME, cwd);
    expect(got?.name).toBe("custom-name");
    expect(got?.lastSeen).toBe(5000);
  });
});
