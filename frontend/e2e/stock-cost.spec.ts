import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const credentials = JSON.parse(
  fs.readFileSync(
    new URL("../../backend/.review-credentials.json", import.meta.url),
    "utf8",
  ),
);

async function post(page: Page, path: string, data: object) {
  return page.evaluate(
    async ({ path, data }) => {
      // @ts-expect-error Vite serves the application API module in the browser.
      const { api } = await import("/src/api.ts");
      return (await api.post(path, data)).data;
    },
    { path, data },
  );
}

test("different intake suppliers retain their batch costs through FIFO usage and catalogue edits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  const metadata = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the application API module in the browser.
    const { api } = await import("/src/api.ts");
    return (await api.get("/metadata")).data;
  });
  const suppliers: { id: number; name: string }[] = metadata.suppliers;
  for (let n = suppliers.length; n < 2; n++) {
    suppliers.push(
      await post(page, "/metadata/suppliers", {
        name: `Batch verification supplier ${n + 1} ${Date.now()}`,
      }),
    );
  }
  // Reload metadata if this installation did not yet have two suppliers.
  await page.reload();
  await page.getByRole("link", { name: "Item catalogue" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog");
  const name = `Batch verification OLED ${Date.now()}`;
  await dialog.getByLabel("Item name", { exact: true }).fill(name);
  await dialog.getByLabel("Component category").selectOption({ index: 1 });
  await expect(dialog.locator('[name="supplier_id"]')).toHaveCount(0);
  await expect(dialog.locator('[name="cost"]')).toHaveCount(0);
  await expect(dialog.getByLabel("Part brand")).toHaveCount(0);
  await dialog.getByLabel("Selling price (MYR)").fill("200.00");
  const creation = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/items") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Save item" }).click();
  const createdResponse = await creation;
  expect(createdResponse.request().postDataJSON()).not.toHaveProperty(
    "supplier_id",
  );
  expect(createdResponse.request().postDataJSON()).not.toHaveProperty("cost");
  const item = await createdResponse.json();
  await expect(dialog).not.toBeVisible();
  const movements: number[] = [];
  try {
    await page.getByLabel("Search catalogue").fill(item.sku);
    const row = page.getByRole("row").filter({ hasText: item.sku });
    await expect(
      row.getByRole("button", { name: "Stock batches", exact: true }),
    ).toHaveCount(0);
    for (const [index, quantity, cost] of [
      [0, 10, "120.00"],
      [1, 5, "135.00"],
    ] as const) {
      await row.getByRole("button", { name: "Receive", exact: true }).click();
      await expect(
        dialog.getByRole("combobox", { name: "Supplier", exact: true }),
      ).toHaveValue("");
      await dialog
        .getByRole("combobox", { name: "Supplier", exact: true })
        .selectOption(String(suppliers[index].id));
      await dialog
        .getByLabel("Source reference")
        .fill(`${item.sku}-LOT-${index}`);
      await dialog.getByLabel("Batch reference").fill(`LOT-${index}`);
      await dialog.getByLabel("Part brand").fill(`Intake brand ${index + 1}`);
      await dialog
        .getByLabel("Quantity", { exact: true })
        .fill(String(quantity));
      await dialog.getByLabel("Receipt unit cost (MYR)").fill(cost);
      const receiving = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/movements") &&
          r.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "Receive stock", exact: true })
        .click();
      const received = await (await receiving).json();
      movements.push(received.movements[0].id);
      await expect(dialog).not.toBeVisible();
    }
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(dialog.locator('[name="supplier_id"]')).toHaveCount(0);
    await expect(dialog.locator('[name="cost"]')).toHaveCount(0);
    await expect(dialog.getByLabel("Selling price (MYR)")).toHaveValue("200");
    await expect(dialog.getByLabel("Part brand")).toHaveCount(0);
    await dialog.getByLabel("Notes").fill("Edited catalogue notes");
    await dialog
      .getByRole("button", { name: "Save item", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await row.getByRole("button", { name, exact: true }).click();
    await expect(dialog).toContainText("RM 1,875.00");
    const supplierStock = dialog.getByRole("region", {
      name: "Stock by supplier",
    });
    await expect(
      supplierStock.getByRole("row").filter({ hasText: suppliers[0].name }),
    ).toContainText("10 piece(s)");
    await expect(
      supplierStock.getByRole("row").filter({ hasText: suppliers[0].name }),
    ).toContainText("Intake brand 1");
    await expect(
      supplierStock.getByRole("row").filter({ hasText: suppliers[1].name }),
    ).toContainText("5 piece(s)");
    await expect(
      supplierStock.getByRole("row").filter({ hasText: suppliers[1].name }),
    ).toContainText("Intake brand 2");
    await expect(
      supplierStock.getByRole("row").filter({ hasText: "Total on hand" }),
    ).toContainText("15 piece(s)");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "../docs/screenshots/product-supplier-stock-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "../docs/screenshots/product-supplier-stock-desktop.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Issue or adjust stock", exact: true })
      .click();
    await dialog.getByLabel("Quantity", { exact: true }).fill("12");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Batch verification FIFO issue");
    const issuing = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/movements") &&
        r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Record movement", exact: true })
      .click();
    const issued = await (await issuing).json();
    movements.push(issued.movements[0].id);
    await expect(dialog).not.toBeVisible();
    await row.getByRole("button", { name, exact: true }).click();
    await expect(
      supplierStock.getByRole("row").filter({ hasText: suppliers[0].name }),
    ).toHaveCount(0);
    await expect(
      supplierStock.getByRole("row").filter({ hasText: suppliers[1].name }),
    ).toContainText("3 piece(s)");
    await expect(
      supplierStock.getByRole("row").filter({ hasText: suppliers[1].name }),
    ).toContainText("Intake brand 2");
    await expect(
      supplierStock.getByRole("row").filter({ hasText: "Total on hand" }),
    ).toContainText("3 piece(s)");
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.getByRole("link", { name: "Movement ledger" }).click();
    await page.getByLabel("Search movements").fill(item.sku);
    const issue = page
      .getByRole("row")
      .filter({ hasText: "Batch verification FIFO issue" });
    await expect(issue).toContainText("RM 1,470.00");
    await expect(issue).toContainText("Multiple batch costs");
    const current = await page.evaluate(async (id) => {
      // @ts-expect-error Vite serves the application API module in the browser.
      const { api } = await import("/src/api.ts");
      return (await api.get(`/items/${id}`)).data;
    }, item.id);
    expect(current.stock_value).toBe(40500);
    expect(current.price).toBe(20000);
    expect(current.supplier_id).toBeNull();
    expect(current.cost).toBe(0);
    const receipts = await page.evaluate(async (id) => {
      // @ts-expect-error Vite serves the application API module in the browser.
      const { api } = await import("/src/api.ts");
      return (await api.get(`/movements?item_id=${id}&type=receipt`)).data.data;
    }, item.id);
    expect(
      receipts.map((receipt: { brand: string }) => receipt.brand).sort(),
    ).toEqual(["Intake brand 1", "Intake brand 2"]);
    expect(current.brand).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    // Preserve immutable verification history while returning all test stock to zero.
    for (const movement_id of movements.reverse()) {
      await post(page, "/movements", {
        request_key: crypto.randomUUID(),
        kind: "reversal",
        movement_id,
        reason: "Close batch verification movement",
      });
    }
    await page.evaluate(async (item) => {
      // @ts-expect-error Vite serves the application API module in the browser.
      const { api } = await import("/src/api.ts");
      await api.put(`/items/${item.id}`, {
        ...item,
        active: false,
        phone_model_ids: [],
      });
    }, item);
  }
});
