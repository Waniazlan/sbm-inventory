import { expect, test } from "@playwright/test";
import fs from "node:fs";

test("live supplier return page and popup load without changing stock", async ({
  page,
}, testInfo) => {
  const credentials = JSON.parse(
    fs.readFileSync(
      new URL("../../backend/.review-credentials.json", import.meta.url),
      "utf8",
    ),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  const listResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/supplier-returns") &&
      response.request().method() === "GET",
  );
  await page
    .getByRole("link", { name: "Supplier returns", exact: true })
    .click();
  const response = await listResponse;
  expect(response.status()).toBe(200);
  const records = await response.json();
  const processing = records.data.find(
    (entry: { status: string }) => entry.status === "process",
  );
  if (processing) {
    const headers = {
      Accept: "application/json",
      Origin: new URL(page.url()).origin,
      Referer: page.url(),
    };
    const detail = await page.request.get(
      `/api/v1/items/${processing.item.id}`,
      { headers },
    );
    expect(detail.status()).toBe(200);
    const item = await detail.json();
    expect(item.frozen_stock).toBeGreaterThanOrEqual(processing.quantity);
    expect(item.available_stock).toBe(item.stock - item.frozen_stock);
    if (processing.serials) {
      const frozenLookup = await page.request.get(
        "/api/v1/supplier-returns/lookup",
        { headers, params: { barcode: processing.serials.split(/\r?\n/)[0] } },
      );
      expect(frozenLookup.status()).toBe(422);
    }
  }
  await expect(page.locator("main .loading")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Supplier returns", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("supplier-returns-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add supplier return" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Reference", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("textbox", {
      name: "Item barcode / unit serial",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("process");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("supplier-return-popup-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("supplier-return-popup-mobile.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});
