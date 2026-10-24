let writer: Promise<typeof import("zxing-wasm/writer")> | undefined;
async function getWriter() {
  const [library, { default: wasmUrl }] = await Promise.all([
    import("zxing-wasm/writer"),
    import("zxing-wasm/writer/zxing_writer.wasm?url"),
  ]);
  try {
    await library.prepareZXingModule({
      overrides: {
        locateFile: (path, prefix) =>
          path.endsWith(".wasm") ? wasmUrl : prefix + path,
      },
      fireImmediately: true,
    });
  } catch (error) {
    library.purgeZXingModule();
    throw error;
  }
  return library;
}

export async function labelSymbol(value: string) {
  const library = await (writer ??= getWriter().catch((error) => {
    writer = undefined;
    throw error;
  }));
  // Long values and Unicode remain scannable as QR codes on small stickers.
  const format = /^[\x20-\x7e]{1,20}$/.test(value) ? "Code128" : "QRCode";
  const result = await library.writeBarcode(value, {
    format,
    scale: 3,
    addQuietZones: true,
  });
  if (result.error || !result.svg)
    throw new Error(result.error || "The label could not be generated.");
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`,
    format,
  };
}
