import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const barcode = "0012345678901234";
function fixturePath(name: string) {
  return new URL(`./fixtures/${name}`, import.meta.url).pathname;
}

function fixtureImage(name: string) {
  const mimeType = name.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
  return `data:${mimeType};base64,${fs.readFileSync(fixturePath(name)).toString("base64")}`;
}

async function expectCameraState(page: Page, state: MediaStreamTrackState) {
  expect(
    await page.evaluate(
      (expected) =>
        (
          window as unknown as { cameraTracks: MediaStreamTrack[] }
        ).cameraTracks.every((track) => track.readyState === expected),
      state,
    ),
  ).toBe(true);
}

const fixture = fixturePath(`barcode-${barcode}.svg`);
const imageUrl = fixtureImage(`barcode-${barcode}.svg`);
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

// Actual label images supplied to reproduce scanning failures.
for (const [name, value] of [
  ["numeric", "1234567891023456"],
  ["alphanumeric", "ASL1209876543127"],
]) {
  for (const mode of ["camera", "photo"] as const) {
    test(`reads supplied ${name} sample through ${mode}`, async ({ page }) => {
      const file = fixturePath(`barcode-sample-${name}.jpeg`);
      const image = fixtureImage(`barcode-sample-${name}.jpeg`);
      await setup(page, mode === "camera" ? "photo" : "denied", image);
      await page.getByRole("button", { name: "Scan barcode" }).click();
      if (mode === "photo") {
        await page.getByLabel("Choose barcode photo").setInputFiles(file);
      }
      await expect(
        page.getByLabel("Review barcode (letters and numbers)"),
      ).toHaveValue(value);
      await expect(
        page.getByRole("button", { name: "Find item" }),
      ).toBeEnabled();
      if (mode === "camera") await expectCameraState(page, "ended");
      const lookup = page.waitForRequest(
        (request) =>
          new URL(request.url()).searchParams.get("barcode") === value,
      );
      await page.getByRole("button", { name: "Find item" }).click();
      await lookup;
    });
  }
}

async function setup(
  page: Page,
  camera: "photo" | "denied" | "blank" | "angled" | "delayed" = "photo",
  cameraImage = imageUrl,
) {
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
          canvas.getContext("2d")!.fillRect(0, 0, canvas.width, canvas.height);
          if (camera !== "blank" && camera !== "delayed")
            canvas.getContext("2d")!.drawImage(img, 0, 0);
          if (camera === "delayed") {
            setTimeout(
              () => canvas.getContext("2d")!.drawImage(img, 0, 0),
              1500,
            );
          }
          if (camera === "angled") {
            canvas.width = 1000;
            canvas.height = 1000;
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, 1000, 1000);
            ctx.translate(500, 500);
            ctx.rotate(Math.PI / 4);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
          }
          const stream = canvas.captureStream(5);
          (
            window as unknown as { cameraTracks: MediaStreamTrack[] }
          ).cameraTracks = stream.getTracks();
          return stream;
        },
      });
    },
    { imageUrl: cameraImage, camera },
  );
  await page.goto("/catalogue");
  await expect(
    page.getByRole("heading", { name: "Item catalogue" }),
  ).toBeVisible();
}

test("automatically detect real barcode pixels, confirm, and save the exact string", async ({
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
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue(barcode);
  await expectCameraState(page, "ended");
  await page.getByRole("button", { name: "Use barcode" }).click();
  await expect(
    page.getByLabel("Item barcode (letters and numbers)"),
  ).toHaveValue(barcode);
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/items"),
  );
  await page.getByRole("button", { name: "Save item" }).click();
  expect((await saved).postDataJSON().barcode).toBe(barcode);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("photo fallback, shorter barcode, exact lookup and unknown barcode", async ({
  page,
}) => {
  await setup(page, "denied");
  await page.getByLabel("Category", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(page.getByRole("alert")).toContainText("Camera unavailable");
  await page
    .getByLabel("Choose barcode photo")
    .setInputFiles(fixturePath("barcode-00123456789012.svg"));
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue("00123456789012");
  await expect(page.getByRole("button", { name: "Find item" })).toBeEnabled();
  await page.getByLabel("Choose barcode photo").setInputFiles(fixture);
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue(barcode);
  const lookup = page.waitForRequest((request) =>
    request.url().includes(`barcode=${barcode}`),
  );
  await page.getByRole("button", { name: "Find item" }).click();
  expect((await lookup).url()).not.toContain("category_id");
  await expect(
    page.getByRole("row").filter({ hasText: barcode }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await page
    .getByLabel("Review barcode (letters and numbers)")
    .fill("9999999999999999");
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
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue(barcode);
  await page.getByRole("button", { name: "Scan again" }).click();
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue(barcode);
  await page.keyboard.press("Escape");
  await expect(
    page.getByLabel("Item barcode (letters and numbers)"),
  ).toHaveValue(barcode);
  await expectCameraState(page, "ended");
});

test("mobile scanner fits and handles an unreadable photo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, "denied");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await page.getByLabel("Choose barcode photo").setInputFiles({
    name: "blank.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300"><rect width="640" height="300" fill="white"/></svg>',
    ),
  });
  await expect(page.getByRole("alert")).toContainText("No readable barcode");
  await page.getByLabel("Choose barcode photo").setInputFiles(fixture);
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue(barcode);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Find item" }),
  ).toBeInViewport();
});

test("manual entry and cancellation stop the camera while searching", async ({
  page,
}) => {
  await setup(page, "blank");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(
    page.getByText("Scanning automatically…", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Review barcode (letters and numbers)").fill(barcode);
  await expectCameraState(page, "ended");
  await page.getByRole("button", { name: "Retry camera" }).click();
  await expect(
    page.getByText("Scanning automatically…", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectCameraState(page, "ended");
});

test("automatically captures a diagonal barcode in the camera frame", async ({
  page,
}) => {
  await setup(page, "angled");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue(barcode);
});

test("automatically captures shorter numeric barcodes", async ({ page }) => {
  await setup(page, "photo", fixtureImage("barcode-00123456789012.svg"));
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue("00123456789012");
  await expect(page.getByRole("button", { name: "Find item" })).toBeEnabled();
});

for (const [format, value] of [
  ["code128", "00AbC123xyZ"],
  ["code39", "SBM001234"],
]) {
  test(`automatically captures ${format} letters and numbers after empty frames and saves them`, async ({
    page,
  }) => {
    await setup(
      page,
      "delayed",
      fixtureImage(`barcode-${format}-${value}.svg`),
    );
    await page.getByRole("button", { name: "Add item" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Scan barcode" })
      .click();
    await expect(
      page.getByText("Scanning automatically…", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Review barcode (letters and numbers)"),
    ).toHaveValue(value);
    await page.getByRole("button", { name: "Use barcode" }).click();
    await expect(
      page.getByLabel("Item barcode (letters and numbers)"),
    ).toHaveValue(value);
    await page
      .getByLabel("Item name", { exact: true })
      .fill("Alphanumeric scanned item");
    await page.getByLabel("SKU", { exact: true }).fill("ALPHA01");
    await page.getByLabel("Component category").selectOption("1");
    const saved = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/items"),
    );
    await page.getByRole("button", { name: "Save item" }).click();
    expect((await saved).postDataJSON().barcode).toBe(value);
  });
}

test("alphanumeric photo lookup preserves letter case and leading zeroes", async ({
  page,
}) => {
  await setup(page, "denied");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await page
    .getByLabel("Choose barcode photo")
    .setInputFiles(fixturePath("barcode-code128-00AbC123xyZ.svg"));
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue("00AbC123xyZ");
  const lookup = page.waitForRequest(
    (request) =>
      new URL(request.url()).searchParams.get("barcode") === "00AbC123xyZ",
  );
  await page.getByRole("button", { name: "Find item" }).click();
  await lookup;
});

test("reads a barcode photo with a transparent background", async ({
  page,
}) => {
  await setup(page, "denied");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await page.getByLabel("Choose barcode photo").setInputFiles({
    name: "transparent-barcode.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      fs.readFileSync(fixture, "utf8").replace('fill="white"', 'fill="none"'),
    ),
  });
  await expect(
    page.getByLabel("Review barcode (letters and numbers)"),
  ).toHaveValue(barcode);
});

test("invalid decoded characters stay visible and do not stop live scanning", async ({
  page,
}) => {
  await setup(page, "photo", fixtureImage("barcode-code128-ABC-123.svg"));
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(page.getByRole("alert")).toContainText('Detected "ABC-123"');
  await expect(page.getByRole("button", { name: "Find item" })).toBeDisabled();
  await expectCameraState(page, "live");
});
