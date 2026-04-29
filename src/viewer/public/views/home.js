import { escapeHtml, rel } from "/views/lib.js";

export async function renderHome(root) {
  root.innerHTML = `<div class="home"><div class="empty">…</div></div>`;
  const res = await fetch("/api/projects");
  const projects = await res.json();

  const totalDiffs = projects.reduce((acc, p) => acc + Math.max(0, p.snapshotCount - 1), 0);

  root.innerHTML = `
    <div class="home">
      <header class="home-masthead">
        <div class="home-logo-row">
          <img src="/flip-logo.svg" alt="flip" class="home-logo" />
          <span class="home-version">v0.1</span>
        </div>
        <div class="home-masthead-spacer"></div>
      </header>

      <div class="home-grid">
        <div class="home-col home-col-left">
          <section class="home-panel" data-title="about">
            <h1 class="home-headline">See what your agent just changed visually.</h1>
            <p class="home-lede">flip captures a full-page screenshot of every page your agent touches on every git commit, then lets you toggle before/after — or watch a pixel diff — without leaving your machine. No baselines, no CI, no cloud.</p>
          </section>

          <section class="home-panel" data-title="how it works">
            <ol class="home-howto">
              <li>Run <code>flip start</code> in your project directory.</li>
              <li>Make a commit. flip reads the diff, maps changed files to routes, captures each one.</li>
              <li>Open this viewer to flip between commits, switch routes, and read the diff overlay.</li>
            </ol>
          </section>
        </div>

        <div class="home-col home-col-right">
          <nav class="home-tabs" role="tablist" aria-label="Project tabs">
            ${projects.length === 0
              ? `<button class="home-tab active" role="tab" aria-selected="true">all</button>`
              : projects.map((p, i) =>
                  `<button class="home-tab ${i === 0 ? "active" : ""}" role="tab" aria-selected="${i === 0}" data-cwd="${p.hashedCwd}">${escapeHtml(p.name)}</button>`,
                ).join("")
            }
          </nav>

          <div class="home-projects" id="home-projects">
            <div class="home-section-head">
              <span>projects</span>
              <span class="home-section-count">${projects.length} · ${totalDiffs} ${totalDiffs === 1 ? "diff" : "diffs"}</span>
            </div>

            ${projects.length === 0
              ? `<div class="empty">flip is watching. Make a commit to capture your first snapshot.</div>`
              : `<ul class="projects">${projects.map(projectCard).join("")}</ul>`
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function projectCard(p) {
  const diffs = Math.max(0, p.snapshotCount - 1);
  return `
    <li>
      <a class="project-card" href="#/project/${p.hashedCwd}">
        <div class="project-card-info">
          <span class="project-card-name">${escapeHtml(p.name)}</span>
          <span class="project-card-meta">${p.snapshotCount} ${p.snapshotCount === 1 ? "commit" : "commits"} · ${rel(p.lastSeen)}</span>
        </div>
        <div class="project-card-stats">
          <span class="stat" title="Diffs available">
            <span class="stat-value">${diffs}</span>
            <span class="stat-label">${diffs === 1 ? "diff" : "diffs"}</span>
          </span>
        </div>
      </a>
    </li>
  `;
}
