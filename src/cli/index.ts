export type ParsedArgs =
  | { cmd: "open" }
  | { cmd: "start"; port: number | undefined }
  | { cmd: "stop" }
  | { cmd: "snap" }
  | { cmd: "clear" };

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { cmd: "open" };
  const [head, ...rest] = argv;
  switch (head) {
    case "start": {
      const portFlag = rest.indexOf("--port");
      const port =
        portFlag >= 0 && rest[portFlag + 1]
          ? Number(rest[portFlag + 1])
          : undefined;
      return { cmd: "start", port };
    }
    case "stop":
      return { cmd: "stop" };
    case "snap":
      return { cmd: "snap" };
    case "clear":
      return { cmd: "clear" };
    default:
      throw new Error(`unknown command: ${head}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  switch (parsed.cmd) {
    case "open":
      return (await import("./open.js")).run();
    case "start":
      return (await import("./start.js")).run(parsed.port);
    case "stop":
      return (await import("./stop.js")).run();
    case "snap":
      return (await import("./snap.js")).run();
    case "clear":
      return (await import("./clear.js")).run();
  }
}
