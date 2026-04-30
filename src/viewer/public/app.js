import { renderHome } from "/views/home.js";
import { renderProject } from "/views/project.js";

const root = document.getElementById("root");
const toasts = document.getElementById("toasts");

function parseRoute() {
  // #/project/<hash>            → project view, default to newest commit
  // #/project/<hash>/<sha>      → project view at a specific commit
  const hash = location.hash || "#/";
  if (hash.startsWith("#/project/")) {
    const rest = hash.slice("#/project/".length);
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      return { name: "project", cwdHash: rest.slice(0, slash), sha: rest.slice(slash + 1) };
    }
    return { name: "project", cwdHash: rest, sha: null };
  }
  return { name: "home" };
}

function render() {
  const route = parseRoute();
  if (route.name === "project") {
    renderProject(root, route.cwdHash, route.sha);
  } else {
    renderHome(root);
  }
}

window.addEventListener("hashchange", render);
render();
checkNotifications();

async function checkNotifications() {
  try {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const list = await res.json();
    toasts.innerHTML = "";
    for (const n of list) {
      const el = document.createElement("div");
      el.className = "toast";
      el.textContent = n.message;
      el.onclick = async () => {
        await fetch("/api/notifications/dismiss", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: n.cwd }),
        });
        el.remove();
      };
      toasts.appendChild(el);
    }
  } catch {
    /* ignore */
  }
}
