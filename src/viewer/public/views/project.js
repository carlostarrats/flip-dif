import { findPriorWithRoute, imgUrl, escapeHtml } from "/views/lib.js";
import { mountDropdown } from "/views/dropdown.js";

export async function renderProject(root, hashedCwd, initialSha) {
  root.innerHTML = `<div class="empty">…</div>`;
  const res = await fetch(`/api/projects/${hashedCwd}/snapshots`);
  if (!res.ok) {
    root.innerHTML = `<header class="project-toolbar"><a href="#/" class="back">← back</a></header>
      <div class="empty">Project not found.</div>`;
    return;
  }
  const snapshots = await res.json();
  if (snapshots.length === 0) {
    root.innerHTML = `<header class="project-toolbar"><a href="#/" class="back">← back</a></header>
      <div class="empty">Flip is now active. Your baseline is set.</div>`;
    return;
  }

  // If the URL deep-links to a specific commit (#/project/<hash>/<sha>),
  // start there. Otherwise default to the newest commit.
  const initialIdx = initialSha
    ? Math.max(0, snapshots.findIndex((s) => s.sha === initialSha))
    : 0;
  let currentIdx = initialIdx;
  let route = snapshots[currentIdx].captures[0]?.route ?? "/";
  let mode = "after";

  const draw = () => {
    const after = snapshots[currentIdx];
    const before = findPriorWithRoute(snapshots, currentIdx, route);
    const cap = after.captures.find((c) => c.route === route) ?? after.captures[0];
    if (!cap) {
      root.innerHTML = `<div class="empty">No capture for this route.</div>`;
      return;
    }

    // Decide what the canvas shows. For the very first capture there's no
    // prior to compare against, so before/diff render an explanatory state
    // instead of an image — clearer than the buttons being silently no-op.
    const noPrior = !before;
    let canvasInner;
    if (mode === "after") {
      const alt = `Screenshot of ${route} at commit ${after.sha.slice(0, 7)} — ${after.message}`;
      canvasInner = `<img src="${imgUrl(hashedCwd, after.sha, route)}" width="${cap.width}" height="${cap.height}" alt="${escapeHtml(alt)}" />`;
    } else if (mode === "before") {
      if (noPrior) {
        canvasInner = `<div class="canvas-message" role="status">
             <p class="canvas-message-headline">No prior capture for <code>${escapeHtml(route)}</code>.</p>
             <p class="canvas-message-lede">This is the earliest snapshot flip has on disk for this route — there's nothing to compare against yet. Switch to <strong>after</strong> to see this capture, or pick a newer commit from the dropdown.</p>
           </div>`;
      } else {
        const alt = `Previous screenshot of ${route} at commit ${before.sha.slice(0, 7)} — ${before.message}`;
        canvasInner = `<img src="${imgUrl(hashedCwd, before.sha, route)}" width="${cap.width}" height="${cap.height}" alt="${escapeHtml(alt)}" />`;
      }
    } else {
      if (noPrior) {
        canvasInner = `<div class="canvas-message" role="status">
             <p class="canvas-message-headline">No diff for the first capture.</p>
             <p class="canvas-message-lede">A diff highlights pixels that changed between two snapshots. This is the earliest one for <code>${escapeHtml(route)}</code>, so there's nothing to compare against. Pick a newer commit and the diff will light up.</p>
           </div>`;
      } else {
        const alt = `Pixel diff of ${route} between commits ${before.sha.slice(0, 7)} and ${after.sha.slice(0, 7)}; changed pixels highlighted in red`;
        canvasInner = `<img src="/api/diff?cwd=${hashedCwd}&from=${before.sha}&to=${after.sha}&route=${encodeURIComponent(route)}" width="${cap.width}" height="${cap.height}" alt="${escapeHtml(alt)}" />`;
      }
    }

    root.innerHTML = `
      <header class="project-toolbar">
        <a href="#/" class="back">← back</a>
        <div class="commit-host"></div>
        <div class="route-host"></div>
        <span class="spacer"></span>
        <button class="mode" data-m="before" aria-pressed="${mode === "before"}">before</button>
        <button class="mode" data-m="after" aria-pressed="${mode === "after"}">after</button>
        <button class="mode" data-m="diff" aria-pressed="${mode === "diff"}">diff</button>
      </header>
      <main class="canvas">
        ${canvasInner}
      </main>
    `;

    mountDropdown(root.querySelector(".commit-host"), {
      ariaLabel: "commit",
      items: snapshots.map((s, i) => ({
        value: String(i),
        label: `${s.sha.slice(0, 7)} · ${s.message}`,
      })),
      value: String(currentIdx),
      onChange: (v) => {
        currentIdx = Number(v);
        const newAfter = snapshots[currentIdx];
        if (!newAfter.captures.find((c) => c.route === route)) {
          route = newAfter.captures[0]?.route ?? "/";
        }
        draw();
      },
    });

    mountDropdown(root.querySelector(".route-host"), {
      ariaLabel: "route",
      items: after.captures.map((c) => ({ value: c.route, label: c.route })),
      value: route,
      onChange: (v) => {
        route = v;
        draw();
      },
    });

    root.querySelectorAll(".mode").forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.m;
        draw();
      };
    });
  };
  draw();

  // Avoid unused-import warning when only types are referenced
  void escapeHtml;
}
