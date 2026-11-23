import { PROTOCOL_VERSION } from "@qracer/protocol/version";
import { featureFlags } from "../features.ts";
import "../styles.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing application root");
root.dataset.protocolVersion = String(PROTOCOL_VERSION);
root.dataset.pairingEnabled = String(featureFlags.pairing.enabled);
root.innerHTML = `
  <header class="topbar"><a class="brand" href="/play/">Q<span>Racer</span></a>
    <span class="tag">Tu mando</span></header>
  <main class="controller-shell">
    <section class="panel" aria-labelledby="controller-title">
      <span class="step">02 / Conduce</span><h1 id="controller-title">El control<br>está en tus manos.</h1>
      <p>Abre QRacer en tu computadora para comenzar.</p>
      <p class="status" role="status">La vinculación estará disponible próximamente.</p>
      <fieldset disabled><legend>Vista previa de los controles</legend>
        <div class="controls"><button type="button" aria-label="Girar a la izquierda">←</button>
        <button type="button" aria-label="Girar a la derecha">→</button>
        <button type="button">Freno</button><button type="button">Nitro</button></div>
      </fieldset>
      <p class="fine-print">Sin permisos de sensores ni cámara hasta que elijas usarlos.</p>
      <a class="text-link" href="/play/">Volver a QRacer</a>
    </section>
  </main>`;
