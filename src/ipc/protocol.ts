export type Method =
  | "ping"
  | "register"
  | "snap"
  | "shutdown"
  | "status"
  | "notifications"
  | "dismissNotification";

export type Request =
  | { id: number; method: "ping" }
  | { id: number; method: "register"; cwd: string; port?: number }
  | { id: number; method: "snap"; cwd: string }
  | { id: number; method: "shutdown" }
  | { id: number; method: "status" }
  | { id: number; method: "notifications" }
  | { id: number; method: "dismissNotification"; cwd: string };

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
