import { test, expect } from "@playwright/test";
import fs from "node:fs";

const credentials = JSON.parse(
  fs.readFileSync(
    new URL("../../backend/.review-credentials.json", import.meta.url),
    "utf8",
  ),
);

test("item warranty saves, reopens, supports no warranty and can be cleared", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/catalogue");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Item catalogue" }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const name = `Warranty verification ${Date.now()}`;
  await dialog.getByLabel("Item name").fill(name);
  await dialog.getByLabel("Component category").selectOption({ index: 1 });
  await dialog.getByLabel("Warranty duration (days)").fill("90");
  await page.screenshot({
    path: test.info().outputPath("add-item-warranty.png"),
  });
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/items"),
  );
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  const response = await creation;
  expect(response.status()).toBe(201);
  const item = await response.json();
  expect(item.warranty_days).toBe(90);
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Search catalogue").fill(item.sku);
  const row = page.getByRole("row").filter({ hasText: item.sku });
  await row.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toContainText("90 days");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  let previous = "90";
  for (const [value, description] of [
    ["365", "365 days"],
    ["0", "No warranty"],
    ["", "Not specified"],
  ]) {
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(dialog.getByLabel("Warranty duration (days)")).toHaveValue(
      previous,
    );
    await dialog.getByLabel("Warranty duration (days)").fill(value);
    const update = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/v1/items/${item.id}`),
    );
    await dialog
      .getByRole("button", { name: "Save item", exact: true })
      .click();
    expect((await update).ok()).toBe(true);
    await expect(dialog).toHaveCount(0);
    await row.getByRole("button", { name, exact: true }).click();
    await expect(dialog).toContainText(description);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    previous = value;
  }

  await page.reload();
  await page.getByLabel("Search catalogue").fill(item.sku);
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("Warranty duration (days)")).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByLabel("Warranty duration (days)")).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("edit-item-warranty-mobile.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Delete item", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});
