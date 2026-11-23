# QRacer

Juego arcade 3D para navegador de PC, controlado desde un teléfono mediante un código QR. El mando web funciona sin instalar una aplicación; gráficos, conexión y controles cuentan con alternativas según las capacidades del dispositivo.

**Estado:** la carrera costera se puede jugar con teclado o con un móvil
vinculado. El mando incluye inclinación, volante táctil, botones y
pausa segura al perder la entrada. El laboratorio F02 de sensores, relay y
rendimiento sigue en validación.
Instrucciones del laboratorio en [PROBES.md](PROBES.md).

- [Instrucciones para agentes](AGENTS.md)

La planificación en `docs/` se mantiene local y está excluida del repositorio por decisión del propietario. Las reglas públicas de contribución están en [CONTRIBUTING.md](CONTRIBUTING.md).

## Preparación

Requiere **Node 24.21.0** y **pnpm 12.14.0**. Si falta pnpm, puede instalarse con `npm install --global pnpm@12.14.0`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abrir [PC](http://127.0.0.1:5173/play/) o [mando](http://127.0.0.1:5173/controller/).
Son aplicaciones independientes: el renderer se carga únicamente en PC.
En `/play/`, espera a que se cargue la escena WebGL 2 y elige **Salir a pista**.
Usa **A/D** o **←/→** para girar, **W/↑** para acelerar, **S/↓** para frenar,
**Shift** para activar nitro y **Esc** para pausar. La carrera comienza con
una cuenta atrás y termina al agotar la integridad. Puedes reiniciar desde
la pausa o los resultados.

Las pruebas de QR, sensores y movimiento con el teléfono se abren en
`/probe/` y `/probe/controller/`.

## Relay y distribución local

```sh
pnpm build
pnpm dev:local
```

Abrir `http://127.0.0.1:3000/play/` para jugar y `/probe/` para F02. El relay sirve las aplicaciones,
`/health`, el bootstrap `/ws` y las sesiones aisladas `/probe/session`/`/probe/ws/…`.
La vinculación definitiva y la política de reconexión pertenecen a F04.

Para cambiar host, puerto y orígenes, copiar `apps/relay-local/.env.example` a `.env` dentro de esa aplicación. LAN requiere configurar host/orígenes explícitamente y permitir solo el puerto necesario; no desactivar firewall ni abrir puertos del router. Los sensores requieren HTTPS de confianza.

```sh
pnpm package:local
```

Genera `artifacts/qracer-local-0.1.0.tar.gz`, checksum SHA-256 y avisos completos de licencias. Extraer y ejecutar `node start.mjs`; no necesita pnpm, `node_modules`, Blender ni CodeGraph. El comando también prueba el paquete fuera del checkout. Se requiere `tar`, disponible en Windows moderno y Linux/macOS.

## Vincular el móvil en la red local

Usa una red Wi-Fi de confianza. Con ambos dispositivos en esa red, sustituye
la IP de ejemplo por la IP LAN de la PC. Desde una terminal PowerShell en la
edición local extraída:

```powershell
$env:QRACER_HOST = "192.168.1.10"
$env:QRACER_PORT = "3000"
$env:QRACER_ALLOWED_ORIGINS = "http://192.168.1.10:3000"
node start.mjs
```

Para trabajar desde el código fuente, ejecuta `pnpm build` y después
`pnpm dev:local` con esas mismas variables. Si el firewall lo requiere,
permite solo ese puerto en tu red privada.

1. Abre `http://192.168.1.10:3000/play/` en la PC. Selecciona **Conectar móvil**
   y **Generar invitación**.
2. Escanea el QR desde el móvil o abre `/controller/` en ese mismo origen y
   pega el enlace. Comprueba que ambos dispositivos muestran el mismo código.
3. Aprueba en la PC y cierra el panel. Suelta los controles del móvil y elige
   **Jugar con móvil** cuando aparezca como listo.
4. Mira la carretera en la PC. En el teléfono puedes girar con el volante o las
   flechas y acelerar a la vez con otro dedo. Freno tiene prioridad. Al volver
   de una interrupción, suelta los controles y pulsa **Continuar** en la PC.

El mando funciona por táctil en LAN HTTP. **Activar inclinación** y mantener
la pantalla activa requieren HTTPS y soporte del navegador. Denegar el permiso
conserva el táctil. Los ajustes incluyen calibración, lateralidad, sensibilidad,
giro invertido, asistencia y vibración cuando el teléfono la ofrece.

En loopback la PC permite probar el enlace en otro navegador local. Para
mostrar un QR que el teléfono pueda abrir, entra en la PC por su IP LAN.
La invitación es de un solo uso. Caduca como máximo a los dos minutos.

## Worker y Durable Objects

```sh
pnpm dev:worker
```

Emulación en `http://127.0.0.1:8787`. `/health` verifica el Worker y `/_local/room-health` verifica SQLite únicamente en el entorno local. El build hace dry-run del entorno production, con diagnósticos y URLs públicas deshabilitados. No despliega recursos ni requiere cuenta o tarjeta para emular.

## Comprobaciones

```sh
pnpm check
pnpm check:worker
pnpm exec playwright install chromium
pnpm test:e2e
pnpm package:local
```

`check` ejecuta lint, formato, tipos, pruebas, build, presupuestos y licencias. El presupuesto sigue el grafo de imports estáticos/dinámicos y rechaza Three.js o módulos de PC dentro del mando. Las pruebas E2E usan Chromium; no certifican sensores o Safari/iPhone físicos.

`pnpm check:pr <rama-base>` limita el PR a 12 archivos y 800 líneas de código/configuración. El lockfile generado sigue contando como archivo, pero se identifica separado del presupuesto de código. La instalación configura un hook local de Conventional Commits sin sustituir hooks personalizados existentes.

CI usa permisos de lectura y acciones fijadas por SHA, y verifica título/commits,
tamaño del PR, build, paquete y navegador. No hay despliegue automático.
`main` requiere los checks `commits` y `quality`, squash y ausencia de force push.

## Herramientas y licencias

CodeGraph está habilitado sobre el código; el índice no se versiona. Blender MCP
produjo el coche y kit costero originales de F02, con fuentes editables, QA y LOD.
Los modelos y ambientes definitivos pertenecen a F06/F08.

El código usa MIT. Los avisos de dependencias runtime se generan con `pnpm check:licenses`; las licencias de assets se conservan por separado. IDE, cachés, secretos, builds, pruebas y planificación local están excluidos mediante `.gitignore`.

Repositorio remoto: [JhosepAC/qracer](https://github.com/JhosepAC/qracer). Desarrollo y operación previstos con herramientas gratuitas, cuotas explícitas y distribución local como alternativa.
