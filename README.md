# QRacer

Juego arcade 3D para navegador de PC, controlado desde un teléfono mediante un código QR. El mando web funciona sin instalar una aplicación; gráficos, conexión y controles cuentan con alternativas según las capacidades del dispositivo.

**Estado:** implementación de F01, base del entorno y aplicaciones independientes. Las mecánicas de conducción y vinculación se desarrollarán en fases posteriores.

- [Instrucciones para agentes](AGENTS.md)

La planificación en `docs/` se mantiene local y está excluida del repositorio por decisión del propietario. Las reglas públicas de contribución están en [CONTRIBUTING.md](CONTRIBUTING.md).

## Preparación

Requiere **Node 24.21.0** y **pnpm 12.14.0**. Si falta pnpm, puede instalarse con `npm install --global pnpm@12.14.0`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abrir [PC](http://127.0.0.1:5173/play/) o [mando](http://127.0.0.1:5173/controller/).
Son aplicaciones independientes: el renderer se carga únicamente en PC. El coche es una vista previa provisional; vinculación QR, sensores y conducción aún no están implementados.

## Relay y distribución local

```sh
pnpm build
pnpm dev:local
```

Abrir `http://127.0.0.1:3000/play/`. El relay sirve las aplicaciones compiladas, `/health` y un WebSocket de bootstrap en `/ws`. El socket requiere un origen permitido y `HELLO` antes de `PING`; todavía no crea salas ni autoriza control de juego.

Para cambiar host, puerto y orígenes, copiar `apps/relay-local/.env.example` a `.env` dentro de esa aplicación. LAN requiere configurar host/orígenes explícitamente y permitir solo el puerto necesario; no desactivar firewall ni abrir puertos del router. Los sensores requieren HTTPS de confianza.

```sh
pnpm package:local
```

Genera `artifacts/qracer-local-0.1.0.tar.gz`, checksum SHA-256 y avisos completos de licencias. Extraer y ejecutar `node start.mjs`; no necesita pnpm, `node_modules`, Blender ni CodeGraph. El comando también prueba el paquete fuera del checkout. Se requiere `tar`, disponible en Windows moderno y Linux/macOS.

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

CI usa permisos de lectura y acciones fijadas por SHA, y verifica título/commits, tamaño del PR, build, paquete y navegador. No hay despliegue automático. Integrar los PR de F01 en su orden de dependencia; verificar los checks obligatorios de `main` cuando el workflow esté integrado.

## Herramientas y licencias

CodeGraph está habilitado localmente sobre el código; el índice no se versiona. Blender MCP se verificó leyendo la escena existente mediante el servidor ya configurado, sin modificarla; los modelos definitivos pertenecen a F06/F08.

El código usa MIT. Los avisos de dependencias runtime se generan con `pnpm check:licenses`; las licencias de assets se conservan por separado. IDE, cachés, secretos, builds, pruebas y planificación local están excluidos mediante `.gitignore`.

Repositorio remoto: [JhosepAC/qracer](https://github.com/JhosepAC/qracer). Desarrollo y operación previstos con herramientas gratuitas, cuotas explícitas y distribución local como alternativa.
