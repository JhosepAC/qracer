let sequence = 0;
/** Native modal confirmation; all supplied strings are assigned as text, never HTML. */
export function confirmAction(title: string, description: string): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    const id = `confirm-${++sequence}`;
    dialog.setAttribute("aria-labelledby", id);
    dialog.innerHTML = `<form method="dialog"><h2></h2><p></p><div><button value="cancel" autofocus>Cancelar</button><button value="confirm">Confirmar</button></div></form>`;
    const heading = dialog.querySelector("h2");
    const detail = dialog.querySelector("p");
    if (heading) {
      heading.id = id;
      heading.textContent = title;
    }
    if (detail) detail.textContent = description;
    dialog.addEventListener(
      "close",
      () => {
        const accepted = dialog.returnValue === "confirm";
        dialog.remove();
        if (previous instanceof HTMLElement) previous.focus();
        resolve(accepted);
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
  });
}
