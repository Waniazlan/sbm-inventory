import { test, expect, type Page } from "@playwright/test";

async function catalogue(
  page: Page,
  options: {
    role?: string;
    stock?: number;
    fail?: boolean;
    pages?: boolean;
  } = {},
) {
  let deleted = false;
  let deletes = 0;
  let fail = options.fail;
  const requests: URL[] = [];
  const item = {
    id: 1,
    name: "Unused LCD",
    sku: "PRN-000001",
    barcode: "SBM-P-00000001",
    category: { id: 1, name: "LCD" },
    phone_models: [],
    unit: "piece",
    stock: options.stock || 0,
    minimum_stock: 0,
    price: 2000,
    active: true,
    serial_tracking: false,
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me"))
      return route.fulfill({
        json: {
          id: 1,
          name: "User",
          role: options.role || "admin",
          active: true,
        },
      });
    if (url.pathname.endsWith("/metadata"))
      return route.fulfill({
        json: {
          categories: [item.category],
          suppliers: [],
          phone_models: [],
          timezone: "Asia/Kuala_Lumpur",
        },
      });
    if (
      url.pathname.endsWith("/items/1") &&
      route.request().method() === "DELETE"
    ) {
      deletes++;
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 503,
          json: {
            message:
              "Connection interrupted. Retry the same request to check its result.",
          },
        });
      }
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.endsWith("/items")) {
      requests.push(url);
      const page2 = url.searchParams.get("page") === "2";
      const data =
        options.pages && !page2
          ? Array.from({ length: 25 }, (_, index) => ({
              ...item,
              id: index + 2,
              name: `Other LCD ${index + 1}`,
              sku: `OTHER-${index + 1}`,
            }))
          : deleted
            ? []
            : [item];
      return route.fulfill({
        json: {
          data,
          total: options.pages ? (deleted ? 25 : 26) : deleted ? 0 : 1,
          current_page: page2 ? 2 : 1,
          last_page: options.pages && !deleted ? 2 : 1,
        },
      });
    }
    return route.abort();
  });
  await page.goto("/catalogue");
  await expect(
    page.getByRole("heading", { name: "Item catalogue", exact: true }),
  ).toBeVisible();
  return { deletes: () => deletes, requests };
}

test("admin confirms deletion and can cancel with Cancel, X and Escape", async ({
  page,
}) => {
  const state = await catalogue(page);
  const remove = page.getByRole("button", { name: "Delete", exact: true });
  await remove.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Unused LCD");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await remove.click();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await remove.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(state.deletes()).toBe(0);
  await remove.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "Delete item", exact: true }),
  ).toBeInViewport();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("delete-item-mobile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Delete item", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Item deleted.", { exact: true })).toBeVisible();
  await expect(remove).toHaveCount(0);
  expect(state.deletes()).toBe(1);
});

test("technicians cannot see Delete and items with stock cannot be confirmed", async ({
  page,
}) => {
  await catalogue(page, { role: "technician" });
  await expect(
    page.getByRole("button", { name: "Unused LCD", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use part", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
});

test("remaining stock is explained before deletion and blocks confirmation", async ({
  page,
}) => {
  const state = await catalogue(page, { stock: 3 });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "3 piece(s) on hand",
  );
  await expect(
    page.getByRole("button", { name: "Delete item", exact: true }),
  ).toBeDisabled();
  expect(state.deletes()).toBe(0);
});

test("failed deletion can retry and deleting the last row returns to the previous page", async ({
  page,
}) => {
  const state = await catalogue(page, { pages: true, fail: true });
  await page.getByLabel("Sort by").selectOption("modified");
  await page.getByLabel("Next page").click();
  await expect(page.getByText("Page 2 of 2", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Delete item", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Connection interrupted",
  );
  await expect(
    dialog.getByRole("button", { name: "Delete item", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Delete item", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Page 1 of 1", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Sort by")).toHaveValue("modified");
  expect(state.requests.at(-1)?.searchParams.get("page")).toBe("1");
  expect(state.requests.at(-1)?.searchParams.get("sort")).toBe("modified");
  expect(state.deletes()).toBe(2);
});
