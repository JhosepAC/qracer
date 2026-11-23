# F02 — Laboratorio de viabilidad

Estas rutas prueban el enlace y la carga gráfica. La conducción, aprobación de
mandos, reconexión y arte final del producto se completan en fases posteriores.

## Prueba local

```sh
pnpm build
pnpm dev:local
```

Abrir `/probe/` en la PC. Para un teléfono real, configurar `QRACER_HOST=0.0.0.0`
y añadir el origen LAN exacto a `QRACER_ALLOWED_ORIGINS` en la configuración
ignorada del relay. Abrir también la PC usando esa dirección LAN, por ejemplo
`http://192.168.1.10:3000/probe/`; el QR conserva ese origen y no apunta a localhost.
No desactivar firewall ni abrir puertos del router. HTTP LAN es una opción para
táctil en una red confiable; los sensores requieren HTTPS de confianza.

La creación sin clave se limita a peticiones de la propia PC, con Origin permitido.
`QRACER_PROBE_KEY` permite exigir una capacidad de 64 caracteres hexadecimales,
también para la PC local. No exponer el relay LAN como un servidor público.

## Prueba pública Free

El entorno `probe` del Worker usa SQLite y WebSockets con hibernación. Configurar
la allowlist exacta del frontend y guardar `PROBE_KEY` con `wrangler secret put`.
Confirmar que la cuenta sigue en Workers Free antes de desplegar; conservar
servicios USD 0. No configurar TURN, generadores premium ni un plan Paid.

El frontend es estático en Pages. El build incluye licencias y no publica `docs/`.
Desplegar únicamente un commit comprobado de `main`, de forma manual. Usar
`wrangler pages deploy apps/web/dist --project-name <proyecto> --branch main`
desde la raíz. Dar de alta el proyecto Pages mediante su API/panel específico:
en la versión de CLI comprobada, `pages project create` redirigió a un Worker.

En `/probe/`, introducir el origen del relay y su clave de experimento. La clave
del anfitrión y el token del mando son distintos. El QR lleva solo el token del
mando en el fragmento; el móvil lo borra del historial antes de autenticar.
No poner capacidades en `VITE_*`, query strings, logs o documentación pública.

Límites del experimento: ocho sesiones públicas/día y ocho reservas simultáneas,
20 minutos por sesión, invitación de un uso y 120 segundos, cuatro sockets/sala,
autenticación en cinco segundos, mensajes de 16 KiB y 45 mensajes/s por socket.
La negociación completa tiene un límite de 64 KiB por participante. Estos límites
no representan capacidad masiva validada ni sustituyen cuotas de cuenta.

Los controles usan WSS incluso cuando ICE conecta. RTC solo mide conectividad y
RTT, con `iceServers: []`, sin STUN/TURN. Si falla en cinco segundos, WSS continúa.
Al cerrar una sesión, crear otro enlace. La recuperación final pertenece a F04/F07.

## Benchmark reproducible

```sh
pnpm build
pnpm exec playwright install chromium
pnpm benchmark:probe
```

Ejecuta tres muestras de cinco minutos por perfil, excluyendo los primeros
30 segundos. Solo una escena está activa; evitar otras pruebas 3D simultáneas.
Registra resolución interna, GPU real/software, navegador, hashes, frame/CPU/GPU,
draw calls/triángulos de todas las pasadas y memoria observable. Los informes y
capturas van a `artifacts/probe-benchmark`. El perfil bajo sobre una RTX no prueba
compatibilidad con una UHD 620. Headless tampoco sustituye una prueba de pantalla.

Opciones: `--profiles balanced`, `--runs 1`, `--seconds 300`, `--output <carpeta>`.
En Windows se usa ANGLE D3D11; `--angle` permite elegir otra implementación.
Los resultados con render por software requieren `--allow-software` explícito y
siguen identificados como tales. Una duración menor de cinco minutos es un smoke.

## Soak WSS reproducible

```sh
pnpm soak:probe --relay https://<relay> --origin https://<frontend> --key-file <archivo-ignorado>
```

El archivo contiene `PROBE_KEY=<64 caracteres hexadecimales>`; también se admite
`QRACER_PROBE_KEY` como variable de entorno. No pasar la clave como argumento.
La prueba usa dos clientes Node, 15 minutos de entradas a 30 Hz, dos minutos
inactivos y un frame de recuperación. No sustituye Android/iPhone físicos.
Guarda agregados sin tokens, salas, SDP, IP candidatas ni series de sensores en
`artifacts/probe-soak`. Los contadores de aplicación no son GB-s facturados.

Para aceptación física: registrar dispositivo/navegador/red, QR, soltar/cancelar,
bloqueo, permisos, calibración/rotación y vibración. Exportar mediciones desde PC
y móvil; declarar explícitamente las combinaciones que no pudieron comprobarse.
