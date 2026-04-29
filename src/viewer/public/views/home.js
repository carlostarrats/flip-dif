export async function renderHome(root) {
  root.innerHTML = `<div class="empty">…</div>`;
  const res = await fetch("/api/projects");
  const projects = await res.json();
  if (projects.length === 0) {
    root.innerHTML = `<header><h1>flip</h1></header>
      <div class="empty">Flip is watching. Make a commit to capture your first snapshot.</div>`;
    return;
  }
  root.innerHTML = `
    <header><h1>flip</h1></header>
    <ul class="projects">
      ${projects.map((p) => `
        <li>
          <a href="#/project/${p.hashedCwd}">
            <span class="name">${escapeHtml(p.name)}</span>
            <span class="meta">${p.snapshotCount} ${p.snapshotCount === 1 ? "commit" : "commits"} · ${rel(p.lastSeen)}</span>
          </a>
        </li>
      `).join("")}
    </ul>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function rel(ts) {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
