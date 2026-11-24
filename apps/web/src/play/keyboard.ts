import { neutralInput } from "@qracer/game-core";

export const defaultBindings = {
  left: "KeyA",
  right: "KeyD",
  throttle: "KeyW",
  brake: "KeyS",
  boost: "Space",
};
export type Bindings = typeof defaultBindings;
export type Binding = keyof Bindings;
const codes = /^(Key[A-Z]|Digit[0-9]|Space|Arrow(?:Left|Right|Up|Down))$/;
export function readBindings(value: unknown): Bindings {
  if (!value || typeof value !== "object") return { ...defaultBindings };
  const object = value as Record<string, unknown>;
  const result = { ...defaultBindings };
  for (const key of Object.keys(result) as Binding[]) {
    const code = object[key];
    if (typeof code !== "string" || !codes.test(code)) return { ...defaultBindings };
    result[key] = code;
  }
  return new Set(Object.values(result)).size === 5 ? result : { ...defaultBindings };
}
export const keyName = (code: string) =>
  ({ ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "␣" })[code] ??
  code.replace(/^Key/, "");
export function keyboardInput(keys: ReadonlySet<string>, bindings: Bindings, assisted: boolean) {
  const defaults = Object.keys(defaultBindings).every(
    (key) => bindings[key as Binding] === defaultBindings[key as Binding],
  );
  const held = (key: Binding) =>
    keys.has(bindings[key]) ||
    (defaults &&
      keys.has(
        {
          left: "ArrowLeft",
          right: "ArrowRight",
          throttle: "ArrowUp",
          brake: "ArrowDown",
          boost: "ShiftLeft",
        }[key],
      )) ||
    (key === "boost" && defaults && keys.has("ShiftRight"));
  const brake = Number(held("brake"));
  return {
    ...neutralInput,
    steer: (Number(held("right")) - Number(held("left"))) * (assisted ? 0.7 : 1),
    throttle: brake ? 0 : held("throttle") ? (assisted ? 0.35 : 1) : 0,
    brake,
    boost: held("boost") && !brake && !assisted,
    assist: assisted,
  };
}
export function isDrivingKey(code: string, bindings: Bindings) {
  return (
    (codes.test(code) && Object.values(bindings).includes(code)) ||
    (Object.keys(defaultBindings).every(
      (key) => bindings[key as Binding] === defaultBindings[key as Binding],
    ) &&
      /^(Arrow(?:Left|Right|Up|Down)|ShiftLeft|ShiftRight)$/.test(code))
  );
}

export function mountKeyboard(target: HTMLElement, bindings: Bindings, save: () => void) {
  target.innerHTML = `<details><summary>Teclado</summary><p class="fine-print">Enfoca una tecla y pulsa una letra, flecha o espacio. Esc cancela. Tab cambia de campo.</p><div class="key-bindings"></div><p id="binding-status" role="status"></p><button type="button" id="binding-reset">Restablecer teclas</button></details>`;
  const grid = target.querySelector(".key-bindings");
  const status = target.querySelector("#binding-status");
  function redraw() {
    for (const input of target.querySelectorAll<HTMLInputElement>("input[data-binding]"))
      input.value = keyName(bindings[input.dataset.binding as Binding]);
    const values = document.querySelectorAll(".race-keyboard dd");
    if (values[0]) values[0].textContent = `${keyName(bindings.left)} / ${keyName(bindings.right)}`;
    if (values[1])
      values[1].textContent = `${keyName(bindings.throttle)} / ${keyName(bindings.brake)}`;
    if (values[2]) values[2].textContent = keyName(bindings.boost);
  }
  for (const [key, label] of Object.entries({
    left: "Girar a la izquierda",
    right: "Girar a la derecha",
    throttle: "Acelerar",
    brake: "Freno",
    boost: "Nitro",
  })) {
    const item = document.createElement("label");
    item.textContent = label;
    const input = document.createElement("input");
    input.readOnly = true;
    input.dataset.binding = key;
    input.onkeydown = (event) => {
      if (event.code === "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        input.blur();
        return;
      }
      if (!codes.test(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      if (Object.entries(bindings).some(([name, code]) => name !== key && code === event.code)) {
        if (status) status.textContent = "Esa tecla ya está asignada.";
        return;
      }
      bindings[key as Binding] = event.code;
      if (status) status.textContent = "Tecla guardada.";
      redraw();
      save();
    };
    item.append(input);
    grid?.append(item);
  }
  target.querySelector("#binding-reset")?.addEventListener("click", () => {
    Object.assign(bindings, defaultBindings);
    redraw();
    save();
  });
  redraw();
}
