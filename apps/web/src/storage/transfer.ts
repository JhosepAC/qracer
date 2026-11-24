import { DataFault, fields, MAX_IMPORT, object, readData, type SaveData } from "./model.ts";
export function parseProgress(text: string): SaveData {
  if (text.length > MAX_IMPORT || new TextEncoder().encode(text).byteLength > MAX_IMPORT)
    throw new DataFault("corrupt");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DataFault("corrupt");
  }
  if (!object(value)) throw new DataFault("corrupt");
  if (typeof value.formatVersion === "number" && value.formatVersion > 1)
    throw new DataFault("future");
  fields(value, ["app", "formatVersion", "data"]);
  if (value.app !== "QRacer" || value.formatVersion !== 1 || !Object.hasOwn(value, "data"))
    throw new DataFault("corrupt");
  return readData(value.data);
}
export function exportProgress(data: SaveData) {
  return JSON.stringify({ app: "QRacer", formatVersion: 1, data: readData(data) }, null, 2);
}
