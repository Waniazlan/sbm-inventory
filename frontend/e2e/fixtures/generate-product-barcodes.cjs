// Generated with bwip-js 4.11.4, independently of the application's ZXing decoder.
// Install bwip-js in a temporary directory, then pass its absolute module path:
// node generate-product-barcodes.cjs /private/tmp/barcode-tools/node_modules/bwip-js
const bwip = require(process.argv[2] || "bwip-js");
const fs = require("node:fs");
const path = require("node:path");
const cases = JSON.parse(
  fs.readFileSync(path.join(__dirname, "product-barcodes.json"), "utf8"),
).map(({ name, format, value }) => ({
  name,
  bcid: format,
  text: name === "databar" ? `(01)${value}` : value,
}));
cases.push({ name: "control-character", bcid: "code128", text: "ABC\t123" });

for (const { name, bcid, text } of cases) {
  const options = {
    bcid,
    text,
    scale: 3,
    padding: 12,
    includetext: false,
    backgroundcolor: "FFFFFF",
    // Code 93 requires its C and K checksum characters.
    includecheck: bcid === "code93",
  };
  if (!["qrcode", "datamatrix", "azteccode", "pdf417"].includes(bcid)) {
    options.height = 20;
  }
  let svg = bwip.toSVG(options);
  const [, width, height] = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  // Preserve the symbol's module sizes in an Image/canvas, including square 2D codes.
  svg = svg.replace("<svg ", `<svg width="${width}" height="${height}" `);
  fs.writeFileSync(path.join(__dirname, `product-${name}.svg`), svg);
}
