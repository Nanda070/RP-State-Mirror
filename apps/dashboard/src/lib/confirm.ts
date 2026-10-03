/**
 * The site's own «are you sure?» dialog, usable from any event handler:
 *
 *   if (!(await confirmDialog("Убрать панель в архив?"))) return;
 *
 * Built on a native <dialog> (focus trap, Escape, backdrop for free) and styled by `.confirm-dialog`.
 * Browser-only: call it from event handlers of client components.
 */
export function confirmDialog(
  message: string,
  options: { confirmLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";

    const text = document.createElement("p");
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = "Отмена";

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = options.danger === false ? "btn btn-primary" : "btn btn-danger";
    confirm.textContent = options.confirmLabel ?? "Подтвердить";

    actions.append(cancel, confirm);
    dialog.append(text, actions);
    document.body.append(dialog);

    let answer = false;
    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => {
      answer = true;
      dialog.close();
    });
    // Closing by Escape or by a click on the backdrop counts as «no».
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(answer);
    });
    dialog.showModal();
    cancel.focus();
  });
}
