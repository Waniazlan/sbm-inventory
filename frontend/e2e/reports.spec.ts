import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import type { ReportOverview } from "../src/components/ReportCharts";

async function mockReports(
  page: Page,
  options: {
    empty?: boolean;
    fail?: boolean;
    supplierReturns?: ReportOverview["supplier_returns"];
  } = {},
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
  const supplierReturns = Array.from({ length: 7 }, (_, index) => {
    const status = ["process", "delivered", "rejected"][index % 3];
    return {
      Return: `SR-${String(index + 1).padStart(6, "0")}`,
      SKU: stock[index].SKU,
      Name: stock[index].Name,
      Supplier: "Original Parts Supplier",
      Status: status,
      Quantity: [2, 1, 2, 3, 3, 1, 4][index],
      Classification:
        status === "process"
          ? "Frozen"
          : status === "rejected"
            ? "Loss"
            : "Supplier return",
      "Loss value (sen)":
        status === "rejected" ? (index === 2 ? 13500 : 2925) : 0,
      "Created at": "2026-10-26T11:30:00+08:00",
    };
  });
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
      const series: { date: string; stock_in: number; stock_out: number }[] =
        [];
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
          supplier_returns:
            options.supplierReturns ??
            (options.empty
              ? {
                  process: { returns: 0, quantity: 0 },
                  delivered: { returns: 0, quantity: 0 },
                  rejected: { returns: 0, quantity: 0 },
                  loss: { quantity: 0, value: 0 },
                }
              : {
                  process: { returns: 3, quantity: 9 },
                  delivered: { returns: 2, quantity: 4 },
                  rejected: { returns: 2, quantity: 3 },
                  loss: { quantity: 3, value: 16425 },
                }),
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
          body:
            kind === "supplier_returns"
              ? "Return,SKU,Status,Quantity,Classification,Loss value (sen)\nSR-000003,PRN-000003,rejected,2,Loss,13500\n"
              : "SKU,Name\nPRN-000001,Screen\n",
        });
      const all = options.empty
        ? []
        : kind === "current" || kind === "valuation"
          ? stock
          : kind === "low"
            ? stock.slice(0, 2)
            : kind === "supplier_returns"
              ? supplierReturns
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
  "Supplier returns",
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
  const summary = page.getByRole("region", { name: "Supplier return summary" });
  await expect(summary).toContainText("Current snapshot");
  for (const [status, quantity, records] of [
    ["Processing", "9 units", "3 returns"],
    ["Delivered", "4 units", "2 returns"],
    ["Rejected", "3 units", "2 returns"],
  ]) {
    const metric = summary.getByRole("region", { name: status, exact: true });
    await expect(metric).toContainText(quantity);
    await expect(metric).toContainText(records);
  }
  const loss = summary.getByRole("region", { name: "Rejected stock loss" });
  await expect(loss).toContainText("164.25");
  await expect(loss).toContainText("3 units");
  await expect(loss).toContainText("Original batch costs");
  const statusChart = summary.getByRole("group", {
    name: "Supplier return status pie chart",
  });
  await expect(
    statusChart.getByRole("img", {
      name: "Processing: 9 units, 56.3%; Delivered: 4 units, 25%; Rejected: 3 units, 18.8%",
      exact: true,
    }),
  ).toBeVisible();
  await expect(statusChart.locator("svg [data-status]")).toHaveCount(3);
  const statusLegend = statusChart.getByRole("list", {
    name: "Return status breakdown",
  });
  const processing = statusLegend.getByRole("button", {
    name: "Processing: 9 units, 56.3%",
    exact: true,
  });
  const delivered = statusLegend.getByRole("button", {
    name: "Delivered: 4 units, 25%",
    exact: true,
  });
  const rejected = statusLegend.getByRole("button", {
    name: "Rejected: 3 units, 18.8%",
    exact: true,
  });
  await expect(processing).toHaveAttribute("aria-pressed", "true");
  await expect(statusChart.getByRole("status")).toHaveText(
    /Processing.*9 units.*56\.3%/,
  );
  await processing.focus();
  await page.keyboard.press("Tab");
  await expect(delivered).toBeFocused();
  await expect(delivered).toHaveAttribute("aria-pressed", "true");
  await expect(processing).toHaveAttribute("aria-pressed", "false");
  await expect(statusChart.getByRole("status")).toHaveText(
    /Delivered.*4 units.*25%/,
  );
  await rejected.click();
  await expect(rejected).toHaveAttribute("aria-pressed", "true");
  await expect(delivered).toHaveAttribute("aria-pressed", "false");
  await expect(statusChart.getByRole("status")).toHaveText(
    /Rejected.*3 units.*18\.8%/,
  );
  const returns = page.getByRole("region", {
    name: "Supplier returns",
    exact: true,
  });
  await expect(returns.locator("tbody tr")).toHaveCount(5);
  for (const [returnNumber, status, classification] of [
    ["SR-000001", "Processing", "Frozen"],
    ["SR-000002", "Delivered", "Supplier return"],
    ["SR-000003", "Rejected", "Loss"],
  ]) {
    const row = returns.getByRole("row").filter({ hasText: returnNumber });
    await expect(
      row.getByRole("cell", { name: status, exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("cell", { name: classification, exact: true }),
    ).toBeVisible();
    await expect(row).toContainText("26 Oct 2026");
  }
  await expect(
    returns.getByRole("row").filter({ hasText: "SR-000003" }),
  ).toContainText("135.00");
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
  await returns.getByLabel("Next page").click();
  await expect(returns).toContainText("Page 2 of 2");
  await expect(returns.locator("tbody tr")).toHaveCount(2);
  await expect(returns).toContainText("29.25");
  await expect(current).toContainText("Page 2 of 2");
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
  await statusChart.screenshot({
    path: test.info().outputPath("reports-mobile-status-pie.png"),
  });
  expect(errors).toEqual([]);
});

test("date filters update activity and exports while stock and supplier returns stay independent", async ({
  page,
}) => {
  const { requests } = await mockReports(page);
  const movements = page.getByRole("region", {
    name: "Stock movements",
    exact: true,
  });
  await movements.getByLabel("Next page").click();
  await expect(movements).toContainText("Page 2 of 2");
  const returns = page.getByRole("region", {
    name: "Supplier returns",
    exact: true,
  });
  await returns.getByLabel("Next page").click();
  await expect(returns).toContainText("Page 2 of 2");
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-07");
  await page.getByRole("button", { name: "Apply dates", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Stock movements chart" })
      .getByRole("button"),
  ).toHaveCount(7);
  await expect(movements).toContainText("Page 1 of 2");
  await expect(returns).toContainText("Page 2 of 2");
  await expect(
    page.getByRole("region", { name: "Rejected stock loss", exact: true }),
  ).toContainText("164.25");
  const statusLegend = page.getByRole("list", {
    name: "Return status breakdown",
  });
  for (const name of [
    "Processing: 9 units, 56.3%",
    "Delivered: 4 units, 25%",
    "Rejected: 3 units, 18.8%",
  ]) {
    await expect(
      statusLegend.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }
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
  for (const kind of ["current", "low", "supplier_returns"]) {
    const request = requests.find(
      (url) =>
        url.pathname.endsWith("/reports") &&
        url.searchParams.get("kind") === kind,
    )!;
    expect(request.searchParams.has("from")).toBe(false);
    expect(request.searchParams.has("to")).toBe(false);
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

test("supplier return CSV exports include rejected loss and ignore the activity period", async ({
  page,
}) => {
  const { requests } = await mockReports(page);
  await page.getByLabel("From", { exact: true }).fill("2026-01-01");
  await page.getByLabel("To", { exact: true }).fill("2026-01-02");
  await page.getByRole("button", { name: "Apply dates", exact: true }).click();
  await page.getByLabel("Export report").selectOption("supplier_returns");
  for (const button of [
    page.getByRole("button", { name: "Export CSV", exact: true }),
    page.getByRole("button", {
      name: "Export Supplier returns CSV",
      exact: true,
    }),
  ]) {
    const downloaded = page.waitForEvent("download");
    await button.click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("inventory-supplier_returns.csv");
    const csv = fs.readFileSync((await download.path())!, "utf8");
    expect(csv).toContain("Classification,Loss value (sen)");
    expect(csv).toContain("rejected,2,Loss,13500");
    const exported = requests
      .filter((url) => url.searchParams.get("format") === "csv")
      .at(-1)!;
    expect(exported.searchParams.get("kind")).toBe("supplier_returns");
    expect(exported.searchParams.has("from")).toBe(false);
    expect(exported.searchParams.has("to")).toBe(false);
    expect(exported.searchParams.has("per_page")).toBe(false);
  }
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
  const summary = page.getByRole("region", { name: "Supplier return summary" });
  for (const status of ["Processing", "Delivered", "Rejected"]) {
    const metric = summary.getByRole("region", { name: status, exact: true });
    await expect(metric).toContainText("0 units");
    await expect(metric).toContainText("0 returns");
  }
  const statusChart = summary.getByRole("group", {
    name: "Supplier return status pie chart",
  });
  await expect(statusChart).toContainText("No supplier returns to chart.");
  await expect(statusChart.locator("svg [data-status]")).toHaveCount(0);
  const statusLegend = statusChart.getByRole("list", {
    name: "Return status breakdown",
  });
  for (const status of ["Processing", "Delivered", "Rejected"]) {
    const button = statusLegend.getByRole("button", {
      name: `${status}: 0 units, 0%`,
      exact: true,
    });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }
  const loss = summary.getByRole("region", { name: "Rejected stock loss" });
  await expect(loss).toContainText("0.00");
  await expect(loss).toContainText("0 units");
  await expect(
    page.getByRole("region", { name: "Supplier returns", exact: true }),
  ).toContainText("No supplier returns");
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

test("a single return status renders a full pie and keeps zero-status quantities visible", async ({
  page,
}) => {
  await mockReports(page, {
    supplierReturns: {
      process: { returns: 0, quantity: 0 },
      delivered: { returns: 2, quantity: 4 },
      rejected: { returns: 0, quantity: 0 },
      loss: { quantity: 0, value: 0 },
    },
  });
  const chart = page.getByRole("group", {
    name: "Supplier return status pie chart",
  });
  await expect(chart.getByRole("img")).toHaveAccessibleName(
    "Processing: 0 units, 0%; Delivered: 4 units, 100%; Rejected: 0 units, 0%",
  );
  await expect(chart.locator("svg [data-status]")).toHaveCount(1);
  const slice = chart.locator('svg [data-status="delivered"]');
  const bounds = await slice.evaluate((element) => {
    const bounds = (element as SVGGraphicsElement).getBBox();
    return { width: bounds.width, height: bounds.height };
  });
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeCloseTo(bounds.width, 3);
  await expect(
    chart.getByRole("button", {
      name: "Delivered: 4 units, 100%",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(chart.getByRole("status")).toHaveText(
    /Delivered.*4 units.*100%/,
  );
  for (const name of ["Processing: 0 units, 0%", "Rejected: 0 units, 0%"]) {
    await expect(
      chart.getByRole("button", { name, exact: true }),
    ).toBeVisible();
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
  const overviewResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/reports/overview") &&
      response.ok(),
  );
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  const overview = (await (await overviewResponse).json()) as ReportOverview;
  await expect(page.locator(".inventory-reports .loading")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const name of sections)
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Stock movements chart" }),
  ).toBeVisible();
  const summary = page.getByRole("region", { name: "Supplier return summary" });
  const statusChart = summary.getByRole("group", {
    name: "Supplier return status pie chart",
  });
  await expect(statusChart).toBeVisible();
  const totalReturned =
    overview.supplier_returns.process.quantity +
    overview.supplier_returns.delivered.quantity +
    overview.supplier_returns.rejected.quantity;
  const percentage = new Intl.NumberFormat("en-MY", {
    style: "percent",
    maximumFractionDigits: 1,
  });
  for (const [status, key] of [
    ["Processing", "process"],
    ["Delivered", "delivered"],
    ["Rejected", "rejected"],
  ] as const) {
    const totals = overview.supplier_returns[key];
    const metric = summary.getByRole("region", { name: status, exact: true });
    await expect(metric.locator("strong")).toHaveText(
      `${totals.quantity.toLocaleString("en-MY")} unit${totals.quantity === 1 ? "" : "s"}`,
    );
    await expect(metric.locator("small")).toContainText(
      `${totals.returns.toLocaleString("en-MY")} return${totals.returns === 1 ? "" : "s"}`,
    );
    const units = `${totals.quantity.toLocaleString("en-MY")} unit${totals.quantity === 1 ? "" : "s"}`;
    const share = percentage.format(
      totalReturned ? totals.quantity / totalReturned : 0,
    );
    await expect(
      statusChart.getByRole("button", {
        name: `${status}: ${units}, ${share}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(statusChart.locator(`svg [data-status="${key}"]`)).toHaveCount(
      totals.quantity > 0 ? 1 : 0,
    );
  }
  const loss = summary.getByRole("region", { name: "Rejected stock loss" });
  await expect(loss.locator("strong")).toHaveText(
    new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(overview.supplier_returns.loss.value / 100),
  );
  await expect(loss.locator("small")).toContainText(
    `${overview.supplier_returns.loss.quantity.toLocaleString("en-MY")} unit`,
  );
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
