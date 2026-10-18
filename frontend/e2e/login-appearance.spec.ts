import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const mediaUrl =
  "/api/v1/login-background/media/7c30c348-c271-4fd9-83c9-ad313193f336";

async function mockSettings(
  page: Page,
  options: { loadFails?: boolean; saveFails?: boolean } = {},
) {
  let background: { kind: string; name: string; url: string } | null = null;
  let saves = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/login-background/media/"))
      return route.fulfill({ contentType: "image/png", body: png });
    if (path.endsWith("/settings/login-background")) {
      if (route.request().method() === "DELETE") background = null;
      else {
        saves++;
        if (options.saveFails)
          return route.fulfill({
            status: 503,
            json: {
              message: "Unable to save the login background. Please try again.",
            },
          });
        background = { kind: "image", name: "shop.png", url: mediaUrl };
      }
      return route.fulfill({ json: { data: background } });
    }
    if (path.endsWith("/login-background")) {
      if (options.loadFails) {
        return route.fulfill({
          status: 503,
          json: { message: "Background temporarily unavailable." },
        });
      }
      return route.fulfill({ json: { data: background } });
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
  await page
    .getByRole("button", { name: "User interface", exact: true })
    .click();
  return {
    saves: () => saves,
    allowLoading: () => {
      options.loadFails = false;
    },
  };
}

test("background preview can be cancelled, saved and restored on mobile", async ({
  page,
}, testInfo) => {
  const state = await mockSettings(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Save background" }),
  ).toBeDisabled();
  const file = { name: "shop.png", mimeType: "image/png", buffer: png };
  await page.getByLabel("Background file", { exact: true }).setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Save background" }),
  ).toBeEnabled();
  expect(state.saves()).toBe(0);
  await page.getByRole("button", { name: "Cancel preview" }).click();
  await expect(
    page.getByText("Animated aurora", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Background file", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "Save background" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Login background saved for everyone.",
  );
  expect(state.saves()).toBe(1);
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
  await page.getByRole("button", { name: "Restore animated default" }).click();
  await expect(page.getByRole("status")).toContainText(
    "animated default background has been restored",
  );
  await expect(page.locator(".login-background.has-media")).toHaveCount(0);
});

test("invalid file types and oversized images do not upload", async ({
  page,
}) => {
  const state = await mockSettings(page);
  await page.getByLabel("Background file", { exact: true }).setInputFiles({
    name: "unsafe.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a JPEG");
  await page.getByLabel("Background file", { exact: true }).setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("10 MB or smaller");
  expect(state.saves()).toBe(0);
});

test("settings can retry loading and preserve the preview after a failed save", async ({
  page,
}) => {
  const state = await mockSettings(page, { loadFails: true, saveFails: true });
  await expect(page.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  state.allowLoading();
  await page.getByRole("button", { name: "Try again" }).click();
  await page
    .getByLabel("Background file", { exact: true })
    .setInputFiles({ name: "shop.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Save background" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to save");
  await expect(
    page.getByRole("button", { name: "Save background" }),
  ).toBeEnabled();
  await expect(page.getByText("shop.png", { exact: true })).toBeVisible();
});

test("missing saved media falls back to the animated login background", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, json: { message: "Unauthenticated." } }),
  );
  await page.route("**/api/v1/login-background", (route) =>
    route.fulfill({
      json: { data: { kind: "image", name: "missing.png", url: mediaUrl } },
    }),
  );
  await page.route(`**${mediaUrl}`, (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator(".login-background-media")).toHaveCount(0);
  await expect(page.locator(".login-aurora")).toBeVisible();
});

test("real RustFS upload, guest display, replacement and reset", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.LIVE_RUSTFS_CHECK !== "1",
    "Opt in to changing the local shared background for integration verification.",
  );
  const initial = await page.request.get("/api/v1/login-background");
  expect((await initial.json()).data).toBeNull();
  const credentials = JSON.parse(
    fs.readFileSync(
      new URL("../../backend/.review-credentials.json", import.meta.url),
      "utf8",
    ),
  );
  const image = Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)]);
  const digest = createHash("sha256").update(image).digest("hex");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "User interface", exact: true })
    .click();
  try {
    await page.getByLabel("Background file", { exact: true }).setInputFiles({
      name: "rustfs-verification.png",
      mimeType: "image/png",
      buffer: image,
    });
    const upload = page.waitForResponse(
      (response) =>
        response.url().includes("/settings/login-background") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save background" }).click();
    const response = await upload;
    expect(response.status(), await response.text()).toBe(200);
    const saved = (await response.json()).data;
    await expect(page.getByRole("status")).toContainText("saved for everyone");
    const php = `require '../backend/vendor/autoload.php'; $app = require '../backend/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $b = App\\Models\\LoginBackground::findOrFail(1); $d = Illuminate\\Support\\Facades\\Storage::disk($b->disk); echo json_encode(['disk' => $b->disk, 'path' => $b->path, 'size' => $d->size($b->path), 'hash' => hash('sha256', $d->get($b->path)), 'local_exists' => Illuminate\\Support\\Facades\\Storage::disk('local')->exists($b->path), 'url' => $d->url($b->path)]);`;
    const stored = JSON.parse(
      execFileSync("php", ["-r", php], { encoding: "utf8" }),
    );
    expect(stored.disk).toBe("rustfs");
    expect(stored.size).toBe(image.length);
    expect(stored.hash).toBe(digest);
    expect(stored.local_exists).toBe(false);
    expect((await page.request.get(stored.url)).status()).toBe(403);
    await page.screenshot({
      path: testInfo.outputPath("settings-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.reload();
    await page
      .getByRole("button", { name: "User interface", exact: true })
      .click();
    await expect(
      page.getByText("rustfs-verification.png", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator(".login-background.has-media img")).toBeVisible();
    const media = await page.request.get(saved.url);
    expect(media.status()).toBe(200);
    expect(
      createHash("sha256")
        .update(await media.body())
        .digest("hex"),
    ).toBe(digest);
    await page.getByLabel("Email address").fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "User interface", exact: true })
      .click();
    await page.getByLabel("Background file", { exact: true }).setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Save background" }).click();
    await expect(page.getByRole("status")).toContainText("saved for everyone");
    expect((await page.request.get(saved.url)).status()).toBe(404);
    const count = execFileSync(
      "php",
      [
        "-r",
        `require '../backend/vendor/autoload.php'; $app = require '../backend/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); echo count(Illuminate\\Support\\Facades\\Storage::disk('rustfs')->allFiles('login-backgrounds'));`,
      ],
      { encoding: "utf8" },
    );
    expect(count).toBe("1");
    await page
      .getByRole("button", { name: "Restore animated default" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "animated default background has been restored",
    );
    const remaining = execFileSync(
      "php",
      [
        "-r",
        `require '../backend/vendor/autoload.php'; $app = require '../backend/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); echo count(Illuminate\\Support\\Facades\\Storage::disk('rustfs')->allFiles('login-backgrounds'));`,
      ],
      { encoding: "utf8" },
    );
    expect(remaining).toBe("0");
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete("/api/v1/settings/login-background");
  }
});
