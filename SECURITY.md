# Seguridad y operación sin coste

QRacer no tiene cuentas ni un ranking público certificado. La PC es autoridad de
la simulación. El aviso para jugadores está en `/privacy/`, también en el paquete
local y en la caché preparada para jugar sin conexión.

## Comunicar un problema

Contacta al mantenedor desde el repositorio. Para vulnerabilidades, usa un canal
privado disponible con el propietario; no publiques secretos, enlaces QR activos,
SDP/ICE, IP de jugadores o archivos privados en una issue. Si GitHub ofrece
reporte privado en la pestaña Security, puede usarse esa opción. No se afirma que
esté habilitada. Incluye versión/commit, ruta afectada y reproducción mínima con
credenciales sintéticas. Prueba únicamente entornos propios/locales.

## Controles vigentes

- IDs de 128 bits y capacidades independientes de 256 bits. El QR lleva solo la
  invitación en el fragmento, se limpia al abrir y requiere aprobación de PC.
- Invitación de hasta 120 s y un uso, autenticación en 5 s, gracia de reconexión
  de 30 s y sala de hasta dos horas. Revocar o sustituir mando invalida sus tokens.
- Orígenes HTTP/WS exactos; CORS no autentica. Roles, épocas, secuencias, tamaños,
  cuotas y contrapresión se validan en relay y PC. RTC falla hacia WSS con pausa.
- CSP estricta en documentos y excepción Basis confinada a `/decoder-worker.js`,
  sin red o workers anidados. Solo el mando recibe permisos de inclinación.
- Importación JSON de hasta 1 MiB con esquema cerrado y sin ejecución de código.
  Credenciales de mando solo en memoria/sessionStorage con vencimiento; no se
  incluyen en progreso, diagnóstico, caché de estáticos ni logs de aplicación.

## Ante un incidente

1. Pausa la carrera. En PC, **Revocar mando** elimina el controlador y la
   invitación; **Cerrar sala** termina la sesión. Genera una sala nueva si se
   filtró la credencial del anfitrión. No basta con ocultar el QR.
2. Para detener el servicio público, prepara `SESSION_DISABLED="true"` en las
   variables del entorno Worker afectado y despliega la configuración revisada.
   El router rechaza admisión/upgrades y el actor termina sesiones al procesar
   restauración, mensaje o alarma con ese código. No es una revocación instantánea
   de todos los procesos antiguos. Verifica cierre y pausa en el despliegue.
3. No abras nuevas sesiones hasta corregir y repetir las pruebas. Teclado y
   edición local siguen siendo alternativas. Nunca actives un plan Paid.
4. Rota solo las credenciales afectadas, revisa permisos y preserva evidencia
   mínima sin payloads/secretos. Una reversión no debe reactivar una clave robada.

## Secretos y rotación

Usa secretos de Wrangler, archivos locales ignorados y tokens de despliegue con
los permisos mínimos para los recursos utilizados. No copies valores a PR,
comandos con argumento, capturas, `VITE_*` o archivos del paquete. Los únicos
`VITE_*` revisados son `VITE_SESSION_RELAY` y `VITE_PROBE_RELAY`: orígenes públicos.

Desde el checkout, estos comandos solicitan el valor interactivamente; son
operaciones remotas, se ejecutan solo para una rotación deliberada:

```sh
pnpm --filter @qracer/relay-cloudflare exec wrangler secret put SESSION_KEY --env production
pnpm --filter @qracer/relay-cloudflare exec wrangler secret put PROBE_KEY --env probe
```

`SESSION_KEY` es un cierre opcional de creación para un operador que envíe
Authorization. El frontend normal no lleva esa clave: habilitarla bloquea su
creación pública. `PROBE_KEY` pertenece solo al laboratorio F02. Rotar una clave
de creación no revoca salas existentes: terminarlas o esperar su TTL verificado.
Revoca tokens de API Cloudflare en el proveedor y reemplaza las copias autorizadas;
no publiques ni muestres el token antiguo para compararlo. Repite salud, rechazo
sin credencial, vinculación válida y pausa antes de reabrir admisión.

## Capacidad Free y limpieza

Antes de publicar, verifica Workers **Free** en la cuenta y descuenta otras
cargas, incluido staging/probe. No cambies de plan, añadas tarjeta, TURN contratado
o créditos para ampliar capacidad. Cuotas de referencia: Workers 100.000
solicitudes/día; DO 100.000 unidades y 13.000 GB-s/día, con reinicio a 00:00 UTC.
Revalida en la [documentación de Cloudflare](https://developers.cloudflare.com/durable-objects/platform/pricing/).

El coordinador reserva 12.000 unidades y 125 GB-s por bloque de 15 min: cuatro
bloques/día dentro del presupuesto propio de 50.000 unidades/6.500 GB-s. Un bloque
que cruza UTC se carga en ambos días. No hay devolución por cierre temprano.
La aplicación rechaza nuevas salas o renovaciones agotadas y elimina el estado
de sala al cerrar/expirar. Plazas vencidas y agregados diarios se limpian por
alarma; los agregados duran menos de 48 h. No se escribe por frame.

El filtro por isolate de 12 creaciones y 96 upgrades/minuto es un complemento,
no un límite global. Las reservas no prueban consumo facturado ni impiden que
tráfico rechazado y otras cargas consuman cuota. Ante incertidumbre, cierra
admisión y utiliza el paquete local; no intentes agotar cuotas en producción.

La configuración deshabilita Workers Logs en todos sus entornos. Esto afecta
despliegues realizados con ella; no demuestra el estado de despliegues anteriores
ni elimina el procesamiento operativo propio del proveedor. CI conserva evidencia
siete días. Los diagnósticos se descargan voluntariamente y su conservación queda
bajo control del usuario. No habilites logging de headers, cuerpos, SDP/ICE,
sensores o URLs con secretos. Consulta las [políticas del proveedor](https://www.cloudflare.com/privacypolicy/).

## Verificación y mantenimiento

Antes de integrar: `pnpm check`, `pnpm check:worker`, `pnpm test:e2e` y
`pnpm package:local`. `pnpm check:secrets` detecta formatos comunes y valores
privados conocidos en distribuciones; no garantiza detectar cualquier secreto.
Revisa el diff, los orígenes y las dependencias además del escáner.

Cada mes: `pnpm audit`, `pnpm audit --prod`, revisión de avisos/licencias y
actualizaciones acotadas. Antes de una versión y trimestralmente: revalidar Free,
cuotas compartidas y navegadores; conservar lockfile, builds/checksums y dos
versiones recuperables. CI tiene acciones fijadas y permisos de lectura; no
despliega automáticamente. El mantenimiento requiere tiempo del mantenedor,
sin servicio o suscripción de pago obligatorios.
