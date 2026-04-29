import { escapeHtml, rel } from "/views/lib.js";

export async function renderHome(root) {
  root.innerHTML = `<div class="home"><div class="empty">…</div></div>`;
  const projects = await (await fetch("/api/projects")).json();
  // Most-recently-active project becomes the default tab.
  projects.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

  let activeIdx = 0;

  const drawShell = () => `
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
        <div class="home-col home-col-right" id="home-right"></div>
      </div>
    </div>
  `;

  root.innerHTML = drawShell();
  const right = root.querySelector("#home-right");

  if (projects.length === 0) {
    right.innerHTML = `<div class="empty">flip is watching. Make a commit to capture your first snapshot.</div>`;
    return;
  }

  const drawRight = async () => {
    const active = projects[activeIdx];
    const commits = await (await fetch(`/api/projects/${active.hashedCwd}/snapshots`)).json();

    right.innerHTML = `
      <nav class="home-tabs" role="tablist" aria-label="Projects">
        ${projects.map((p, i) =>
          `<button class="home-tab ${i === activeIdx ? "active" : ""}" data-idx="${i}" role="tab" aria-selected="${i === activeIdx}">${escapeHtml(p.name)}</button>`,
        ).join("")}
      </nav>

      <div class="home-section-head">
        <span>commits</span>
        <span class="home-section-count">${commits.length}</span>
      </div>

      ${commits.length === 0
        ? `<div class="empty">No commits captured yet for this project.</div>`
        : `<ul class="commits">${commits.map((c) => commitRow(active.hashedCwd, c)).join("")}</ul>`
      }
    `;

    right.querySelectorAll(".home-tab").forEach((t) => {
      t.addEventListener("click", () => {
        activeIdx = Number(t.dataset.idx);
        drawRight();
      });
    });
  };

  await drawRight();
}

function commitRow(hashedCwd, c) {
  const routes = c.captures.length;
  return `
    <li>
      <a class="commit-row" href="#/project/${hashedCwd}">
        <div class="commit-row-info">
          <div class="commit-row-head">
            <span class="commit-sha">${c.sha.slice(0, 7)}</span>
            <span class="commit-msg">${escapeHtml(c.message)}</span>
          </div>
        </div>
        <span class="commit-meta">${routes} ${routes === 1 ? "route" : "routes"} · ${rel(c.timestamp)}</span>
      </a>
    </li>
  `;
}
