import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

async function mockReports(
  page: Page,
  options: { empty?: boolean; fail?: boolean } = {},
) {
  await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
  let failure = options.fail;
  const requests: URL[] = [];
  const stock = Array.from({ length: 7 }, (_, index) => ({
    SKU: `PRN-00000${index + 1}`,
    Name: [
      "iPhone 13 OLED screen",
      "Samsung A15 battery",
      "iPhone 12 charging port",
      "USB-C charging cable",
      "Tempered glass",
      "Camera lens",
      "Display adhesive",
    ][index],
    Category: index % 2 ? "Batteries" : "Displays",
    Stock: index + 2,
    Minimum: 3,
    "Value (sen)": 13500 * (index + 2),
  }));
  const movements = Array.from({ length: 7 }, (_, index) => ({
    ID: index + 1,
    SKU: stock[index].SKU,
    Type: index % 2 ? "receipt" : "repair_usage",
    Change: index % 2 ? 10 : -1,
    "Total cost (sen)": 13500,
    Reason: "Screen installed",
    Reference: `RP-1026-00${index + 1}`,
    Actor: "Admin",
    "Repair job": `RP-1026-00${index + 1}`,
    "Occurred at": "2026-10-26T11:30:00+08:00",
  }));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname.endsWith("/auth/me"))
      return route.fulfill({
        json: { id: 1, name: "Admin", role: "admin", active: true },
      });
    if (url.pathname.endsWith("/metadata"))
      return route.fulfill({
        json: {
          categories: [],
          suppliers: [],
          phone_models: [],
          timezone: "Asia/Kuala_Lumpur",
        },
      });
    if (url.pathname.endsWith("/reports/overview")) {
      if (failure) {
        return route.fulfill({
          status: 503,
          json: { message: "Report summary temporarily unavailable." },
        });
      }
      const from = url.searchParams.get("from")!,
        to = url.searchParams.get("to")!;
      const series: { date: string; stock_in: number; stock_out: number }[] = [];
      for (
        let date = new Date(`${from}T12:00:00Z`);
        date.toISOString().slice(0, 10) <= to;
        date.setUTCDate(date.getUTCDate() + 1)
      ) {
        const index = series.length;
        series.push({
          date: date.toISOString().slice(0, 10),
          stock_in: options.empty ? 0 : [4, 7, 3, 18, 6, 10, 15][index % 7],
          stock_out: options.empty ? 0 : [1, 2, 5, 8, 3, 4, 6][index % 7],
        });
      }
      return route.fulfill({
        json: {
          from,
          to,
          timezone: "Asia/Kuala_Lumpur",
          interval: "day",
          stock: options.empty
            ? { value: 0, units: 0, items: 0, low_stock: 0 }
            : { value: 4658300, units: 85, items: 7, low_stock: 2 },
          activity: {
            movements: options.empty ? 0 : 94,
            stock_in: series.reduce((n, p) => n + p.stock_in, 0),
            stock_out: series.reduce((n, p) => n + p.stock_out, 0),
          },
          series,
          categories: options.empty
            ? []
            : [
                { name: "Displays", units: 40, value: 2532000 },
                { name: "Batteries", units: 25, value: 1545000 },
                { name: "Charging parts", units: 20, value: 581300 },
              ],
          reasons: options.empty
            ? []
            : [
                {
                  type: "repair_usage",
                  reason: "Screen installed",
                  quantity: 24,
                },
                { type: "sale", reason: "Counter sale", quantity: 12 },
                { type: "manual_out", reason: "Damaged part", quantity: 3 },
              ],
        },
      });
    }
    if (url.pathname.endsWith("/reports")) {
      const kind = url.searchParams.get("kind");
      if (url.searchParams.get("format") === "csv")
        return route.fulfill({
          contentType: "text/csv",
          body: "SKU,Name\nPRN-000001,Screen\n",
        });
      const all = options.empty
        ? []
        : kind === "current" || kind === "valuation"
          ? stock
          : kind === "low"
            ? stock.slice(0, 2)
            : kind === "reasons"
              ? [
                  {
                    Reason: "Screen installed",
                    Type: "repair_usage",
                    Quantity: 24,
                  },
                  { Reason: "Counter sale", Type: "sale", Quantity: 12 },
                ]
              : movements;
      const page = Number(url.searchParams.get("page") || 1);
      return route.fulfill({
        json: {
          data: all.slice((page - 1) * 5, page * 5),
          total: all.length,
          current_page: page,
          last_page: Math.max(1, Math.ceil(all.length / 5)),
        },
      });
    }
    return route.abort();
  });
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Inventory reports", exact: true }),
  ).toBeVisible();
  return {
    requests,
    allowLoading: () => {
      failure = false;
    },
  };
}

const sections = [
  "Stock & valuation",
  "Low stock",
  "Stock movements",
  "Stock-out reasons",
  "Repair usage",
  "Sales linkage",
];

test("graphs and all report sections share one responsive page with independent pagination", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockReports(page);
  await expect(page.locator(".report-tabs")).toHaveCount(0);
  for (const name of sections)
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Stock value", exact: true }),
  ).toContainText("46,583.00");
  const graph = page.getByRole("group", { name: "Stock movements chart" });
  await expect(graph.getByRole("button")).toHaveCount(30);
  await graph.getByRole("button").nth(3).focus();
  await expect(page.locator(".report-trend-selection")).toContainText(
    "1 Oct 2026",
  );
  await expect(page.locator(".report-trend-selection")).toContainText("18 in");
  const current = page.getByRole("region", {
    name: "Stock & valuation",
    exact: true,
  });
  await expect(current.locator("tbody tr")).toHaveCount(5);
  await current.getByLabel("Next page").click();
  await expect(current).toContainText("Page 2 of 2");
  await expect(current.locator("tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Stock movements", exact: true }),
  ).toContainText("Page 1 of 2");
  await page.screenshot({
    path: test.info().outputPath("reports-desktop.png"),
    fullPage: true,
  });
  for (const width of [950, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("reports-mobile.png"),
    fullPage: true,
  });
  await graph.screenshot({
    path: test.info().outputPath("reports-mobile-chart.png"),
  });
  expect(errors).toEqual([]);
});

test("date filters update all activity sections and exports while current stock stays independent", async ({
  page,
}) => {
  const { requests } = await mockReports(page);
  const movements = page.getByRole("region", {
    name: "Stock movements",
    exact: true,
  });
  await movements.getByLabel("Next page").click();
  await expect(movements).toContainText("Page 2 of 2");
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-07");
  await page.getByRole("button", { name: "Apply dates", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Stock movements chart" })
      .getByRole("button"),
  ).toHaveCount(7);
  await expect(movements).toContainText("Page 1 of 2");
  for (const kind of ["movements", "reasons", "repairs", "sales"]) {
    const request = requests
      .filter(
        (url) =>
          url.pathname.endsWith("/reports") &&
          url.searchParams.get("kind") === kind,
      )
      .at(-1)!;
    expect(request.searchParams.get("from")).toBe("2026-10-01");
    expect(request.searchParams.get("to")).toBe("2026-10-07");
    expect(request.searchParams.get("page")).toBe("1");
  }
  for (const kind of ["current", "low"]) {
    const request = requests.find(
      (url) =>
        url.pathname.endsWith("/reports") &&
        url.searchParams.get("kind") === kind,
    )!;
    expect(request.searchParams.has("from")).toBe(false);
  }
  await page.getByLabel("Export report").selectOption("repairs");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("inventory-repairs.csv");
  const exported = requests
    .filter((url) => url.searchParams.get("format") === "csv")
    .at(-1)!;
  expect(exported.searchParams.get("from")).toBe("2026-10-01");
  expect(exported.searchParams.has("per_page")).toBe(false);
  await page.getByRole("button", { name: "Last 30 days", exact: true }).click();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(
    "2026-09-28",
  );
  await expect(
    page
      .getByRole("group", { name: "Stock movements chart" })
      .getByRole("button"),
  ).toHaveCount(30);
});

test("empty charts retry a summary failure and single-day or two-day periods fit mobile", async ({
  page,
}) => {
  const state = await mockReports(page, { empty: true, fail: true });
  await expect(page.getByRole("alert")).toContainText(
    "Report summary temporarily unavailable",
  );
  await expect(
    page.getByRole("region", { name: "Stock & valuation", exact: true }),
  ).toContainText("No items to report");
  state.allowLoading();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("No stock movements in this period.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  for (const from of ["2026-10-27", "2026-10-26"]) {
    await page.getByLabel("From", { exact: true }).fill(from);
    await page
      .getByRole("button", { name: "Apply dates", exact: true })
      .click();
    await expect(
      page
        .getByRole("group", { name: "Stock movements chart" })
        .getByRole("button"),
    ).toHaveCount(from.endsWith("27") ? 1 : 2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".report-trend-svg")).not.toHaveAttribute(
      "viewBox",
      /NaN/,
    );
  }
});

test("live reports load all sections, graphs and a complete stock CSV", async ({
  page,
}) => {
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
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.locator(".inventory-reports .loading")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const name of sections)
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Stock movements chart" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("inventory-current.csv");
  await page.screenshot({
    path: test.info().outputPath("live-reports-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("live-reports-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
