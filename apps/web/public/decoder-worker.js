// Classic worker bootstrap. Only a same-origin Blob created by the application may supply code.
self.onmessage = ({ data }) => {
  self.onmessage = null;
  let source;
  try {
    if (data?.type !== "load-decoder" || typeof data.source !== "string") throw new Error();
    source = new URL(data.source);
    if (source.protocol !== "blob:" || source.origin !== self.location.origin) throw new Error();
  } catch {
    self.close();
    throw new Error("Invalid decoder bootstrap");
  }
  importScripts(source.href);
};
