# QRacer

Juego arcade 3D para navegador de PC, controlado desde un teléfono mediante un código QR. El mando web funciona sin instalar una aplicación; gráficos, conexión y controles cuentan con alternativas según las capacidades del dispositivo.

**Estado:** tres ambientes (costa, desierto y ciudad nocturna) y cuatro modos
se pueden jugar con teclado o con un móvil vinculado. El mando incluye inclinación, volante táctil, botones y
pausa segura al perder la entrada. El laboratorio F02 de sensores, relay y
rendimiento sigue en validación.
Instrucciones del laboratorio en [PROBES.md](PROBES.md).

El menú costero ofrece tres perfiles gráficos. Para medir la carrera en tu
equipo después de compilar, ejecuta `node scripts/benchmark-race.mjs`. El
informe separa los intervalos de imagen, el tiempo del callback y las muestras
GPU que proporcione el navegador. Para medir el coste del fantasma con una
trayectoria sintética local: `node scripts/benchmark-race.mjs --ghost --profiles balanced --runs 1 --seconds 90`.
Esta opción usa contrarreloj y admite hasta 110 segundos por ejecución.

**Ajustar resolución para mantener fluidez** está activado por defecto. Respeta
el perfil elegido y sus límites; baja tras cinco segundos de sobrecarga y
recupera resolución tras veinte segundos con margen. Puedes desactivarlo en el menú.

Para medir perfiles fijos y auditar una sesión con veinte reinicios y veinte
reconstrucciones: `node scripts/benchmark-race.mjs --stability`. Son nueve recorridos
de cinco minutos y un chequeo adicional; usa reloj nativo, GPU identificada y GC
solo en pausa. No recompiles ni ejecutes otras pruebas gráficas durante el ensayo.
Añade `--adaptive` para medir el ajuste automático. Los snapshots de heap y los
informes quedan en `artifacts/race-benchmark/`. Comprueba los criterios con
`node scripts/check-race-report.mjs`; un incumplimiento devuelve código de salida 1.
Puedes añadir como segundo argumento otro `report.json` con la auditoría de reinicios;
el verificador exige que ambos informes identifiquen el mismo build y conserva su procedencia.

`node scripts/benchmark-client.mjs` mide arranque con red limitada y procesamiento
del mando en Chromium local; `--mode startup` o `--mode controller` los separa.
La ruta directa inyecta orientación y un permiso concedido para probar el filtro;
no certifica sensores físicos. `--seconds 1800 --route direct --mode controller`
audita treinta minutos con inclinación sintética. El renderer se sustituye solo
en este ensayo de transporte. Los resultados locales no certifican Wi-Fi ni Internet.

En **Datos locales → Guardar diagnóstico de rendimiento** puedes exportar los
gráficos y los histogramas de recepción, simulación y envío del frame. El mando
exporta RTT y coste local desde **Ajustes y diagnóstico**. Son descargas voluntarias,
sin credenciales ni entradas crudas; el envío del frame no mide la latencia física
hasta la pantalla.

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
**Espacio** (o **Shift**) para activar nitro y **Esc** para pausar. La carrera comienza con
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
Las rutas `/session` y `/session/ws/…` gestionan la vinculación y reconexión del juego.

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

En un origen HTTPS de confianza, elige **Activar inclinación** en el mando y
sostén el teléfono quieto hasta que termine de centrarse. Inclínalo para girar y
usa los pedales en pantalla. Puedes volver al táctil desde el mismo mando. En
LAN HTTP, el volante y las flechas están listos desde la vinculación.
En **Ajustes y diagnóstico** puedes regular la sensibilidad, invertir el giro
y cambiar el lado de los pedales o activar la asistencia. La vibración y la
pantalla activa dependen del navegador.

En loopback la PC permite probar el enlace en otro navegador local. Para
mostrar un QR que el teléfono pueda abrir, entra en la PC por su IP LAN.
La invitación es de un solo uso. Caduca como máximo a los dos minutos.

## Modos, ambientes y pinturas

En el menú puedes elegir **Infinito**, **Práctica**, **Contrarreloj** o
**Desafío diario**, además del ambiente inicial y una semilla. Contrarreloj y
diario duran hasta 120 segundos de simulación; pausar detiene el reloj. El
diario deriva su semilla de la fecha UTC y las versiones de reglas/generador;
es recreativo y no usa una clasificación global.

Práctica mantiene la integridad y permite **Terminar práctica**. No concede
récords ni pinturas. Los otros modos permiten completar objetivos y desbloquear
seis pinturas con idénticas prestaciones. Progreso, medallas y récords actuales
se guardan en este navegador cuando el almacenamiento está disponible.
Contrarreloj y diario pueden mostrar el fantasma de tu mejor recorrido compatible.

Las categorías de récord separan modo, semilla, versiones, configuración y
ayudas. Los entornos cambian durante el recorrido y se descargan por adelantado.
Los intermitentes ámbar anuncian las maniobras del tráfico. En resultados puedes
**Guardar resumen de carrera** con tiempos, maniobras, impactos y reglas, para
compartir voluntariamente observaciones sin historial de sensores o credenciales. Si falta un entorno,
la partida pausa antes de continuar y permite volver al menú para reintentar.

## Sonido, comodidad e idiomas

**Sonido y comodidad** permite silenciar antes de jugar y ajustar volumen general,
música original y motor/efectos por separado. El audio solo se activa con una
acción de juego y se suspende al pausar. No descarga música de terceros.

Puedes activar cámara estable, reducir movimiento y flashes, usar asistencia y
reasignar letras/flechas/espacio en **Teclado**. La preferencia del sistema de
movimiento reducido también se respeta. Las ayudas separan las categorías de récord.
Los menús y ajustes se recorren con Tab, Enter y Escape; no se afirma accesibilidad
total de la conducción para lectores de pantalla.

En el móvil, **Modo de una mano (ayuda)** acelera suavemente durante la carrera;
el freno tiene prioridad y las interrupciones conservan la pausa segura. Vibración
y flashes se pueden desactivar. Inclinación, táctil y teclado siguen disponibles
según las capacidades del dispositivo.

El selector **Idioma / Language** cambia entre español e inglés sin recargar ni
perder la vinculación. Preferencias de presentación y mando se guardan localmente
cuando el navegador lo permite; los resultados y récords se guardan en la PC.

## Progreso, tarjetas y juego sin conexión

**Datos locales** permite revisar récords y últimas partidas, exportar/importar
progreso JSON (máximo 1 MiB), borrar progreso/fantasmas y restablecer ajustes.
Reemplazos y borrados piden confirmación. PC y mando conservan sus ajustes por
separado. El modo privado, la limpieza o la evicción del navegador pueden borrar
los datos: exporta una copia para conservarlos. No hay cuentas ni sincronización cloud.

El fantasma es una trayectoria visual a 20 Hz sin colisiones, separada por modo,
semilla, reglas, generador, configuración y ayudas. Se guardan hasta diez mejores
recorridos compatibles; puede ocultarse en el menú. El JSON de progreso no incluye
los binarios de fantasma. En resultados, **Descargar tarjeta PNG** crea una imagen
local; **Compartir tarjeta** aparece cuando el navegador permite compartir archivos.

En una compilación servida con HTTPS de confianza o en `localhost`/`127.0.0.1`,
**Jugar sin conexión** indica cuándo la costa está descargada para jugar con teclado.
**Descargar todos los entornos** prepara desierto y ciudad. Espera la confirmación
antes de desconectar la red; el contenido faltante se indica y puede reintentarse.
El servidor Vite de desarrollo no genera esta caché: usa `pnpm build` y el relay
local, el paquete compilado o un alojamiento HTTPS. La ruta HTTP por IP LAN permite
jugar con red y táctil, pero no habilita caché offline ni sensores seguros.

**Aplicar actualización** aparece en el menú cuando hay una versión preparada.
Todas las pestañas de PC deben volver al menú o cerrarse; una carrera pausada
sigue bloqueando la actualización. **Borrar descargas** conserva progreso y ajustes
y desactiva la caché hasta prepararla de nuevo. Las sesiones, credenciales y WSS
no se cachean. Vincular un teléfono sin Internet requiere relay local y LAN disponibles.

## Transporte directo y recuperación

Tras vincular, QRacer prueba WebRTC durante cinco segundos sin servidores
STUN/TURN. Si hay una ruta saludable, las entradas pasan por un canal sin
retransmisiones y las acciones por otro confiable. La sesión conserva su
WebSocket autenticado. El mando y la PC indican **Directo RTC** o **Relay**.

Si falla RTC, la carrera pausa y recupera el relay. Suelta los controles y
pulsa **Continuar** en la PC para iniciar la cuenta atrás. Un cambio de red
puede requerir reconexión; no reanuda la carrera automáticamente. En
**Ajustes y diagnóstico → Guardar diagnóstico** puedes exportar RTT,
contadores por transporte y recuperaciones, sin credenciales ni señalización.

PC, mando y relay requieren la misma versión de protocolo (**3**).
La ruta LAN HTTP sigue limitada a una red de confianza; los sensores
requieren HTTPS confiable.

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
