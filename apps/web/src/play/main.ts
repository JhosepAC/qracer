import { PROTOCOL_VERSION } from "@qracer/protocol";
import { featureFlags } from "../features.ts";
import { createPreview } from "./preview.ts";
import "../styles.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing application root");
root.dataset.protocolVersion = String(PROTOCOL_VERSION);
root.dataset.pairingEnabled = String(featureFlags.pairing.enabled);
root.innerHTML = `
  <header class="topbar"><a class="brand" href="/play/">Q<span>Racer</span></a>
    <span class="tag">Tu teléfono, al volante</span></header>
  <main class="garage">
    <section class="showcase" aria-labelledby="headline">
      <p class="eyebrow">La carretera te espera</p>
      <h1 id="headline">Siente cada<br><em>kilómetro.</em></h1>
      <p>Un juego de carreras. Tu teléfono como mando.<br>Sin instalar aplicaciones.</p>
      <div id="preview" aria-hidden="true"></div>
      <p class="caption" id="graphics-status">Preparando el garaje…</p>
    </section>
    <section class="panel" aria-labelledby="connect-title">
      <span class="step">01 / Conecta</span><h2 id="connect-title">Toma el control.</h2>
      <p>El código QR para vincular tu teléfono estará disponible próximamente.</p>
      <div class="connection-placeholder" aria-hidden="true"><span>Q</span></div>
      <p class="status">Vinculación aún no disponible</p>
      <a class="button primary" href="/controller/">Conocer el mando</a>
      <p class="fine-print">La conducción estará disponible en una próxima actualización.</p>
    </section>
  </main>
  <footer>Hecho para jugar. Sin cuentas, sin instalaciones.</footer>`;

const preview = document.querySelector<HTMLElement>("#preview");
const status = document.querySelector<HTMLElement>("#graphics-status");
if (preview && status) {
  try {
    const dispose = createPreview(preview);
    status.textContent = "Vista previa del garaje · WebGL 2";
    window.addEventListener("pagehide", dispose, { once: true });
  } catch {
    status.textContent = "Activa WebGL 2 para ver el garaje en este navegador.";
  }
}
