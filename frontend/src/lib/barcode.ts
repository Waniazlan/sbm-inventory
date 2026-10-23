export const BARCODE_MAX_LENGTH = 100;
export const BARCODE_PATTERN = `[A-Za-z0-9]{1,${BARCODE_MAX_LENGTH}}`;
// Unlike HTML patterns, JavaScript's $ also matches before a final newline.
const barcodeExpression = new RegExp(`^(?:${BARCODE_PATTERN})$(?![\\s\\S])`);

export const validBarcode = (value: string) => barcodeExpression.test(value);

export class NoBarcodeFound extends Error {}

// Reuse the decoder across frames. Loading failures remain visible and can be retried.
async function createDecoder() {
  const [{ BrowserMultiFormatOneDReader }, library] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  return {
    reader: new BrowserMultiFormatOneDReader(
      new Map<import("@zxing/library").DecodeHintType, unknown>([
        [library.DecodeHintType.TRY_HARDER, true],
        [
          library.DecodeHintType.POSSIBLE_FORMATS,
          [
            library.BarcodeFormat.CODE_128,
            library.BarcodeFormat.CODE_39,
            library.BarcodeFormat.CODE_93,
            library.BarcodeFormat.EAN_13,
            library.BarcodeFormat.EAN_8,
            library.BarcodeFormat.UPC_A,
            library.BarcodeFormat.UPC_E,
            library.BarcodeFormat.ITF,
            library.BarcodeFormat.CODABAR,
            library.BarcodeFormat.RSS_14,
          ],
        ],
      ]),
    ),
    library,
  };
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
  const { reader, library } = await (decoder ??= createDecoder().catch(
    (error) => {
      decoder = undefined;
      throw error;
    },
  ));
  for (const angle of angles) {
    try {
      return reader.decodeFromCanvas(rotateCanvas(canvas, angle)).getText();
    } catch (error) {
      if (
        !(error instanceof library.NotFoundException) &&
        !(error instanceof library.ChecksumException) &&
        !(error instanceof library.FormatException)
      )
        throw error;
    }
  }
  throw new NoBarcodeFound(
    "No readable barcode found. Retake with the full barcode in focus, good lighting and no glare.",
  );
}
