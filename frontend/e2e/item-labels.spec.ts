import { test, expect } from "@playwright/test";
import fs from "node:fs";

const credentials = JSON.parse(
  fs.readFileSync(
    new URL("../../backend/.review-credentials.json", import.meta.url),
    "utf8",
  ),
);

test("store barcode, individual serials, printable stickers and exact serial lookup", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Item catalogue" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Generate store barcode" }).click();
  await expect(dialog.getByLabel("Item barcode or QR value")).toHaveValue(
    /^SBM-P-\d{8,}$/,
  );
  await dialog.getByLabel("Item barcode or QR value").fill("");
  const name = `Label verification LCD ${Date.now()}`;
  await dialog.getByLabel("Item name", { exact: true }).fill(name);
  await dialog.getByLabel("Component category").selectOption({ index: 1 });
  await dialog.getByLabel("Track individual serial numbers").check();
  const creation = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/items") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Save item" }).click();
  const item = await (await creation).json();
  expect(item.barcode).toMatch(/^SBM-P-\d{8,}$/);
  expect(item.serial_tracking).toBe(true);
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Search catalogue").fill(item.sku);
  const row = page.getByRole("row").filter({ hasText: item.sku });
  await row.getByRole("button", { name: "Receive", exact: true }).click();
  const serial1 = `LCD-${Date.now()}-1`;
  const serial2 = `屏幕-${Date.now()}-2`;
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog.getByLabel("Source reference").fill(item.sku + "-LABEL-TEST");
  await dialog.getByLabel("Serial details").fill(`${serial1}\n${serial2}`);
  const receiving = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/movements") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Receive stock" }).click();
  const receipt = await (await receiving).json();
  await expect(dialog).not.toBeVisible();
  try {
    await row.getByRole("button", { name: "Labels & serials" }).click();
    await expect(dialog.locator(".barcode-sticker img")).toHaveCount(1);
    // Decode the actual rendered label image using the application's scanner.
    const decodePreview = (index = 0) =>
      page.evaluate(async (index) => {
        const image = document.querySelectorAll<HTMLImageElement>(
          ".barcode-sticker img",
        )[index]!;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        // @ts-expect-error Vite serves this browser module during the test.
        const { decodeBarcode } = await import("/src/lib/barcode.ts");
        return decodeBarcode(canvas);
      }, index);
    expect(await decodePreview()).toBe(item.barcode);
    await dialog.getByLabel("Number of stickers").fill("3");
    await expect(dialog.locator(".barcode-sticker img")).toHaveCount(3);
    await dialog.getByLabel("Label type").selectOption("units");
    await expect(dialog.getByText(serial1, { exact: true })).toBeVisible();
    await expect(dialog.getByText(serial2, { exact: true })).toBeVisible();
    await dialog.getByLabel(`Print ${serial1}`, { exact: true }).check();
    await expect(dialog.locator(".barcode-sticker img")).toHaveCount(1);
    expect(await decodePreview()).toBe(serial1);
    await dialog.getByLabel(`Print ${serial2}`, { exact: true }).check();
    await expect(dialog.locator(".barcode-sticker img")).toHaveCount(2);
    expect(await decodePreview(1)).toBe(serial2);
    // Replace the native print call to inspect its real document without printing.
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
    const opening = context.waitForEvent("page");
    await dialog.getByRole("button", { name: "Print 2 sticker(s)" }).click();
    const printPage = await opening;
    await expect(printPage.locator("body")).toHaveAttribute(
      "data-printed",
      "true",
    );
    await expect(printPage.locator(".barcode-sticker")).toHaveCount(2);
    await expect(printPage.locator(".barcode-sticker").first()).toContainText(
      item.barcode,
    );
    const css = await printPage.locator("style").textContent();
    expect(css).toContain("size: 50mm 30mm");
    await printPage.pdf({
      path: "/private/tmp/sbm-inventory-stickers.pdf",
      preferCSSPageSize: true,
      printBackground: true,
    });
    await printPage.close();
    await page.screenshot({
      path: "/private/tmp/sbm-inventory-labels-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      dialog.getByRole("button", { name: "Print 2 sticker(s)" }),
    ).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    await expect(
      dialog.getByRole("heading", { name: "Labels & serials" }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Print 2 sticker(s)" }),
    ).toBeInViewport();
    await page.screenshot({
      path: "/private/tmp/sbm-inventory-labels-mobile.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByLabel("Search catalogue").fill(serial1);
    await expect(row).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    // Keep the immutable verification history while restoring stock to zero.
    await page.evaluate(
      async ({ receiptId, item }) => {
        // @ts-expect-error Vite serves this browser module during the test.
        const { api } = await import("/src/api.ts");
        await api.post("/movements", {
          request_key: crypto.randomUUID(),
          kind: "reversal",
          movement_id: receiptId,
          reason: "Close sticker verification receipt",
        });
        await api.put(`/items/${item.id}`, {
          ...item,
          active: false,
          phone_model_ids: item.phone_models.map((p: { id: number }) => p.id),
        });
      },
      { receiptId: receipt.movements[0].id, item },
    );
  }
});
