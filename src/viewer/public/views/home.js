import { escapeHtml, rel } from "/views/lib.js";

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
