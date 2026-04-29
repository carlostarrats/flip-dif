export async function run(): Promise<number> {
  console.log(`flip — visual snapshot tool for developers building with agents

Usage:
  flip start [--port N]    Start daemon and register the current project
  flip                     Open viewer in the browser (daemon must be running)
  flip snap                Manually capture the current state of this project
  flip stop                Stop the daemon
  flip clear               Wipe all snapshot history (asks for confirmation)
  flip --help              Show this message

Notes:
  - Run from your project directory; flip detects the framework from package.json.
  - Pass --port N to point at your dev server. With portless, this is auto-detected.
  - Viewer:  http://localhost:42069
  - Storage: ~/.flip/

Docs: https://github.com/carlostarrats/flip-dif`);
  return 0;
}
