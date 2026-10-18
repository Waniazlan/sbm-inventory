import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("live Inventory pages and dialogs fit the Sales-style workspace", async ({
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
  await expect(page.locator(".main-shell main .loading")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("overview-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const [link, title] of [
    ["Item catalogue", "Item catalogue"],
    ["Movement ledger", "Movement ledger"],
    ["Repair parts", "Repair parts"],
    ["Low-stock watch", "Low-stock watch"],
    ["Reports", "Inventory reports"],
    ["Integrations", "Integration history"],
    ["Settings", "Workspace settings"],
    ["Overview", "Stock overview"],
  ]) {
    await navigation.getByRole("link", { name: link, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".main-shell main .loading")).toHaveCount(0);
    await expect(
      navigation.getByRole("link", { name: link, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page
    .getByRole("region", { name: "Stock actions" })
    .getByRole("button", { name: "Receive stock" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await navigation
    .getByRole("link", { name: "Item catalogue", exact: true })
    .click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Save item" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".main-shell main .loading")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("catalogue-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  for (const width of [1440, 1100, 950, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width <= 950) {
      const menu = page.getByRole("button", { name: "Open menu" });
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(
        navigation.getByRole("link", { name: "Item catalogue", exact: true }),
      ).toBeInViewport();
      await navigation
        .getByRole("link", { name: "Item catalogue", exact: true })
        .click();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("catalogue-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.click();
  await page.screenshot({
    path: testInfo.outputPath("navigation-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await navigation.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "User interface", exact: true })
    .click();
  await expect(
    page.getByLabel("Background file", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("settings-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await menu.click();
  await page
    .getByRole("link", { name: "SBM Inventory home" })
    .press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .press("Tab");
  await expect(
    page.getByRole("link", { name: "SBM Inventory home" }),
  ).toBeFocused();
  await page.getByRole("link", { name: "SBM Inventory home" }).press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("technicians keep their navigation and drawer state resets on desktop", async ({
  page,
}) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me"))
      return route.fulfill({
        json: { id: 5, name: "Technician", role: "technician", active: true },
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
    return route.fulfill({
      json: { data: [], total: 0, current_page: 1, last_page: 1 },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/catalogue");
  await expect(
    page.getByRole("heading", { name: "Item catalogue", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add item", exact: true }),
  ).toHaveCount(0);
  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.click();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  for (const name of ["Settings", "Reports", "Integrations"])
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".scrim")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).not.toBeVisible();
});
