// Tiny kebab-menu popover. Renders a "···" trigger; clicking opens an
// absolutely-positioned list of actions. Used for per-row and per-tab
// destructive actions in the home view.

import { escapeHtml } from "/views/lib.js";

export function mountKebab(host, opts) {
  const { items, ariaLabel } = opts;

  const wrap = document.createElement("span");
  wrap.className = "kebab";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "kebab-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", ariaLabel ?? "More actions");
  trigger.innerHTML = `<span aria-hidden="true">···</span>`;

  const menu = document.createElement("div");
  menu.className = "kebab-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const renderItems = () => {
    menu.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="kebab-item ${it.destructive ? "destructive" : ""}" role="menuitem">${escapeHtml(it.label)}</button>`,
      )
      .join("");
    [...menu.querySelectorAll(".kebab-item")].forEach((el, i) => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        close();
        await items[i].onClick();
      });
    });
  };

  const open = (e) => {
    if (e) e.stopPropagation();
    if (!menu.hidden) return;
    renderItems();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDoc, true);
    document.addEventListener("keydown", onKey, true);
  };
  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onDoc = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      trigger.focus();
    }
  };

  trigger.addEventListener("click", (e) => (menu.hidden ? open(e) : close()));

  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  host.appendChild(wrap);

  return { close };
}
