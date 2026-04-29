import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/cli/index.js";

describe("CLI parser", () => {
  it("returns 'open' when called with no args", () => {
    expect(parseArgs([])).toEqual({ cmd: "open" });
  });

  it("recognizes start with no flags", () => {
    expect(parseArgs(["start"])).toEqual({ cmd: "start", port: undefined });
  });

  it("recognizes start --port", () => {
    expect(parseArgs(["start", "--port", "3000"])).toEqual({
      cmd: "start",
      port: 3000,
    });
  });

  it("recognizes stop, snap, clear", () => {
    expect(parseArgs(["stop"])).toEqual({ cmd: "stop" });
    expect(parseArgs(["snap"])).toEqual({ cmd: "snap" });
    expect(parseArgs(["clear"])).toEqual({ cmd: "clear" });
  });

  it("rejects unknown commands", () => {
    expect(() => parseArgs(["fly"])).toThrow(/unknown command/);
  });

  it("recognizes --help, -h, help", () => {
    expect(parseArgs(["--help"])).toEqual({ cmd: "help" });
    expect(parseArgs(["-h"])).toEqual({ cmd: "help" });
    expect(parseArgs(["help"])).toEqual({ cmd: "help" });
  });
});
