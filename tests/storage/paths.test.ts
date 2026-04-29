import { describe, it, expect } from "vitest";
import { hashCwd, projectDir, snapshotDir, routeSlug } from "../../src/storage/paths.js";

describe("paths", () => {
  it("hashCwd is stable and 12 chars", () => {
    const h = hashCwd("/Users/me/projects/app");
    expect(h).toHaveLength(12);
    expect(h).toEqual(hashCwd("/Users/me/projects/app"));
  });

  it("hashCwd differs for different cwds", () => {
    expect(hashCwd("/a")).not.toEqual(hashCwd("/b"));
  });

  it("projectDir nests under home/.flip/projects", () => {
    expect(projectDir("/h", "/Users/me/x")).toBe(`/h/.flip/projects/${hashCwd("/Users/me/x")}`);
  });

  it("snapshotDir uses commit sha", () => {
    expect(snapshotDir("/h", "/p", "abc123")).toMatch(/snapshots\/abc123$/);
  });

  it("routeSlug encodes safely", () => {
    expect(routeSlug("/")).toBe("_root");
    expect(routeSlug("/dashboard")).toBe("dashboard");
    expect(routeSlug("/users/profile")).toBe("users_profile");
  });
});
