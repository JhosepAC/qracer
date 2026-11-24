export const dataEnglish: Readonly<Record<string, string>> = {
  "Restablecer ajustes del mando": "Reset controller preferences",
  "Se restaurarán dirección, ayudas y vibración. La carrera permanecerá en pausa.":
    "Steering, assistance and vibration will be reset. The race will stay paused.",
  "Datos locales": "Local data",
  "Los datos pertenecen a este navegador. El modo privado o borrar sus datos puede eliminarlos. Exporta una copia para conservarlos.":
    "Data belongs to this browser. Private mode or clearing browser data can remove it. Export a copy to keep it.",
  "Exportar progreso": "Export progress",
  "Importar progreso (JSON, máximo 1 MiB)": "Import progress (JSON, up to 1 MiB)",
  "Exportar copia de recuperación": "Export recovery copy",
  "Récords locales": "Local records",
  "Últimas partidas": "Recent runs",
  "Borrar progreso y fantasmas": "Delete progress and ghosts",
  "Restablecer ajustes de PC": "Reset PC preferences",
  "Cerrar datos": "Close data",
  Cancelar: "Cancel",
  Confirmar: "Confirm",
  "Reemplazar progreso": "Replace progress",
  "Estos datos necesitan una versión más reciente. Se conservan los originales.":
    "This data needs a newer version. The originals are preserved.",
  "No se pudo completar la operación. Revisa el almacenamiento del navegador.":
    "Could not complete the operation. Check browser storage.",
  "Copia de progreso descargada.": "Progress copy downloaded.",
  "No hay copia de recuperación disponible.": "No recovery copy is available.",
  "Copia de recuperación descargada. Consérvala para una versión compatible.":
    "Recovery copy downloaded. Keep it for a compatible version.",
  "Progreso importado.": "Progress imported.",
  "Progreso importado en memoria. El navegador no permite guardarlo.":
    "Progress imported in memory. The browser cannot save it.",
  "Archivo inválido o mayor de 1 MiB. Se conserva el progreso actual.":
    "Invalid file or over 1 MiB. Current progress is preserved.",
  "Se borrarán récords, objetivos, partidas y fantasmas de este navegador. Exporta antes una copia si quieres conservarlos.":
    "Records, objectives, runs and ghosts will be deleted from this browser. Export a copy first if you want to keep them.",
  "Progreso borrado.": "Progress deleted.",
  "Se restaurarán gráficos, sonido, comodidad y teclas. Conservarás tu progreso.":
    "Graphics, sound, comfort and keys will be reset. Your progress will be kept.",
};
export const dataPatterns: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Récords: (\d+)$/, (m) => `Records: ${m[1]}`],
  [/^Partidas: (\d+)$/, (m) => `Runs: ${m[1]}`],
  [
    /^Récords: (\d+) → (\d+)\. Distancia: (\d+) → (\d+) m\. Se eliminarán los fantasmas anteriores\.$/,
    (m) =>
      `Records: ${m[1]} → ${m[2]}. Distance: ${m[3]} → ${m[4]} m. Previous ghosts will be deleted.`,
  ],
];
