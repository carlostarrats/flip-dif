import net from "node:net";
import { join } from "node:path";
import { flipHome } from "../storage/paths.js";
import type { Request, Response } from "./protocol.js";

let nextId = 1;

export function socketPath(home: string): string {
  return join(flipHome(home), "daemon.sock");
}

type RequestNoId =
  | { method: "ping" }
  | { method: "register"; cwd: string; port?: number }
  | { method: "snap"; cwd: string }
  | { method: "shutdown" }
  | { method: "status" }
  | { method: "notifications" }
  | { method: "dismissNotification"; cwd: string };

export function sendRpc<T = unknown>(
  home: string,
  req: RequestNoId,
  timeoutMs = 30_000,
): Promise<T> {
  const id = nextId++;
  const payload: Request = { id, ...req } as Request;
  return new Promise<T>((resolve, reject) => {
    const sock = net.createConnection(socketPath(home));
    let buf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error("rpc timeout"));
    }, timeoutMs);

    sock.on("connect", () => {
      sock.write(JSON.stringify(payload) + "\n");
    });
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      try {
        const res = JSON.parse(line) as Response;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.end();
        if (res.ok) resolve(res.result as T);
        else reject(new Error(res.error));
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        reject(e as Error);
      }
    });
    sock.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}
