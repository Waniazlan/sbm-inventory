import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("login stays centered and usable across desktop, mobile and short screens", async ({
  page,
}, testInfo) => {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, json: { message: "Unauthenticated." } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [768, 950],
    [390, 844],
    [320, 640],
    [390, 380],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.locator(".login-content").boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2)).toBeLessThan(2);
    if (bounds!.height < height - 64)
      expect(
        Math.abs(bounds!.y + bounds!.height / 2 - height / 2),
      ).toBeLessThan(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeInViewport();
    if (width === 1440 || (width === 390 && height === 844))
      await page.screenshot({
        path: testInfo.outputPath(`login-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".login-aurora-beam")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
});

test("login validates, toggles the password, blocks repeat submits and displays server errors", async ({
  page,
}) => {
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, json: { message: "Unauthenticated." } }),
  );
  await page.route("**/sanctum/csrf-cookie", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/v1/auth/login", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({
      email: "person@example.com",
      password: "incorrect-password",
    });
    await pending;
    await route.fulfill({
      status: 422,
      json: {
        errors: {
          email: ["The credentials are incorrect or the account is disabled."],
        },
      },
    });
  });
  await page.goto("/");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  await submit.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a valid email address and your password.",
  );
  await expect(email).toBeFocused();
  expect(requests).toBe(0);
  await email.fill("person@example.com");
  await submit.click();
  await expect(password).toBeFocused();
  await password.fill("incorrect-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await submit.click();
  await expect(
    page.getByRole("button", { name: "Signing in…" }),
  ).toBeDisabled();
  await expect(email).toBeDisabled();
  await expect(password).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  await page.locator("form").dispatchEvent("submit");
  release();
  await expect(page.getByRole("alert")).toContainText(
    "The credentials are incorrect",
  );
  await expect(submit).toBeEnabled();
  expect(requests).toBe(1);
});

test("local sign-in persists after reload and sign-out returns to the login page", async ({
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
  const csrfResponse = page.waitForResponse((response) =>
    response.url().includes("/sanctum/csrf-cookie"),
  );
  const loginResponse = page.waitForResponse((response) =>
    response.url().includes("/auth/login"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await csrfResponse).status()).toBe(204);
  expect((await loginResponse).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Stock overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(errors).toEqual([]);
});
