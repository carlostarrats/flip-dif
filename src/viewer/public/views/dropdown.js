// Lightweight dropdown that respects the design system. Replaces the
// native <select> chrome on the project view so the popup menu matches
// Frank's tokens instead of using OS-native rendering.

import { escapeHtml } from "/views/lib.js";

export function mountDropdown(host, opts) {
  const { items, value, onChange, ariaLabel } = opts;
  let current = value;

  const wrap = document.createElement("div");
  wrap.className = "dropdown";
  if (host.className) wrap.classList.add(...host.className.split(/\s+/).filter(Boolean));

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dropdown-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (ariaLabel) trigger.setAttribute("aria-label", ariaLabel);

  const labelOf = (v) => items.find((i) => i.value === v)?.label ?? "";
  const renderTrigger = () => {
    trigger.innerHTML = `<span class="dropdown-label">${escapeHtml(labelOf(current))}</span><span class="dropdown-caret" aria-hidden="true"></span>`;
  };
  renderTrigger();

  const menu = document.createElement("div");
  menu.className = "dropdown-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  const renderOptions = () => {
    menu.innerHTML = items
      .map(
        (i) =>
          `<button type="button" class="dropdown-option" role="option" data-value="${escapeHtml(i.value)}" aria-selected="${i.value === current}">${escapeHtml(i.label)}</button>`,
      )
      .join("");
    menu.querySelectorAll(".dropdown-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const v = opt.dataset.value;
        if (v !== current) {
          current = v;
          renderTrigger();
          renderOptions();
          onChange(v);
        }
        close();
        trigger.focus();
      });
    });
  };

  const open = () => {
    if (!menu.hidden) return;
    renderOptions();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // focus the currently-selected option for keyboard nav
    const sel = menu.querySelector('[aria-selected="true"]') ?? menu.querySelector(".dropdown-option");
    sel?.focus();
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
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const opts = [...menu.querySelectorAll(".dropdown-option")];
      const idx = opts.indexOf(document.activeElement);
      const nextIdx =
        e.key === "ArrowDown"
          ? (idx + 1) % opts.length
          : (idx - 1 + opts.length) % opts.length;
      opts[nextIdx]?.focus();
    }
  };

  trigger.addEventListener("click", () => (menu.hidden ? open() : close()));

  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  host.replaceWith(wrap);

  return {
    setValue(v) {
      current = v;
      renderTrigger();
      if (!menu.hidden) renderOptions();
    },
    setItems(newItems) {
      items.length = 0;
      items.push(...newItems);
      if (!items.find((i) => i.value === current)) current = items[0]?.value;
      renderTrigger();
      if (!menu.hidden) renderOptions();
    },
  };
}
