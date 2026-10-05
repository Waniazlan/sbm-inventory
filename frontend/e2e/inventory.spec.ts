import { test, expect } from "@playwright/test";
import fs from "node:fs";
const credentials = JSON.parse(
  fs.readFileSync(
    new URL("../../backend/.review-credentials.json", import.meta.url),
    "utf8",
  ),
);
test("catalogue, receipt, adjustment, reversal, reports and responsive navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in to Inventory" }).click();
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Item catalogue" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  const sku = "BROWSER-" + Date.now();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Item name").fill("Browser verification battery");
  await dialog.getByLabel("SKU", { exact: true }).fill(sku);
  await dialog
    .getByLabel("Component category")
    .selectOption({ label: "Battery" });
  await dialog.getByLabel("Standard cost (MYR)").fill("12.00");
  await dialog.getByLabel("Selling price (MYR)").fill("25.00");
  await dialog.getByLabel("Minimum stock").fill("2");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Search catalogue").fill(sku);
  const row = page.getByRole("row").filter({ hasText: sku });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Receive", exact: true }).click();
  await dialog.getByLabel("Quantity", { exact: true }).fill("10");
  await dialog.getByLabel("Source reference").fill(sku);
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Browser verification receipt");
  await dialog.getByRole("button", { name: "Record movement" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toContainText("10");
  await row
    .getByRole("button", { name: "Browser verification battery" })
    .click();
  await dialog.getByRole("button", { name: "Issue or adjust stock" }).click();
  await dialog.getByLabel("Movement type").selectOption("adjustment");
  await dialog.getByLabel("Actual quantity counted").fill("2");
  await dialog.getByLabel("Count reference").fill(sku + "-COUNT");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Browser verification physical count");
  await dialog.getByRole("button", { name: "Record movement" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toContainText("Low stock");
  await page.getByRole("link", { name: "Movement ledger" }).click();
  await page.getByLabel("Search movements").fill(sku);
  const adjustment = page
    .getByRole("row")
    .filter({ hasText: "physical count" });
  await adjustment.getByRole("button", { name: "Reverse" }).click();
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Reverse browser verification count");
  await dialog.getByRole("button", { name: "Record movement" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Reversed by #")).toBeVisible();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inventory reports" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "inventory-current.csv",
  );
  for (const route of [
    "/",
    "/catalogue",
    "/movements",
    "/repairs",
    "/low-stock",
    "/reports",
    "/integrations",
    "/settings",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../docs/screenshots/overview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../docs/screenshots/overview-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Item catalogue" }).click();
  await expect(
    page.getByRole("heading", { name: "Item catalogue" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  // Retain immutable test history, but return this browser-created item's balance to zero.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Movement ledger" }).click();
  await page.getByLabel("Search movements").fill(sku);
  await page
    .getByRole("row")
    .filter({ hasText: "Browser verification receipt" })
    .getByRole("button", { name: "Reverse" })
    .click();
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Close browser verification stock receipt");
  await dialog.getByRole("button", { name: "Record movement" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "Item catalogue" }).click();
  await page.getByLabel("Search catalogue").fill(sku);
  await page
    .getByRole("row")
    .filter({ hasText: sku })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await dialog.getByLabel("Active item").uncheck();
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
