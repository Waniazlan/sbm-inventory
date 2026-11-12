import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const product = {
  id: 1,
  name: "iPhone replacement screen",
  sku: "SBM-001",
  barcode: "PRODUCT-001",
  category: { id: 1, name: "Screens" },
  phone_models: [],
  unit: "piece",
  stock: 3,
  minimum_stock: 0,
  price: 2500,
  active: true,
};
const sold = {
  match: "unit",
  status: "Sold",
  item: {
    ...product,
    category: "Screens",
    brand: "Original",
    compatibility: ["Apple iPhone 15"],
    available_stock: 3,
    archived: false,
    colour: null,
    capacity: null,
    grade: null,
  },
  unit: { serial_number: "0000123", received_at: "2026-11-01T02:00:00Z" },
  movement: {
    type: "sale",
    reference: "INV-0099",
    occurred_at: "2026-11-10T03:00:00Z",
  },
};

async function setup(page: Page, role = "technician") {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me"))
      return route.fulfill({
        json: { id: 1, name: "Staff", role, active: true },
      });
    if (url.pathname.endsWith("/metadata"))
      return route.fulfill({
        json: {
          categories: [product.category],
          suppliers: [],
          phone_models: [],
          timezone: "Asia/Kuala_Lumpur",
        },
      });
    if (url.pathname.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          items: 1,
          units: 3,
          low_stock: 0,
          out_of_stock: 0,
          valuation: 7500,
          recent: [],
          low_items: [],
        },
      });
    if (url.pathname.endsWith("/items/lookup")) {
      const barcode = url.searchParams.get("barcode");
      if (barcode === "UNKNOWN")
        return route.fulfill({
          status: 404,
          json: { message: "No item matches this barcode or serial number." },
        });
      if (barcode === "FAIL")
        return route.fulfill({
          status: 503,
          json: { message: "Lookup temporarily unavailable." },
        });
      if (barcode === "SLOW")
        await new Promise((resolve) => setTimeout(resolve, 300));
      if (barcode === "PRODUCT-001")
        return route.fulfill({
          json: {
            ...sold,
            match: "product",
            status: "In stock",
            unit: null,
            movement: null,
          },
        });
      if (barcode === "IN-STOCK")
        return route.fulfill({
          json: {
            ...sold,
            status: "In stock",
            unit: { ...sold.unit, serial_number: barcode },
          },
        });
      return route.fulfill({ json: sold });
    }
    if (url.pathname.endsWith("/items"))
      return route.fulfill({
        json: { data: [product], current_page: 1, last_page: 1, total: 1 },
      });
    return route.abort();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
}

test("scanner input automatically finds the item without Enter and stays ready for another scan", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Quick scan" }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Barcode or serial number");
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Check item" })).toHaveCount(
    0,
  );
  await page.keyboard.type("0000123");
  await expect(dialog.getByText("Sold", { exact: true })).toBeVisible();
  await expect(dialog.getByText("INV-0099", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await page.keyboard.type("IN-STOCK");
  await expect(dialog.getByText("In stock", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Sold", { exact: true })).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
});

test("automatic lookup waits until the barcode has finished typing", async ({
  page,
}) => {
  await setup(page);
  await page.clock.install({ time: new Date("2026-11-12T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-12T00:00:01Z"));
  const codes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/items/lookup"))
      codes.push(url.searchParams.get("barcode")!);
  });
  await page.getByRole("button", { name: "Quick scan" }).click();
  await page.keyboard.type("000");
  await page.clock.runFor(150);
  await page.keyboard.type("0123");
  await page.clock.runFor(299);
  expect(codes).toEqual([]);
  await page.clock.runFor(1);
  await expect(
    page.getByRole("dialog").getByText("Sold", { exact: true }),
  ).toBeVisible();
  expect(codes).toEqual(["0000123"]);
});

test("Enter submits immediately without a duplicate automatic lookup", async ({
  page,
}) => {
  await setup(page);
  await page.clock.install({ time: new Date("2026-11-12T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-12T00:00:01Z"));
  const codes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/items/lookup"))
      codes.push(url.searchParams.get("barcode")!);
  });
  await page.getByRole("button", { name: "Quick scan" }).click();
  await page.keyboard.type("0000123");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog").getByText("Sold", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(600);
  expect(codes).toEqual(["0000123"]);
});

test("closing the popup cancels a pending automatic lookup", async ({
  page,
}) => {
  await setup(page);
  await page.clock.install({ time: new Date("2026-11-12T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-12T00:00:01Z"));
  const codes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/items/lookup"))
      codes.push(url.searchParams.get("barcode")!);
  });
  await page.getByRole("button", { name: "Quick scan" }).click();
  await page.keyboard.type("0000123");
  await page.keyboard.press("Escape");
  await page.clock.runFor(600);
  expect(codes).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("X and Escape close the popup and restore focus to its trigger", async ({
  page,
}) => {
  await setup(page, "admin");
  await expect(page.locator("main .heading .actions button")).toHaveText([
    /Receive stock/,
    /Quick scan/,
  ]);
  await expect(
    page.locator("header").getByRole("button", { name: "Quick scan" }),
  ).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "Quick scan" });
  await trigger.click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("scanner input preserves spaces, case and punctuation in the lookup request", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Quick scan" }).click();
  const code = " 00AbC / +?& ";
  const request = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith("/items/lookup"),
  );
  await page.keyboard.type(code);
  await page.keyboard.press("Enter");
  expect(new URL((await request).url()).searchParams.get("barcode")).toBe(code);
  await expect(
    page.getByRole("dialog").getByText("Sold", { exact: true }),
  ).toBeVisible();
});

test("product scans and errors replace the previous result without losing scan focus", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Quick scan" }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Barcode or serial number");
  await input.fill("PRODUCT-001");
  await expect(
    dialog.getByText("Shared product barcode.", { exact: false }),
  ).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("UNKNOWN");
  await input.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("No item matches");
  await expect(dialog.getByRole("heading", { name: product.name })).toHaveCount(
    0,
  );
  await expect(input).toBeFocused();
  await input.fill("FAIL");
  await input.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText(
    "Lookup temporarily unavailable",
  );
  await input.fill("0000123");
  await input.press("Enter");
  await expect(dialog.getByText("Sold", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("a newer scan wins over a slower previous lookup and reopening starts fresh", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Quick scan" }).click();
  const input = page.getByLabel("Barcode or serial number");
  const slow = page.waitForRequest((request) =>
    request.url().includes("barcode=SLOW"),
  );
  await input.fill("SLOW");
  await input.press("Enter");
  await slow;
  await input.fill("PRODUCT-001");
  await input.press("Enter");
  await expect(
    page.getByRole("dialog").getByText("In stock", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await expect(
    page.getByRole("dialog").getByText("Sold", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Quick scan" }).click();
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("dialog").getByText("Ready to scan."),
  ).toBeVisible();
});

for (const width of [1440, 390, 320]) {
  test(`popup stays within the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await setup(page);
    await page.getByRole("button", { name: "Quick scan" }).click();
    await page.getByLabel("Barcode or serial number").fill("0000123");
    await page.getByLabel("Barcode or serial number").press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Sold", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close dialog" }),
    ).toBeInViewport();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/sbm-quick-lookup-${width}.png` });
    await dialog.locator(".quick-lookup-result").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole("button", { name: "Close dialog" }),
    ).toBeInViewport();
    await expect(page.getByLabel("Barcode or serial number")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("live quick lookup reads an existing inventory label without moving stock", async ({
  page,
}) => {
  const credentials = JSON.parse(
    fs.readFileSync(
      new URL("../../backend/.review-credentials.json", import.meta.url),
      "utf8",
    ),
  );
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  const headers = {
    Origin: new URL(page.url()).origin,
    Accept: "application/json",
  };
  const catalogue = await page.request.get("/api/v1/items", { headers });
  expect(catalogue.ok()).toBe(true);
  const item = (await catalogue.json()).data.find(
    (entry: { barcode: string | null }) => entry.barcode,
  );
  test.skip(
    !item,
    "No existing item barcode is available for a read-only live lookup.",
  );
  const unitsResponse = await page.request.get(
    `/api/v1/items/${item.id}/units`,
    { headers },
  );
  expect(unitsResponse.ok()).toBe(true);
  const unit = (await unitsResponse.json()).data[0];
  const code = unit?.serial_number ?? item.barcode;
  await page.getByRole("button", { name: "Quick scan" }).click();
  const input = page.getByLabel("Barcode or serial number");
  await expect(input).toBeFocused();
  const lookup = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/items/lookup"),
  );
  await page.keyboard.type(code);
  const response = await lookup;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: item.name, exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(result.status, { exact: true })).toBeVisible();
  await expect(dialog.getByText(code, { exact: true })).toBeVisible();
  await expect(input).toBeFocused();
  const after = await page.request.get(`/api/v1/items/${item.id}`, { headers });
  expect((await after.json()).stock).toBe(item.stock);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toHaveCount(0);
});
