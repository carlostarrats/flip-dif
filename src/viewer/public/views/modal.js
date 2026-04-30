// Frank-style confirm modal — replaces window.confirm() so dangerous
// actions live inside the design system instead of using native chrome.
// Returns Promise<boolean>: resolves true on confirm, false on cancel
// (or ESC, or backdrop click).

import { escapeHtml } from "/views/lib.js";

export function confirmModal(opts) {
  const {
    title,
    body = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
  } = opts;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "modal-title");

    card.innerHTML = `
      <div class="modal-body">
        <h2 class="modal-title" id="modal-title">${escapeHtml(title)}</h2>
        ${body ? `<p class="modal-lede">${escapeHtml(body)}</p>` : ""}
      </div>
      <div class="modal-actions">
        <button type="button" class="modal-button modal-button-secondary" data-act="cancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="modal-button ${destructive ? "modal-button-destructive" : "modal-button-primary"}" data-act="confirm">${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    overlay.appendChild(card);

    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      // Restore focus to whatever was focused before the modal opened.
      lastFocus?.focus?.();
      resolve(v);
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      }
    };

    overlay.addEventListener("click", (e) => {
      // Click on the backdrop (outside the card) cancels.
      if (e.target === overlay) finish(false);
    });

    card.querySelector('[data-act="cancel"]').addEventListener("click", () => finish(false));
    card.querySelector('[data-act="confirm"]').addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey, true);

    const lastFocus = document.activeElement;
    document.body.appendChild(overlay);
    // Focus the destructive action by default (matches macOS confirm dialogs)
    // but since destructive is dangerous, focus Cancel for safety.
    const initialFocus = card.querySelector(destructive ? '[data-act="cancel"]' : '[data-act="confirm"]');
    initialFocus?.focus?.();
  });
}
