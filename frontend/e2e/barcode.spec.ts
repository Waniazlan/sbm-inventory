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
const productBarcodes: { name: string; format: string; value: string }[] =
  JSON.parse(fs.readFileSync(fixturePath("product-barcodes.json"), "utf8"));

// Decode actual barcode pixels using an independent encoder's fixtures.
for (const { name, value } of productBarcodes) {
  for (const mode of ["camera", "photo"] as const) {
    test(`reads product ${name} through ${mode} and preserves exact lookup`, async ({
      page,
    }) => {
      await setup(
        page,
        mode === "camera" ? "photo" : "denied",
        fixtureImage(`product-${name}.svg`),
      );
      await page.getByRole("button", { name: "Scan barcode" }).click();
      if (mode === "photo") {
        await page
          .getByLabel("Choose barcode photo")
          .setInputFiles(fixturePath(`product-${name}.svg`));
      }
      await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
        value,
      );
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
      await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
        value,
      );
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
    else if (path.endsWith("/items/options"))
      body = [item, { ...item, id: 2, sku: "PRN-000002", name: "LCD screen" }];
    else if (path.endsWith("/items") && route.request().method() === "GET") {
      const data =
        query.has("barcode") && query.get("barcode") !== barcode ? [] : [item];
      body = { data, total: data.length, current_page: 1, last_page: 1 };
    } else if (route.request().method() === "POST")
      body = { ...item, ...route.request().postDataJSON(), sku: "PRN-000001" };
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
  await page.getByLabel("Component category").selectOption("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Scan barcode" })
    .click();
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    barcode,
  );
  await expectCameraState(page, "ended");
  await page.getByRole("button", { name: "Use barcode" }).click();
  await expect(page.getByLabel("Item barcode or QR value")).toHaveValue(
    barcode,
  );
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/items"),
  );
  await page.getByRole("button", { name: "Save item" }).click();
  const payload = (await saved).postDataJSON();
  expect(payload.barcode).toBe(barcode);
  expect(payload).not.toHaveProperty("sku");
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
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    "00123456789012",
  );
  await expect(page.getByRole("button", { name: "Find item" })).toBeEnabled();
  await page.getByLabel("Choose barcode photo").setInputFiles(fixture);
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
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
  await page.getByLabel("Review barcode or QR value").fill("9999999999999999");
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
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    barcode,
  );
  await page.getByRole("button", { name: "Scan again" }).click();
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    barcode,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Item barcode or QR value")).toHaveValue(
    barcode,
  );
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
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    barcode,
  );
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
  await page.getByLabel("Review barcode or QR value").fill(barcode);
  await expectCameraState(page, "ended");
  await page.getByRole("button", { name: "Retry camera" }).click();
  await expect(
    page.getByText("Scanning automatically…", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectCameraState(page, "ended");
});

test("automatically captures a diagonal barcode in the camera frame", async ({
  page,
}) => {
  await setup(page, "angled");
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    barcode,
  );
});

test("automatically captures shorter numeric barcodes", async ({ page }) => {
  await setup(page, "photo", fixtureImage("barcode-00123456789012.svg"));
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    "00123456789012",
  );
  await expect(page.getByRole("button", { name: "Find item" })).toBeEnabled();
});

for (const [format, value, file] of [
  ["code128", "00AbC123xyZ", "barcode-code128-00AbC123xyZ.svg"],
  ["code39", "SBM001234", "barcode-code39-SBM001234.svg"],
  ["QR", "BMIP13(IC)INCB", "product-qr-screen.svg"],
]) {
  test(`automatically captures ${format} product values after empty frames and saves them`, async ({
    page,
  }) => {
    await setup(page, "delayed", fixtureImage(file));
    await page.getByRole("button", { name: "Add item" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Scan barcode" })
      .click();
    await expect(
      page.getByText("Scanning automatically…", { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
      value,
    );
    await page.getByRole("button", { name: "Use barcode" }).click();
    await expect(page.getByLabel("Item barcode or QR value")).toHaveValue(
      value,
    );
    await page
      .getByLabel("Item name", { exact: true })
      .fill("Alphanumeric scanned item");
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
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    "00AbC123xyZ",
  );
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
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    barcode,
  );
});

test("punctuation in a product barcode is captured and accepted", async ({
  page,
}) => {
  await setup(page, "photo", fixtureImage("barcode-code128-ABC-123.svg"));
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(page.getByLabel("Review barcode or QR value")).toHaveValue(
    "ABC-123",
  );
  await expect(page.getByRole("button", { name: "Find item" })).toBeEnabled();
  await expectCameraState(page, "ended");
});

test("control characters are rejected without stopping live scanning", async ({
  page,
}) => {
  await setup(page, "photo", fixtureImage("product-control-character.svg"));
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "without line breaks or control characters",
  );
  await expect(page.getByRole("button", { name: "Find item" })).toBeDisabled();
  await expectCameraState(page, "live");
});

test("existing item SKU is read-only and excluded from updates", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const sku = page.getByLabel("SKU", { exact: true });
  await expect(sku).toHaveValue(item.sku);
  await expect(sku).toHaveAttribute("readonly", "");
  await page.route("**/api/v1/items/1", async (route) => {
    expect(route.request().postDataJSON()).not.toHaveProperty("sku");
    await route.fulfill({ json: item });
  });
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const [format, file, serial] of [
  ["linear", "barcode-code128-ABC-123.svg", "ABC-123"],
  ["QR", "product-qr-screen.svg", "BMIP13(IC)INCB"],
]) {
  for (const mode of ["camera", "photo"] as const) {
    test(`receipt appends a ${format} serial through ${mode} and saves the exact list`, async ({
      page,
    }) => {
      await setup(
        page,
        mode === "camera" ? "photo" : "denied",
        fixtureImage(file),
      );
      await page.getByRole("button", { name: "Receive", exact: true }).click();
      const receipt = page.getByRole("dialog").filter({
        has: page.getByRole("heading", {
          name: "Receive stock",
          exact: true,
        }),
      });
      await receipt.getByLabel("Serial details").fill("SN-EXISTING");
      await receipt.getByLabel("Source reference").fill("SERIAL-RECEIPT");
      await receipt.getByLabel("Quantity", { exact: true }).fill("2");
      await receipt
        .getByRole("button", { name: "Scan serial", exact: true })
        .click();
      const scanner = page.getByRole("dialog").filter({
        has: page.getByRole("heading", {
          name: "Scan serial number",
          exact: true,
        }),
      });
      if (mode === "photo")
        await scanner
          .getByLabel("Choose serial photo")
          .setInputFiles(fixturePath(file));
      await expect(scanner.getByLabel("Review serial number")).toHaveValue(
        serial,
      );
      await scanner
        .getByRole("button", { name: "Use serial number", exact: true })
        .click();
      await expect(receipt.getByLabel("Serial details")).toHaveValue(
        `SN-EXISTING\n${serial}`,
      );
      if (mode === "camera") await expectCameraState(page, "ended");
      const posted = page.waitForRequest(
        (request) =>
          request.method() === "POST" && request.url().endsWith("/movements"),
      );
      await receipt
        .getByRole("button", { name: "Receive stock", exact: true })
        .click();
      const payload = (await posted).postDataJSON();
      expect(payload.items[0].serials).toBe(`SN-EXISTING\n${serial}`);
      expect(payload.items[0].quantity).toBe(2);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }
}

test("serial scanner cancellation, duplicates and length limit preserve receipt details on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, "photo", fixtureImage("barcode-code128-ABC-123.svg"));
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  const receipt = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Receive stock", exact: true }),
  });
  const details = receipt.getByLabel("Serial details");
  const scanner = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Scan serial number",
      exact: true,
    }),
  });
  await details.fill("ABC-123");
  await receipt
    .getByRole("button", { name: "Scan serial", exact: true })
    .click();
  await expect(scanner.getByLabel("Review serial number")).toHaveValue(
    "ABC-123",
  );
  await page.keyboard.press("Escape");
  await expect(details).toHaveValue("ABC-123");
  await expectCameraState(page, "ended");
  await receipt
    .getByRole("button", { name: "Scan serial", exact: true })
    .click();
  await expect(scanner.getByLabel("Review serial number")).toHaveValue(
    "ABC-123",
  );
  await scanner
    .getByRole("button", { name: "Use serial number", exact: true })
    .click();
  await expect(receipt.getByRole("alert")).toContainText("already listed");
  await expect(details).toHaveValue("ABC-123");
  const existing = "S".repeat(1995);
  await details.fill(existing);
  await receipt
    .getByRole("button", { name: "Scan serial", exact: true })
    .click();
  await expect(scanner.getByLabel("Review serial number")).toHaveValue(
    "ABC-123",
  );
  await scanner
    .getByRole("button", { name: "Use serial number", exact: true })
    .click();
  await expect(receipt.getByRole("alert")).toContainText("2,000 characters");
  await expect(details).toHaveValue(existing);
  expect(
    await receipt.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test("receipt form groups fields and keeps actions visible across desktop and mobile", async ({
  page,
}, testInfo) => {
  await setup(page, "denied");
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  const receipt = page.getByRole("dialog");
  for (const title of ["Delivery details", "Items"]) {
    await expect(
      receipt.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  }
  await expect(receipt.getByLabel("Reason", { exact: true })).toHaveCount(0);
  await receipt.getByLabel("Quantity", { exact: true }).fill("3");
  await receipt.getByLabel("Source reference").fill("DO-123");
  await receipt.getByLabel("Receipt unit cost (MYR)").fill("12.50");
  await receipt.getByLabel("Batch reference").fill("LOT-A");
  await receipt.getByLabel("Serial details").fill("SN001\nSN002\nSN003");
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      receipt.getByRole("button", { name: "Receive stock", exact: true }),
    ).toBeInViewport();
    await expect(
      receipt.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeInViewport();
    await expect(
      receipt.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeInViewport();
    expect(
      await receipt.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await receipt
      .getByLabel("Quantity", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`receipt-${width}.png`),
    });
    await expect(receipt.getByLabel("Serial details")).toHaveValue(
      "SN001\nSN002\nSN003",
    );
  }
  const posted = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/movements"),
  );
  await receipt
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  expect((await posted).postDataJSON()).toMatchObject({
    kind: "receipt",
    reference: "DO-123",
    items: [
      {
        item_id: item.id,
        quantity: 3,
        unit_cost: 1250,
        batch: "LOT-A",
        serials: "SN001\nSN002\nSN003",
      },
    ],
  });
});

test("multiple receipt items can be added, removed and scanned separately before one save", async ({
  page,
}, testInfo) => {
  await setup(page, "denied");
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  const receipt = page.getByRole("dialog");
  const row1 = receipt.getByRole("group", { name: "Item 1", exact: true });
  await expect(
    row1.getByRole("button", { name: "Remove item 1", exact: true }),
  ).toBeDisabled();
  await receipt.getByLabel("Source reference").fill("SUPPLIER-INV-100");
  await row1.getByLabel("Quantity", { exact: true }).fill("2");
  await row1.getByLabel("Receipt unit cost (MYR)").fill("12.50");
  await row1.getByLabel("Batch reference").fill("BAT-A");
  await row1.getByLabel("Serial details").fill("BAT-SN-1");
  await receipt.getByRole("button", { name: "Add item", exact: true }).click();
  await receipt.getByRole("button", { name: "Add item", exact: true }).click();
  await receipt
    .getByRole("group", { name: "Item 3", exact: true })
    .getByLabel("Batch reference")
    .fill("LCD-B");
  await receipt
    .getByRole("button", { name: "Remove item 2", exact: true })
    .click();
  const row2 = receipt.getByRole("group", { name: "Item 2", exact: true });
  await expect(row2.getByLabel("Batch reference")).toHaveValue("LCD-B");
  await row2
    .getByRole("combobox", { name: "Item", exact: true })
    .selectOption("2");
  await row2.getByLabel("Quantity", { exact: true }).fill("3");
  await row2.getByLabel("Receipt unit cost (MYR)").fill("55.00");
  await row2.getByRole("button", { name: "Scan serial", exact: true }).click();
  const scanner = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Scan serial number",
      exact: true,
    }),
  });
  await scanner
    .getByLabel("Choose serial photo")
    .setInputFiles(fixturePath("product-qr-screen.svg"));
  await expect(scanner.getByLabel("Review serial number")).toHaveValue(
    "BMIP13(IC)INCB",
  );
  await scanner
    .getByRole("button", { name: "Use serial number", exact: true })
    .click();
  await expect(row1.getByLabel("Serial details")).toHaveValue("BAT-SN-1");
  await expect(row2.getByLabel("Serial details")).toHaveValue("BMIP13(IC)INCB");
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await row2.getByLabel("Quantity", { exact: true }).scrollIntoViewIfNeeded();
    await expect(
      receipt.getByRole("button", { name: "Receive stock", exact: true }),
    ).toBeInViewport();
    expect(
      await receipt.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`multi-receipt-${width}.png`),
    });
  }
  const posted = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/movements"),
  );
  await receipt
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  expect((await posted).postDataJSON()).toMatchObject({
    kind: "receipt",
    reference: "SUPPLIER-INV-100",
    items: [
      {
        item_id: 1,
        quantity: 2,
        unit_cost: 1250,
        batch: "BAT-A",
        serials: "BAT-SN-1",
      },
      {
        item_id: 2,
        quantity: 3,
        unit_cost: 5500,
        batch: "LCD-B",
        serials: "BMIP13(IC)INCB",
      },
    ],
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("uncertain multi-item receipt retries the identical payload and locks editing", async ({
  page,
}) => {
  await setup(page, "denied");
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/v1/movements", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill(
      requests.length === 1
        ? { status: 500, json: { message: "Temporary failure" } }
        : { json: { acknowledged: true, movements: [] } },
    );
  });
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  const receipt = page.getByRole("dialog");
  await receipt.getByLabel("Source reference").fill("RETRY-100");
  await receipt.getByRole("button", { name: "Add item", exact: true }).click();
  await receipt
    .getByRole("group", { name: "Item 2", exact: true })
    .getByRole("combobox", { name: "Item", exact: true })
    .selectOption("2");
  await receipt
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(receipt.getByRole("alert")).toContainText("Temporary failure");
  await expect(
    receipt.getByRole("button", { name: "Add item", exact: true }),
  ).toBeDisabled();
  await expect(receipt.getByLabel("Source reference")).toBeDisabled();
  await receipt
    .getByRole("button", { name: "Retry same request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("row validation errors preserve receipt details and allow correction with a fresh key", async ({
  page,
}) => {
  await setup(page, "denied");
  const requests: Record<string, any>[] = [];
  await page.route("**/api/v1/movements", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill(
      requests.length === 1
        ? {
            status: 422,
            json: {
              errors: { "items.1.quantity": ["Check the quantity on item 2."] },
            },
          }
        : { json: { acknowledged: true, movements: [] } },
    );
  });
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  const receipt = page.getByRole("dialog");
  await receipt.getByLabel("Source reference").fill("VALIDATE-100");
  await receipt.getByRole("button", { name: "Add item", exact: true }).click();
  const row2 = receipt.getByRole("group", { name: "Item 2", exact: true });
  await row2
    .getByRole("combobox", { name: "Item", exact: true })
    .selectOption("2");
  await receipt
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(receipt.getByRole("alert")).toContainText(
    "Check the quantity on item 2.",
  );
  await expect(receipt.getByLabel("Source reference")).toHaveValue(
    "VALIDATE-100",
  );
  await expect(row2.getByLabel("Quantity", { exact: true })).toBeEnabled();
  await row2.getByLabel("Quantity", { exact: true }).fill("6");
  await receipt
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests[1].request_key).not.toBe(requests[0].request_key);
  expect(requests[1].items[1].quantity).toBe(6);
});

for (const kind of ["manual_out", "adjustment"]) {
  test(`existing ${kind} workflow retains single-item submission`, async ({
    page,
  }) => {
    await setup(page, "denied");
    await page.getByRole("button", { name: item.name, exact: true }).click();
    await page
      .getByRole("button", { name: "Issue or adjust stock", exact: true })
      .click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Movement type").selectOption(kind);
    if (kind === "adjustment") {
      await form.getByLabel("Actual quantity counted").fill("3");
      await form.getByLabel("Count reference").fill("COUNT-100");
    } else await form.getByLabel("Quantity", { exact: true }).fill("2");
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Existing movement workflow");
    const posted = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/movements"),
    );
    await form
      .getByRole("button", { name: "Record movement", exact: true })
      .click();
    const payload = (await posted).postDataJSON();
    expect(payload.kind).toBe(kind);
    expect(payload.item_id).toBe(item.id);
    expect(payload).not.toHaveProperty("items");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
