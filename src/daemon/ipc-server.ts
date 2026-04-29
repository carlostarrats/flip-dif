import net from "node:net";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Request, Response } from "../ipc/protocol.js";

export type Handler = (req: Request) => Promise<unknown>;

export interface IpcServer {
  close(): Promise<void>;
}

export async function startIpcServer(socketPath: string, handler: Handler): Promise<IpcServer> {
  mkdirSync(dirname(socketPath), { recursive: true });
  if (existsSync(socketPath)) unlinkSync(socketPath);
  const server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: Request;
        try {
          req = JSON.parse(line) as Request;
        } catch (e) {
          sock.write(JSON.stringify({ id: 0, ok: false, error: (e as Error).message }) + "\n");
          continue;
        }
        try {
          const result = await handler(req);
          const res: Response = { id: req.id, ok: true, result };
          sock.write(JSON.stringify(res) + "\n");
        } catch (e) {
          const res: Response = { id: req.id, ok: false, error: (e as Error).message };
          sock.write(JSON.stringify(res) + "\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
