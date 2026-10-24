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

export const LABEL_DPI = 203;
const dotsPerMm = LABEL_DPI / 25.4;

export type LabelSymbol = {
  src: string;
  format: "Code128" | "QRCode";
  widthMm: number;
  heightMm: number;
};

export async function labelSymbol(
  value: string,
  area: { widthMm: number; heightMm: number },
): Promise<LabelSymbol> {
  const library = await (writer ??= getWriter().catch((error) => {
    writer = undefined;
    throw error;
  }));
  // Keep every module at least two whole printer dots wide, including on
  // smaller stock. Use QR when a linear barcode would need to be squeezed.
  const formats: LabelSymbol["format"][] = /^[\x20-\x7e]{1,20}$/.test(value)
    ? ["Code128", "QRCode"]
    : ["QRCode"];
  const availableWidth = Math.floor(area.widthMm * dotsPerMm);
  const availableHeight = Math.floor(area.heightMm * dotsPerMm);
  for (const format of formats) {
    const result = await library.writeBarcode(value, {
      format,
      scale: 1,
      addQuietZones: true,
    });
    if (result.error || !result.svg)
      throw new Error(result.error || "The label could not be generated.");
    const svg = new DOMParser().parseFromString(
      result.svg,
      "image/svg+xml",
    ).documentElement;
    // SVG dimensions include the encoder's quiet zones; symbol.width does not.
    const width = Number(svg.getAttribute("width"));
    const height = Number(svg.getAttribute("height"));
    const moduleDots = Math.floor(
      format === "QRCode"
        ? Math.min(availableWidth / width, availableHeight / height)
        : availableWidth / width,
    );
    if (moduleDots < 2 || availableHeight < 1) continue;
    const widthDots = width * moduleDots;
    const heightDots =
      format === "QRCode" ? height * moduleDots : availableHeight;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(widthDots));
    svg.setAttribute("height", String(heightDots));
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("shape-rendering", "crispEdges");
    return {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`,
      format,
      widthMm: widthDots / dotsPerMm,
      heightMm: heightDots / dotsPerMm,
    };
  }
  throw new Error("This code needs a larger sticker size to print clearly.");
}
