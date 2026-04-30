import { escapeHtml, rel } from "/views/lib.js";
import { mountKebab } from "/views/menu.js";
import { confirmModal } from "/views/modal.js";

export async function renderHome(root) {
  root.innerHTML = `<div class="home"><div class="empty">…</div></div>`;
  let projects = await (await fetch("/api/projects")).json();
  projects.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

  let activeIdx = 0;

  const drawShell = () => {
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
  };

  drawShell();
  const right = root.querySelector("#home-right");

  if (projects.length === 0) {
    right.innerHTML = `<div class="empty">flip is watching. Make a commit to capture your first snapshot.</div>`;
    return;
  }

  const drawRight = () => {
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
      if (!active) {
        body.innerHTML = `<div class="empty">No project selected.</div>`;
        return;
      }
      const commits = await (await fetch(`/api/projects/${active.hashedCwd}/snapshots`)).json();

      body.innerHTML = `
        <div class="home-section-head">
          <span>commits</span>
          <span class="home-section-count">${commits.length}</span>
          <span class="home-section-actions" id="project-actions"></span>
        </div>
        ${commits.length === 0
          ? `<div class="empty">No commits captured yet for this project.</div>`
          : `<ul class="commits">${commits.map((c) => commitRow(active.hashedCwd, c)).join("")}</ul>`
        }
      `;

      // Project-level kebab (next to the section head).
      const projActions = body.querySelector("#project-actions");
      mountKebab(projActions, {
        ariaLabel: `Manage ${active.name}`,
        items: [
          {
            label: "Delete project",
            destructive: true,
            onClick: async () => {
              const ok = await confirmModal({
                title: `Delete project "${active.name}"?`,
                body: `This removes all of flip's captured snapshots for this project from ~/.flip and stops the daemon from watching it. Your project files and git history are untouched.`,
                confirmLabel: "Delete project",
                destructive: true,
              });
              if (!ok) return;
              const r = await fetch(`/api/projects/${active.hashedCwd}`, { method: "DELETE" });
              if (!r.ok) {
                alert("Failed to delete project.");
                return;
              }
              // Re-render the entire home view from scratch.
              await renderHome(root);
            },
          },
        ],
      });

      // Per-commit kebab on each row. Labelled "Delete snapshot" to make
      // clear flip is removing its own captured image — the user's git
      // history is untouched.
      body.querySelectorAll(".commit-row-kebab").forEach((host) => {
        const sha = host.dataset.sha;
        const cap = host.dataset.label ?? sha.slice(0, 7);
        mountKebab(host, {
          ariaLabel: `Actions for ${cap}`,
          items: [
            {
              label: "Delete snapshot",
              destructive: true,
              onClick: async () => {
                const ok = await confirmModal({
                  title: `Delete flip's snapshot for commit ${sha.slice(0, 7)}?`,
                  body: `This removes the captured images from ~/.flip only.\nYour git commit and project files are untouched.`,
                  confirmLabel: "Delete snapshot",
                  destructive: true,
                });
                if (!ok) return;
                const r = await fetch(`/api/projects/${active.hashedCwd}/snapshots/${sha}`, { method: "DELETE" });
                if (!r.ok) {
                  alert("Failed to delete snapshot.");
                  return;
                }
                await renderBody();
              },
            },
          ],
        });
      });
    };

    tabButtons.forEach((t) => {
      t.addEventListener("click", async () => {
        activeIdx = Number(t.dataset.idx);
        await renderBody();
        t.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
        updateOverflow();
        // Reflect the new active state on the existing buttons (don't re-render
        // the strip — preserves scroll position).
        tabButtons.forEach((btn, i) => {
          const isActive = i === activeIdx;
          btn.classList.toggle("active", isActive);
          btn.setAttribute("aria-selected", isActive);
        });
      });
    });

    return renderBody();
  };

  await drawRight();

  // Live-update poll: every 3s, refetch projects + the active project's
  // commits and re-render the body if anything changed. This way new
  // captures appear automatically without a manual refresh.
  let polling = true;
  const stopPoll = () => { polling = false; };
  window.addEventListener("hashchange", stopPoll, { once: true });

  let lastSig = signature(projects, projects[activeIdx]);
  (async function poll() {
    while (polling) {
      await new Promise((r) => setTimeout(r, 3000));
      if (!polling) break;
      try {
        const fresh = await (await fetch("/api/projects")).json();
        fresh.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
        const sig = signature(fresh, fresh[activeIdx]);
        if (sig !== lastSig) {
          lastSig = sig;
          // Re-render the whole home view so new tabs appear and the active
          // project's commit list refreshes.
          await renderHome(root);
          return;
        }
      } catch {
        /* network blip — try again */
      }
    }
  })();
}

function signature(projects, active) {
  return JSON.stringify({
    projects: projects.map((p) => `${p.hashedCwd}:${p.snapshotCount}:${p.lastSeen}`),
    activeCwd: active?.hashedCwd ?? null,
  });
}

function commitRow(hashedCwd, c) {
  const routes = c.captures.length;
  const label = `${c.sha.slice(0, 7)} ${c.message}`.replace(/"/g, "&quot;");
  return `
    <li class="commit-row-li">
      <a class="commit-row" href="#/project/${hashedCwd}/${c.sha}">
        <div class="commit-row-info">
          <div class="commit-row-head">
            <span class="commit-sha">${c.sha.slice(0, 7)}</span>
            <span class="commit-msg">${escapeHtml(c.message)}</span>
          </div>
        </div>
        <span class="commit-meta">${routes} ${routes === 1 ? "route" : "routes"} · ${rel(c.timestamp)}</span>
      </a>
      <span class="commit-row-kebab" data-sha="${c.sha}" data-label="${label}"></span>
    </li>
  `;
}
