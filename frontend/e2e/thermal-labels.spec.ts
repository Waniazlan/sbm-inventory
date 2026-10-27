import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Screenshots reproduce the printer's 203 DPI output, rather than testing
// only the higher quality source SVG. All inventory responses are isolated.
test.use({ deviceScaleFactor: 203 / 96 });

async function openLabels(
  page: Page,
  barcode: string,
  serial?: string,
  brand: string | null = null,
) {
  const item = {
    id: 1,
    sku: "PRN-000001",
    barcode,
    name: "Replacement LCD screen",
    brand: "Legacy product brand",
    category_id: 1,
    category: { id: 1, name: "LCD" },
    supplier: null,
    phone_models: [],
    unit: "piece",
    cost: 1200,
    price: 2500,
    stock: 1,
    minimum_stock: 0,
    active: true,
    serial_tracking: !!serial,
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") return route.abort();
    const body = path.endsWith("/auth/me")
      ? { id: 1, name: "Label admin", role: "admin", active: true }
      : path.endsWith("/metadata")
        ? { categories: [item.category], suppliers: [], phone_models: [] }
        : path.endsWith("/items/1/units")
          ? {
              data: serial
                ? [{ id: 1, serial_number: serial, in_stock: true, brand }]
                : [],
              total: serial ? 1 : 0,
              current_page: 1,
              last_page: 1,
            }
          : path.endsWith("/items")
            ? { data: [item], total: 1, current_page: 1, last_page: 1 }
            : null;
    if (!body) return route.abort();
    await route.fulfill({ json: body });
  });
  await page.goto("/catalogue");
  await page.getByRole("button", { name: "Labels & serials" }).click();
  await page.evaluate(() => {
    const open = window.open.bind(window);
    window.open = (...args) => {
      const popup = open(...args);
      if (popup)
        popup.print = () => {
          popup.document.body.dataset.printed = "true";
        };
      return popup;
    };
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Label type")).toHaveValue(
    serial ? "units" : "product",
  );
  return dialog;
}

async function printLabels(page: Page, context: BrowserContext, count: number) {
  await expect(page.locator('.barcode-sticker[data-ready="true"]')).toHaveCount(
    count,
  );
  const opening = context.waitForEvent("page");
  await page.getByRole("button", { name: `Print ${count} sticker(s)` }).click();
  const popup = await opening;
  await expect(popup.locator("body")).toHaveAttribute("data-printed", "true");
  await popup.emulateMedia({ media: "print" });
  await expect(popup.locator(".print-controls")).toBeHidden();
  return popup;
}

async function decodePrintedLabel(page: Page, popup: Page) {
  const sticker = popup.locator(".barcode-sticker").first();
  const clipped = await sticker.evaluate((element) =>
    Array.from(element.children).some((child) => {
      const rect = child.getBoundingClientRect();
      const label = element.getBoundingClientRect();
      return (
        rect.left < label.left ||
        rect.right > label.right ||
        rect.top < label.top ||
        rect.bottom > label.bottom
      );
    }),
  );
  expect(clipped).toBe(false);
  const pixels = await sticker.screenshot({ scale: "device" });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    // @ts-expect-error Vite serves this browser module during the test.
    const { decodeBarcode } = await import("/src/lib/barcode.ts");
    return decodeBarcode(canvas);
  }, pixels.toString("base64"));
}

async function expectPdfSize(
  popup: Page,
  widthMm: number,
  heightMm: number,
  pages: number,
) {
  const pdf = await popup.pdf({ preferCSSPageSize: true });
  const content = pdf.toString("latin1");
  expect(content.match(/\/Type\s*\/Page\b/g)).toHaveLength(pages);
  const boxes = [
    ...content.matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g),
  ];
  expect(boxes).toHaveLength(pages);
  for (const box of boxes) {
    expect(Math.abs(Number(box[1]) - (widthMm * 72) / 25.4)).toBeLessThan(1);
    expect(Math.abs(Number(box[2]) - (heightMm * 72) / 25.4)).toBeLessThan(1);
  }
}

test("XP-460B defaults to 50 × 30 mm with a compact readable QR beside the text", async ({
  page,
  context,
}) => {
  const barcode = "SUPPLIER-ABCDEF12345";
  const dialog = await openLabels(page, barcode);
  await expect(dialog.getByLabel("Sticker size")).toHaveValue("50x30");
  await dialog.getByLabel("Number of stickers").fill("3");
  const popup = await printLabels(page, context, 3);
  await expect(popup.locator(".qr-label")).toHaveCount(3);
  await expect(popup.locator(".label-brand")).toHaveCount(0);
  const qr = await popup.locator(".qr-label").first().boundingBox();
  // Keep the QR scannable while leaving more width for the serial text.
  expect((qr!.width * 25.4) / 96).toBeGreaterThanOrEqual(20);
  expect((qr!.width * 25.4) / 96).toBeLessThanOrEqual(22);
  expect(qr!.height).toBeCloseTo(qr!.width, 1);
  await popup
    .locator(".barcode-sticker")
    .first()
    .screenshot({
      path: test.info().outputPath("50x30-label.png"),
      scale: "device",
    });
  await expectPdfSize(popup, 50, 30, 3);
  expect(await decodePrintedLabel(page, popup)).toBe(barcode);
  await popup.close();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await expect(
    dialog.getByRole("button", { name: "Print 3 sticker(s)" }),
  ).toBeInViewport();
});

test("Unicode product codes print as readable QR on 76 × 130 mm stock", async ({
  page,
  context,
}) => {
  const barcode = "配件-屏幕 (原装) / " + "LCD OP A15/A15S/A16K ".repeat(8);
  const dialog = await openLabels(page, barcode);
  await dialog.getByLabel("Sticker size").selectOption("76x130");
  const popup = await printLabels(page, context, 1);
  await expect(popup.locator(".qr-label")).toHaveCount(1);
  await expectPdfSize(popup, 76, 130, 1);
  expect(await decodePrintedLabel(page, popup)).toBe(barcode);
});

test("small stock uses QR when a linear barcode would print too thin", async ({
  page,
  context,
}) => {
  const barcode = "SUPPLIER-ABCDEF12345";
  const dialog = await openLabels(page, barcode);
  await dialog.getByLabel("Sticker size").selectOption("76x130");
  await expect(dialog.locator('img[alt^="Code128:"]')).toHaveCount(1);
  await dialog.getByLabel("Sticker size").selectOption("50x30");
  const popup = await printLabels(page, context, 1);
  await expect(popup.locator(".qr-label")).toHaveCount(1);
  await expectPdfSize(popup, 50, 30, 1);
  expect(await decodePrintedLabel(page, popup)).toBe(barcode);
});

test("individual serials remain readable on 30 × 30 mm stock", async ({
  page,
  context,
}) => {
  const serial = "屏幕-1234567890123-2";
  const dialog = await openLabels(page, "SBM-P-00000001", serial);
  await dialog.getByLabel("Sticker size").selectOption("30x30");
  await dialog.getByLabel("Label type").selectOption("units");
  await dialog.getByLabel(`Print ${serial}`, { exact: true }).check();
  const popup = await printLabels(page, context, 1);
  await expect(popup.locator(".label-product-code")).toHaveText(
    "Product: SBM-P-00000001",
  );
  await expect(popup.locator(".label-brand")).toHaveCount(0);
  await expectPdfSize(popup, 30, 30, 1);
  expect(await decodePrintedLabel(page, popup)).toBe(serial);
});

for (const size of ["50x30", "30x30"]) {
  test(`serial brand prints below the product name on ${size} stock`, async ({
    page,
    context,
  }) => {
    const serial = "SN-0000000001-12050-99";
    const dialog = await openLabels(
      page,
      "SBM-P-00000001",
      serial,
      "Original LCD",
    );
    await dialog.getByLabel("Sticker size").selectOption(size);
    await dialog.getByLabel("Label type").selectOption("units");
    await dialog.getByLabel(`Print ${serial}`, { exact: true }).check();
    await expect(dialog.locator("strong + .label-brand")).toHaveText(
      "Original LCD",
    );
    const popup = await printLabels(page, context, 1);
    if (size === "50x30") {
      for (const document of [dialog, popup]) {
        const value = document.locator(".label-value");
        await expect(value).toHaveText(`S/N: ${serial}`);
        const bounds = await value.evaluate((element) => ({
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }));
        expect(bounds.scrollHeight, JSON.stringify(bounds)).toBeLessThanOrEqual(
          bounds.clientHeight,
        );
        expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
      }
    }
    await expect(popup.locator("strong + .label-brand")).toHaveText(
      "Original LCD",
    );
    const nameBox = await popup
      .locator(".barcode-sticker strong")
      .boundingBox();
    const brandBox = await popup.locator(".label-brand").boundingBox();
    expect(brandBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
    const [width, height] = size.split("x").map(Number);
    await expectPdfSize(popup, width, height, 1);
    expect(await decodePrintedLabel(page, popup)).toBe(serial);
    await popup
      .locator(".barcode-sticker")
      .screenshot({
        path: test.info().outputPath("serial-brand.png"),
        scale: "device",
      });
  });
}

test("short identifiers keep a readable linear barcode on 30 × 30 mm stock", async ({
  page,
  context,
}) => {
  const barcode = "123456";
  const dialog = await openLabels(page, barcode);
  await dialog.getByLabel("Sticker size").selectOption("30x30");
  const popup = await printLabels(page, context, 1);
  await expect(popup.locator('img[alt^="Code128:"]')).toHaveCount(1);
  await expectPdfSize(popup, 30, 30, 1);
  expect(await decodePrintedLabel(page, popup)).toBe(barcode);
});

test("custom stock uses the measured width and feed length without rotation", async ({
  page,
  context,
}) => {
  const barcode = "SBM-P-00000001";
  const dialog = await openLabels(page, barcode);
  await dialog.getByLabel("Sticker size").selectOption("custom");
  await dialog.getByLabel("Width across roll (mm)").fill("");
  await expect(
    dialog.getByRole("button", { name: "Print 1 sticker(s)" }),
  ).toBeDisabled();
  await dialog.getByLabel("Width across roll (mm)").fill("50.5");
  await dialog.getByLabel("Length along feed (mm)").fill("30.5");
  const popup = await printLabels(page, context, 1);
  await expect(popup.locator(".print-controls")).toContainText(
    "50.5 mm across the roll × 30.5 mm along the feed",
  );
  await expect(popup.locator(".print-controls")).toContainText("rotation 0°");
  await expectPdfSize(popup, 50.5, 30.5, 1);
  expect(await decodePrintedLabel(page, popup)).toBe(barcode);
});
