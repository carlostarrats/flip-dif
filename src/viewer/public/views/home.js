import { escapeHtml, rel } from "/views/lib.js";

export async function renderHome(root) {
  root.innerHTML = `<div class="home"><div class="empty">…</div></div>`;
  const projects = await (await fetch("/api/projects")).json();
  // Most-recently-active project becomes the default tab.
  projects.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

  let activeIdx = 0;

  root.innerHTML = `
    <div class="home">
      <header class="home-masthead">
        <div class="home-logo-row">
          <img src="/flip-logo.svg" alt="flip" class="home-logo" />
          <span class="home-version">v0.1</span>
        </div>
        <div class="home-masthead-spacer"></div>
        <div class="home-stats">
          <span class="home-stat">
            <span class="home-stat-value">${projects.length}</span>
            <span class="home-stat-label">${projects.length === 1 ? "project" : "projects"}</span>
          </span>
        </div>
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
            <p class="home-howto-foot">flip keeps the last <strong>20 commits</strong> per project on disk. Once a project hits the limit, the oldest snapshot rolls off automatically. Change the cap in <code>~/.flip/config.json</code>.</p>
          </section>
        </div>
        <div class="home-col home-col-right" id="home-right"></div>
      </div>
    </div>
  `;

  const right = root.querySelector("#home-right");

  if (projects.length === 0) {
    right.innerHTML = `<div class="empty">flip is watching. Make a commit to capture your first snapshot.</div>`;
    return;
  }

  // Render the tab strip ONCE so the user's scroll position survives across
  // tab clicks. Only the body below re-renders when the active tab changes.
  right.innerHTML = `
    <div class="home-tabs-wrap">
      <nav class="home-tabs" role="tablist" aria-label="Projects">
        ${projects.map((p, i) =>
          `<button class="home-tab ${i === activeIdx ? "active" : ""}" data-idx="${i}" role="tab" aria-selected="${i === activeIdx}">${escapeHtml(p.name)}</button>`,
        ).join("")}
      </nav>
    </div>
    <div class="home-body"></div>
  `;

  const tabsEl = right.querySelector(".home-tabs");
  const body = right.querySelector(".home-body");
  const tabButtons = [...right.querySelectorAll(".home-tab")];

  const updateOverflow = () => {
    const canLeft = tabsEl.scrollLeft > 4;
    const canRight = tabsEl.scrollLeft + tabsEl.clientWidth < tabsEl.scrollWidth - 4;
    tabsEl.dataset.overflow = canLeft && canRight ? "both" : canLeft ? "left" : canRight ? "right" : "";
  };
  tabsEl.addEventListener("scroll", updateOverflow);
  if ("ResizeObserver" in window) new ResizeObserver(updateOverflow).observe(tabsEl);
  updateOverflow();

  const renderBody = async () => {
    const active = projects[activeIdx];
    const commits = await (await fetch(`/api/projects/${active.hashedCwd}/snapshots`)).json();

    body.innerHTML = `
      <div class="home-section-head">
        <span>commits</span>
        <span class="home-section-count">${commits.length}</span>
      </div>
      ${commits.length === 0
        ? `<div class="empty">No commits captured yet for this project.</div>`
        : `<ul class="commits">${commits.map((c) => commitRow(active.hashedCwd, c)).join("")}</ul>`
      }
    `;

    tabButtons.forEach((t, i) => {
      const isActive = i === activeIdx;
      t.classList.toggle("active", isActive);
      t.setAttribute("aria-selected", isActive);
    });
  };

  tabButtons.forEach((t) => {
    t.addEventListener("click", async () => {
      activeIdx = Number(t.dataset.idx);
      await renderBody();
      // Keep the clicked tab in view if it sits past the right edge of the
      // strip — without disturbing scroll position when it's already visible.
      t.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      updateOverflow();
    });
  });

  await renderBody();
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
