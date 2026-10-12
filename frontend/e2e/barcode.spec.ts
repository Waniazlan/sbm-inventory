import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const barcode = "0012345678901234";
const fixture = new URL(`./fixtures/barcode-${barcode}.svg`, import.meta.url)
  .pathname;
const imageUrl = `data:image/svg+xml;base64,${fs.readFileSync(fixture).toString("base64")}`;
const item = {
  id: 1,
  sku: "SCAN-01",
  barcode,
  name: "Barcode preview battery",
  category_id: 1,
  category: { id: 1, name: "Battery" },
  supplier_id: null,
  supplier: null,
  phone_models: [],
  unit: "piece",
  cost: 1200,
  price: 2500,
  stock: 5,
  minimum_stock: 2,
  active: true,
};

async function setup(page: Page, camera: "photo" | "denied" = "photo") {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const query = new URL(route.request().url()).searchParams;
    let body: unknown;
    if (path.endsWith("/auth/me"))
      body = { id: 1, name: "Preview admin", role: "admin", active: true };
    else if (path.endsWith("/metadata"))
      body = {
        categories: [item.category],
        suppliers: [],
        phone_models: [],
        timezone: "Asia/Kuala_Lumpur",
      };
    else if (path.endsWith("/items") && route.request().method() === "GET") {
      const data =
        query.has("barcode") && query.get("barcode") !== barcode ? [] : [item];
      body = { data, total: data.length, current_page: 1, last_page: 1 };
    } else if (route.request().method() === "POST")
      body = { ...item, ...route.request().postDataJSON() };
    else return route.abort();
    await route.fulfill({ json: body });
  });
  await page.addInitScript(
    async ({ imageUrl, camera }) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          if (camera === "denied")
            throw new DOMException("Denied", "NotAllowedError");
          const img = new Image();
          img.src = imageUrl;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext("2d")!.drawImage(img, 0, 0);
          const stream = canvas.captureStream(5);
          (
            window as unknown as { cameraTracks: MediaStreamTrack[] }
          ).cameraTracks = stream.getTracks();
          return stream;
        },
      });
    },
    { imageUrl, camera },
  );
  await page.goto("/catalogue");
  await expect(
    page.getByRole("heading", { name: "Item catalogue" }),
  ).toBeVisible();
}

test("snap real barcode pixels, confirm, and save the exact string", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item name").fill("Camera captured part");
  await page.getByLabel("SKU", { exact: true }).fill("CAMERA-01");
  await page.getByLabel("Component category").selectOption("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Scan barcode" })
    .click();
  await expect(
    page.getByRole("button", { name: "Snap barcode" }),
  ).toBeEnabled();
  await page.screenshot({ path: "../docs/screenshots/barcode-camera.png" });
  await page.getByRole("button", { name: "Snap barcode" }).click();
  await expect(page.getByLabel("Review barcode (16 digits)")).toHaveValue(
    barcode,
  );
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { cameraTracks: MediaStreamTrack[] }
      ).cameraTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
  await page.screenshot({ path: "../docs/screenshots/barcode-review.png" });
  await page.getByRole("button", { name: "Use barcode" }).click();
  await expect(page.getByLabel("Item barcode (16 digits)")).toHaveValue(
    barcode,
  );
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/items"),
  );
  await page.getByRole("button", { name: "Save item" }).click();
  expect((await saved).postDataJSON().barcode).toBe(barcode);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("photo fallback, invalid length, exact lookup and unknown barcode", async ({
  page,
}) => {
  await setup(page, "denied");
  await page.getByLabel("Category", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(page.getByRole("alert")).toContainText("Camera unavailable");
  await page
    .getByLabel("Choose barcode photo")
    .setInputFiles(
      new URL("./fixtures/barcode-00123456789012.svg", import.meta.url)
        .pathname,
    );
  await expect(page.getByRole("alert")).toContainText(
    "does not contain exactly 16 digits",
  );
  await expect(page.getByRole("button", { name: "Find item" })).toBeDisabled();
  await page.getByLabel("Choose barcode photo").setInputFiles(fixture);
  await expect(page.getByLabel("Review barcode (16 digits)")).toHaveValue(
    barcode,
  );
  const lookup = page.waitForRequest((request) =>
    request.url().includes(`barcode=${barcode}`),
  );
  await page.getByRole("button", { name: "Find item" }).click();
  expect((await lookup).url()).not.toContain("category_id");
  await expect(
    page.getByRole("row").filter({ hasText: barcode }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await page.getByLabel("Review barcode (16 digits)").fill("9999999999999999");
  await page.getByRole("button", { name: "Find item" }).click();
  await expect(
    page.getByText("Barcode not assigned", { exact: true }),
  ).toBeVisible();
});

test("retake and cancel stop the camera without replacing the saved barcode", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Scan barcode" })
    .click();
  await expect(
    page.getByRole("button", { name: "Snap barcode" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Snap barcode" }).click();
  await expect(page.getByLabel("Review barcode (16 digits)")).toHaveValue(
    barcode,
  );
  await page.getByRole("button", { name: "Retake photo" }).click();
  await expect(page.getByLabel("Review barcode (16 digits)")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Snap barcode" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Item barcode (16 digits)")).toHaveValue(
    barcode,
  );
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { cameraTracks: MediaStreamTrack[] }
      ).cameraTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
});

test("mobile scanner fits and handles an unreadable photo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, "denied");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await page
    .getByLabel("Choose barcode photo")
    .setInputFiles({
      name: "blank.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300"><rect width="640" height="300" fill="white"/></svg>',
      ),
    });
  await expect(page.getByRole("alert")).toContainText("No readable barcode");
  await page.getByLabel("Choose barcode photo").setInputFiles(fixture);
  await expect(page.getByLabel("Review barcode (16 digits)")).toHaveValue(
    barcode,
  );
  await page.screenshot({ path: "../docs/screenshots/barcode-mobile.png" });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Find item" }),
  ).toBeInViewport();
});
