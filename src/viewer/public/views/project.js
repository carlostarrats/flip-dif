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
    let src;
    if (mode === "after" || (mode !== "after" && !before)) {
      src = imgUrl(hashedCwd, after.sha, route);
    } else if (mode === "before") {
      src = imgUrl(hashedCwd, before.sha, route);
    } else {
      src = `/api/diff?cwd=${hashedCwd}&from=${before.sha}&to=${after.sha}&route=${encodeURIComponent(route)}`;
    }

    root.innerHTML = `
      <header class="project-toolbar">
        <a href="#/" class="back">← back</a>
        <div class="commit-host"></div>
        <div class="route-host"></div>
        <span class="spacer"></span>
        <button class="mode" data-m="before" aria-pressed="${mode === "before"}" ${!before ? "disabled" : ""}>before</button>
        <button class="mode" data-m="after" aria-pressed="${mode === "after"}">after</button>
        <button class="mode" data-m="diff" aria-pressed="${mode === "diff"}" ${!before ? "disabled" : ""}>diff</button>
      </header>
      <main class="canvas">
        <img src="${src}" width="${cap.width}" height="${cap.height}" alt="" />
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
