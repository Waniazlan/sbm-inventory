import { test, expect, type Page } from "@playwright/test";

async function openSettings(page: Page, failSave = false) {
  let values = {
    sku_prefix: "PRN",
    barcode_prefix: "SBM-P",
    serial_prefix: "SN",
  };
  let saves = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/settings/labels")) {
      if (route.request().method() === "PUT") {
        saves++;
        if (failSave) {
          failSave = false;
          return route.fulfill({
            status: 503,
            json: { message: "Settings temporarily unavailable." },
          });
        }
        values = route.request().postDataJSON();
      }
      return route.fulfill({ json: values });
    }
    if (path.endsWith("/auth/me"))
      return route.fulfill({
        json: { id: 1, name: "Admin", role: "admin", active: true },
      });
    if (path.endsWith("/metadata"))
      return route.fulfill({
        json: {
          categories: [],
          suppliers: [],
          phone_models: [],
          timezone: "Asia/Kuala_Lumpur",
        },
      });
    if (path.endsWith("/users")) return route.fulfill({ json: [] });
    if (path.endsWith("/audit"))
      return route.fulfill({
        json: { data: [], total: 0, current_page: 1, last_page: 1 },
      });
    return route.abort();
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await expect(page.getByLabel("SKU prefix")).toHaveValue("PRN");
  return { saved: () => values, saves: () => saves };
}

test("label prefixes preview, save and persist after refresh on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await openSettings(page);
  await page.getByLabel("SKU prefix").fill("VG");
  await page.getByLabel("Product barcode prefix").fill("VG-P");
  await page.getByLabel("Serial number prefix").fill("VG_SN");
  await expect(
    page.getByText("Example: VG_SN-0000000001-12050-7", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add category" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Save label prefixes" }).click();
  await expect(
    page.getByText("Label prefixes saved.", { exact: true }),
  ).toBeVisible();
  expect(state.saved()).toEqual({
    sku_prefix: "VG",
    barcode_prefix: "VG-P",
    serial_prefix: "VG_SN",
  });
  await page.reload();
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await expect(page.getByLabel("Serial number prefix")).toHaveValue("VG_SN");
  await expect(page.getByLabel("Product barcode prefix")).toHaveValue("VG-P");
  await expect(page.getByLabel("SKU prefix")).toHaveValue("VG");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("label-prefix-settings-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("invalid prefixes stay unsaved and failed saves preserve edits for retry", async ({
  page,
}) => {
  const state = await openSettings(page, true);
  await page.getByLabel("Serial number prefix").fill("BAD PREFIX");
  await page.getByRole("button", { name: "Save label prefixes" }).click();
  expect(state.saves()).toBe(0);
  await page.getByLabel("Serial number prefix").fill("CUSTOM-SN");
  await page.getByRole("button", { name: "Save label prefixes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Settings temporarily unavailable.",
  );
  await expect(page.getByLabel("Serial number prefix")).toHaveValue(
    "CUSTOM-SN",
  );
  await page.getByRole("button", { name: "Save label prefixes" }).click();
  await expect(
    page.getByText("Label prefixes saved.", { exact: true }),
  ).toBeVisible();
  expect(state.saved().serial_prefix).toBe("CUSTOM-SN");
});
