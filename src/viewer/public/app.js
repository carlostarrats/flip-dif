import { renderHome } from "/views/home.js";
import { renderProject } from "/views/project.js";

const root = document.getElementById("root");
const toasts = document.getElementById("toasts");

function render() {
  const hash = location.hash || "#/";
  if (hash.startsWith("#/project/")) {
    const cwdHash = hash.slice("#/project/".length);
    renderProject(root, cwdHash);
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
