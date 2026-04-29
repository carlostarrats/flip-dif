// Pure helpers for the viewer SPA. Imported by views/project.js in the
// browser and exercised by Node tests under tests/viewer/.

export function findPriorWithRoute(snapshots, idx, route) {
  for (let i = idx + 1; i < snapshots.length; i++) {
    if (snapshots[i].captures.find((c) => c.route === route)) return snapshots[i];
  }
  return null;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function rel(ts) {
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

export function imgUrl(cwd, sha, route) {
  const slug = route === "/" ? "_root" : route.replace(/^\//, "").replace(/\//g, "_");
  return `/snapshots/${cwd}/${sha}/${slug}.png`;
}
