import { translateText, type Locale } from "./messages.ts";
import "./locale.css";

const storageKey = "qracer.locale.v1";
const attributes = ["aria-label", "title", "placeholder"];
type Original = { source: string; last: string };

/** Presentation-only adapter for native DOM views, including lazy session dialogs.
 * It changes text/accessible names, never HTML, values, credentials or wire data.
 * The observer is disconnected for Spanish, and only visits changed nodes in English.
 */
export function mountLocale() {
  let locale: Locale = "es";
  try {
    if (localStorage.getItem(storageKey) === "en") locale = "en";
  } catch {
    /* Optional preference. */
  }
  const original = new WeakMap<Node, Map<string, Original>>();
  const label = document.createElement("label");
  label.className = "locale-picker";
  label.innerHTML = `<span>Idioma</span><select aria-label="Idioma"><option value="es">Español</option><option value="en">English</option></select>`;
  document.querySelector(".race-bar, .topbar")?.append(label);
  const select = label.querySelector("select");
  if (!select) throw new Error("Missing locale selector");
  select.value = locale;
  const title = document.title;

  function apply(node: Node, attribute = "") {
    const current = attribute ? (node as Element).getAttribute(attribute) : node.nodeValue;
    if (current === null) return;
    const known = original.get(node) ?? new Map<string, Original>();
    const previous = known.get(attribute);
    const source = previous?.last === current ? previous.source : current;
    const next = translateText(source, locale);
    known.set(attribute, { source, last: next });
    original.set(node, known);
    if (current === next) return;
    if (attribute) (node as Element).setAttribute(attribute, next);
    else node.nodeValue = next;
  }
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement?.closest("script,style,code,pre,[translate=no]")) apply(node);
      return;
    }
    if (node instanceof Element) {
      if (node.matches("script,style,code,pre,[translate=no]")) return;
      for (const attr of attributes) if (node.hasAttribute(attr)) apply(node, attr);
    }
    for (const child of node.childNodes) visit(child);
  }
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "attributes") apply(change.target, change.attributeName ?? "");
      else if (change.type === "characterData") visit(change.target);
      else for (const added of change.addedNodes) visit(added);
    }
  });
  function refresh() {
    observer.disconnect();
    document.documentElement.lang = locale;
    document.title =
      locale === "es"
        ? title
        : `QRacer — ${location.pathname.startsWith("/controller") ? "Controller" : "Drive"}`;
    visit(document.body);
    document.dispatchEvent(new Event("qracer:locale"));
    if (locale === "en")
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: attributes,
      });
  }
  select.onchange = () => {
    locale = select.value === "en" ? "en" : "es";
    refresh();
    try {
      localStorage.setItem(storageKey, locale);
    } catch {
      /* Still works for this tab. */
    }
  };
  refresh();
}
