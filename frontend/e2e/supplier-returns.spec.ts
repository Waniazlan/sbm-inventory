import { expect, test, type Page } from "@playwright/test";

const supplier = { id: 1, name: "Screen supplier" };
const item = {
  id: 1,
  sku: "SCREEN-001",
  name: "Replacement screen",
  stock: 5,
  unit: "piece",
  serial_tracking: true,
};

async function setup(
  page: Page,
  options: { failFirst?: boolean; technician?: boolean } = {},
) {
  const records: Record<string, unknown>[] = [];
  const writes: { method: string; data: Record<string, unknown> }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let body: unknown;
    if (path.endsWith("/auth/me"))
      body = {
        id: 1,
        name: "Return admin",
        role: options.technician ? "technician" : "admin",
        active: true,
      };
    else if (path.endsWith("/metadata"))
      body = {
        categories: [],
        suppliers: [supplier],
        phone_models: [],
        timezone: "Asia/Kuala_Lumpur",
      };
    else if (path.endsWith("/supplier-returns/lookup")) {
      const code = url.searchParams.get("barcode");
      if (code === "UNKNOWN")
        return route.fulfill({
          status: 404,
          json: {
            message: "No available item matches this barcode or serial number.",
          },
        });
      if (code === "UNAVAILABLE")
        return route.fulfill({
          status: 422,
          json: {
            message: "This serial is not available for a supplier return.",
          },
        });
      if (code === "SHARED-PRODUCT")
        return route.fulfill({
          status: 422,
          json: {
            message: "Scan the individual unit serial label for this item.",
          },
        });
      body =
        code === "PRODUCT-PLAIN"
          ? {
              item: { ...item, serial_tracking: false },
              supplier_id: null,
              serial_number: null,
            }
          : {
              item:
                code === "OTHER-ITEM"
                  ? { ...item, id: 2, name: "Another item" }
                  : item,
              supplier_id: code === "OTHER-SUPPLIER" ? 2 : 1,
              serial_number: code,
            };
    } else if (path.endsWith("/items/1"))
      body = {
        ...item,
        supplier_stock: [
          {
            supplier_id: 1,
            supplier_name: supplier.name,
            quantity: 5,
            brands: [],
          },
        ],
      };
    else if (
      path.endsWith("/supplier-returns") &&
      request.method() === "POST"
    ) {
      const data = request.postDataJSON();
      writes.push({ method: "POST", data });
      if (options.failFirst && writes.length === 1)
        return route.abort("failed");
      const entry = {
        ...data,
        id: 1,
        item,
        supplier,
        creator: { id: 1, name: "Return admin" },
        created_at: "2026-10-29T05:00:00Z",
        updated_at: "2026-10-29T05:00:00Z",
      };
      records.push(entry);
      return route.fulfill({ status: 201, json: entry });
    } else if (
      path.endsWith("/supplier-returns/1") &&
      request.method() === "PUT"
    ) {
      const data = request.postDataJSON();
      writes.push({ method: "PUT", data });
      records[0].status = data.status;
      body = records[0];
    } else if (path.endsWith("/supplier-returns")) {
      const filtered = records.filter(
        (record) =>
          (!url.searchParams.get("status") ||
            record.status === url.searchParams.get("status")) &&
          (!url.searchParams.get("search") ||
            `${item.name} ${supplier.name}`.includes(
              url.searchParams.get("search")!,
            )),
      );
      body = {
        data: filtered,
        total: filtered.length,
        current_page: 1,
        last_page: 1,
      };
    } else if (path.endsWith("/dashboard"))
      body = {
        items: 1,
        units: 5,
        low_stock: 0,
        out_of_stock: 0,
        recent: [],
        low_items: [],
      };
    else return route.abort();
    return route.fulfill({ json: body });
  });
  await page.goto("/supplier-returns");
  return { writes };
}

async function scanCode(page: Page, code: string) {
  const input = page.getByRole("textbox", {
    name: "Item barcode / unit serial",
    exact: true,
  });
  await input.fill(code);
  await input.press("Enter");
  await expect(input).toBeEnabled();
}

async function fillReturn(page: Page) {
  await page.getByRole("button", { name: "Add supplier return" }).click();
  const dialog = page.getByRole("dialog");
  await scanCode(page, "SCREEN-A");
  await scanCode(page, "SCREEN-B");
  await expect(
    dialog.getByText("5 unit(s) available from this supplier."),
  ).toBeVisible();
  await expect(dialog.getByLabel("Reference", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Reason for return").fill("Faulty screen received");
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("process");
  await expect(dialog.getByRole("status")).toContainText(
    "stays in on-hand stock and is frozen from use",
  );
  return dialog;
}

test("popup creates a Process return and updates Delivered and Rejected in the table", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await expect(
    page.getByRole("heading", { name: "No supplier returns found" }),
  ).toBeVisible();
  const dialog = await fillReturn(page);
  await dialog.getByRole("button", { name: "Add return", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "SR-000001" });
  await expect(row).toContainText("Replacement screen");
  await expect(row).toContainText("Screen supplier");
  await expect(row).toContainText("Process");
  expect(writes[0].data).toMatchObject({
    item_id: 1,
    supplier_id: 1,
    quantity: 2,
    status: "process",
    reason: "Faulty screen received",
    serials: "SCREEN-A\nSCREEN-B",
  });
  expect(writes[0].data).not.toHaveProperty("reference");
  for (const status of ["delivered", "rejected"]) {
    await row.getByRole("button", { name: "Update SR-000001" }).click();
    const update = page.getByRole("dialog");
    await update
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption(status);
    await expect(update.getByRole("status")).toContainText(
      status === "delivered"
        ? "frozen quantity will be deducted"
        : "will not deduct it again",
    );
    await update
      .getByRole("button", { name: "Update status", exact: true })
      .click();
    await expect(update).not.toBeVisible();
    await expect(row).toContainText(
      status === "delivered" ? "Delivered" : "Rejected",
    );
  }
  expect(writes.slice(1).map((write) => write.data)).toEqual([
    { status: "delivered", expected_status: "process" },
    { status: "rejected", expected_status: "delivered" },
  ]);
  await page.getByLabel("Return status").selectOption("process");
  await expect(
    page.getByRole("heading", { name: "No supplier returns found" }),
  ).toBeVisible();
  await page.getByLabel("Return status").selectOption("rejected");
  await expect(row).toBeVisible();
  await page.getByLabel("Search supplier returns").fill("missing item");
  await expect(row).not.toBeVisible();
});

test("uncertain submission retries the same return and request key", async ({
  page,
}) => {
  const { writes } = await setup(page, { failFirst: true });
  const dialog = await fillReturn(page);
  await dialog.getByRole("button", { name: "Add return", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Quantity", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Retry same request" }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0].data).toEqual(writes[1].data);
  await expect(
    page.getByRole("row").filter({ hasText: "SR-000001" }),
  ).toHaveCount(1);
});

test("mobile popup stays within the viewport and supports keyboard dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const dialog = await fillReturn(page);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: "test-results/supplier-return-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add supplier return" }),
  ).toBeFocused();
});

test("technicians cannot open the administrator supplier return page", async ({
  page,
}) => {
  await setup(page, { technician: true });
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Supplier returns" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add supplier return" }),
  ).toHaveCount(0);
});

test("serial scans fill item and supplier, count units, and reject duplicate or mismatched codes", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.getByRole("button", { name: "Add supplier return" }).click();
  const dialog = page.getByRole("dialog");
  await scanCode(page, "SCREEN-A");
  await expect(
    dialog.getByText("Replacement screen", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Supplier", exact: true }),
  ).toHaveValue("1");
  await expect(
    dialog.getByRole("combobox", { name: "Supplier", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  for (const [code, message] of [
    ["SCREEN-A", "already been added"],
    ["OTHER-SUPPLIER", "different supplier"],
    ["OTHER-ITEM", "different item"],
    ["UNKNOWN", "No available item matches"],
    ["UNAVAILABLE", "not available"],
    ["SHARED-PRODUCT", "individual unit serial label"],
  ]) {
    await scanCode(page, code);
    await expect(dialog.getByRole("alert")).toContainText(message);
    await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue(
      "1",
    );
    await expect(dialog.getByLabel("Unit serial numbers")).toHaveValue(
      "SCREEN-A",
    );
  }
  await scanCode(page, "SCREEN-B");
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("2");
  await expect(dialog.getByLabel("Unit serial numbers")).toHaveValue(
    "SCREEN-A\nSCREEN-B",
  );
  expect(writes).toHaveLength(0);
  await dialog.getByRole("button", { name: "Clear item" }).click();
  await expect(
    dialog.getByText("Replacement screen", { exact: true }),
  ).not.toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Add return", exact: true }),
  ).toBeDisabled();
});

test("untracked product barcode permits choosing supplier and return quantity", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.getByRole("button", { name: "Add supplier return" }).click();
  const dialog = page.getByRole("dialog");
  await scanCode(page, "PRODUCT-PLAIN");
  await dialog
    .getByRole("combobox", { name: "Supplier", exact: true })
    .selectOption("1");
  await dialog.getByLabel("Quantity", { exact: true }).fill("3");
  await dialog.getByLabel("Reason for return").fill("Incorrect item supplied");
  await dialog.getByRole("button", { name: "Add return", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes[0].data).toMatchObject({
    item_id: 1,
    supplier_id: 1,
    quantity: 3,
    serials: null,
  });
});

test("serial barcode photo selects the item and preserves the exact decoded serial", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  const { writes } = await setup(page);
  await page.getByRole("button", { name: "Add supplier return" }).click();
  await page.getByRole("button", { name: "Scan barcode / serial" }).click();
  await page
    .getByLabel("Choose barcode photo")
    .setInputFiles(
      new URL("./fixtures/barcode-0012345678901234.svg", import.meta.url)
        .pathname,
    );
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    "0012345678901234",
  );
  await page.getByRole("button", { name: "Use barcode", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Unit serial numbers")).toHaveValue(
    "0012345678901234",
  );
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  await dialog.getByLabel("Reason for return").fill("Damaged unit supplied");
  await dialog.getByRole("button", { name: "Add return", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes[0].data).toMatchObject({
    item_id: 1,
    supplier_id: 1,
    quantity: 1,
    serials: "0012345678901234",
  });
});
