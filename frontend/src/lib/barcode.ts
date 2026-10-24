export const BARCODE_MAX_LENGTH = 500;
// Product QR codes can contain spaces, punctuation and non-English text.
// Control characters are not suitable for a catalogue identifier.
export const BARCODE_PATTERN = `[^\\x00-\\x1F\\x7F-\\x9F]{1,${BARCODE_MAX_LENGTH}}`;
// Unlike HTML patterns, JavaScript's $ also matches before a final newline.
const barcodeExpression = new RegExp(
  `^(?:${BARCODE_PATTERN})$(?![\\s\\S])`,
  "u",
);

export const validBarcode = (value: string) =>
  value.trim().length > 0 && barcodeExpression.test(value);

export class NoBarcodeFound extends Error {}

// ZXing-C++ reports UPC-E as an expanded EAN-13/GTIN. Restore the eight
// characters printed on a UPC-E label for manual-entry and scanner consistency.
function compactUpce(value: string) {
  const match = /^0([01])(\d{5})(\d{5})(\d)$/.exec(value);
  if (!match) return value;
  const [, system, manufacturer, product, check] = match;
  let digits: string;
  if (/[012]00$/.test(manufacturer) && product.startsWith("00"))
    digits = manufacturer.slice(0, 2) + product.slice(2) + manufacturer[2];
  else if (manufacturer.endsWith("00") && product.startsWith("000"))
    digits = manufacturer.slice(0, 3) + product.slice(3) + "3";
  else if (manufacturer.endsWith("0") && product.startsWith("0000"))
    digits = manufacturer.slice(0, 4) + product[4] + "4";
  else if (product.startsWith("0000") && product[4] >= "5")
    digits = manufacturer + product[4];
  else return value;
  return system + digits + check;
}

// Reuse the decoder across frames. Loading failures remain visible and can be retried.
async function createDecoder() {
  const [library, { default: wasmUrl }] = await Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  try {
    await library.prepareZXingModule({
      overrides: {
        // Bundle and serve the decoder with the app, without a CDN dependency.
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
let decoder: ReturnType<typeof createDecoder> | undefined;
export const scanAngles = [
  [0, 90],
  [0, 45, -45],
  [0, 22.5, -67.5],
  [0, -22.5, 67.5],
];

function rotateCanvas(canvas: HTMLCanvasElement, angle: number) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const source = document.createElement("canvas");
  source.width = Math.ceil(canvas.width * cos + canvas.height * sin);
  source.height = Math.ceil(canvas.width * sin + canvas.height * cos);
  const ctx = source.getContext("2d", { willReadFrequently: true })!;
  // Composite on white even at zero degrees, so transparent photos stay readable.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, source.width, source.height);
  ctx.translate(source.width / 2, source.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return source;
}

export async function decodeBarcode(
  canvas: HTMLCanvasElement,
  angles = [...new Set(scanAngles.flat())],
): Promise<string> {
  const { readBarcodes } = await (decoder ??= createDecoder().catch((error) => {
    decoder = undefined;
    throw error;
  }));
  for (const angle of angles) {
    const source = rotateCanvas(canvas, angle);
    const context = source.getContext("2d", { willReadFrequently: true })!;
    // Video colour conversion can make thin bars fail adaptive thresholding.
    // A fixed-threshold pass recovers high-contrast labels without changing data.
    for (const binarizer of ["LocalAverage", "FixedThreshold"] as const) {
      const results = await readBarcodes(
        context.getImageData(0, 0, source.width, source.height),
        {
          formats: ["AllReadable"],
          binarizer,
          tryHarder: true,
          tryRotate: true,
          tryInvert: true,
          maxNumberOfSymbols: 1,
          textMode: "Plain",
        },
      );
      const result = results.find((candidate) => candidate.isValid);
      if (result) {
        // Match the previous reader's product identifiers: UPC-A uses 12 digits,
        // and basic GS1 DataBar returns the GTIN without the implicit "01" AI.
        // Restrict this to those symbologies so QR/Code 128 zeroes stay untouched.
        if (result.format === "UPCE") return compactUpce(result.text);
        if (result.symbology === "EANUPC" && /^0\d{12}$/.test(result.text))
          return result.text.slice(1);
        if (result.symbology === "DataBar" && /^01\d{14}$/.test(result.text))
          return result.text.slice(2);
        return result.text;
      }
    }
  }
  throw new NoBarcodeFound(
    "No readable barcode found. Retake with the full barcode in focus, good lighting and no glare.",
  );
}
