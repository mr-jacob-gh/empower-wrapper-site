// A small themed confirmation dialog (native <dialog>, so focus is trapped and
// Escape cancels). Resolves true only when the confirm button is pressed.

export interface ConfirmOptions {
  title: string;
  body: string;
  confirm: string;
  cancel?: string;
  /** Inline SVG shown above the title. Trusted markup only. */
  icon?: string;
}

let open = false;

export function confirmDialog({ title, body, confirm, cancel = "Cancel", icon = "" }: ConfirmOptions): Promise<boolean> {
  if (open) return Promise.resolve(false);
  open = true;

  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirm";
    dlg.setAttribute("aria-labelledby", "confirm-title");
    dlg.setAttribute("aria-describedby", "confirm-body");
    dlg.innerHTML = `
      ${icon ? `<div class="confirm__icon" aria-hidden="true">${icon}</div>` : ""}
      <h2 class="confirm__title" id="confirm-title"></h2>
      <p class="confirm__body" id="confirm-body"></p>
      <form method="dialog" class="confirm__actions">
        <button class="btn btn--ghost" value="cancel" autofocus></button>
        <button class="btn btn--danger" value="confirm"></button>
      </form>`;
    dlg.querySelector("#confirm-title")!.textContent = title;
    dlg.querySelector("#confirm-body")!.textContent = body;
    dlg.querySelector("[value='cancel']")!.textContent = cancel;
    dlg.querySelector("[value='confirm']")!.textContent = confirm;

    // A click on the dimmed backdrop (outside the panel) cancels.
    dlg.addEventListener("click", (e) => {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close("cancel");
    });
    dlg.addEventListener("close", () => {
      open = false;
      resolve(dlg.returnValue === "confirm");
      dlg.remove();
    });

    document.body.append(dlg);
    dlg.showModal();
  });
}
