import { test, expect, type Page } from "@playwright/test";

const pictureBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

async function setup(page: Page, role = "technician") {
  let user = {
    id: 7,
    name: "Profile user",
    email: "profile@example.test",
    role,
    active: true,
    avatar_url: null as string | null,
  };
  const passwords: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: user });
    if (path.endsWith("/metadata"))
      return route.fulfill({
        json: {
          categories: [],
          suppliers: [],
          phone_models: [],
          timezone: "Asia/Kuala_Lumpur",
        },
      });
    if (path.includes("/auth/profile/picture/"))
      return route.fulfill({ contentType: "image/png", body: pictureBytes });
    if (path.endsWith("/auth/profile/picture")) {
      if (
        request.method() === "POST" &&
        request.postData()?.includes('filename="fail.png"')
      )
        return route.fulfill({
          status: 503,
          json: {
            message: "Unable to save your profile picture. Please try again.",
          },
        });
      user = {
        ...user,
        avatar_url:
          request.method() === "DELETE"
            ? null
            : "/api/v1/auth/profile/picture/12345678-1234-4123-8123-123456789abc",
      };
      return route.fulfill({ json: user });
    }
    if (path.endsWith("/auth/profile")) {
      const data = request.postDataJSON();
      if (!data.name.trim())
        return route.fulfill({
          status: 422,
          json: { errors: { name: ["The name field is required."] } },
        });
      user = { ...user, name: data.name.trim() };
      return route.fulfill({ json: user });
    }
    if (path.endsWith("/auth/password")) {
      const data = request.postDataJSON();
      passwords.push(data);
      if (data.current_password !== "original-password")
        return route.fulfill({
          status: 422,
          json: {
            errors: {
              current_password: ["The current password is incorrect."],
            },
          },
        });
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 404,
      json: { message: "Unexpected request" },
    });
  });
  return passwords;
}

for (const role of ["admin", "technician"]) {
  test(`${role} can save their name and see it after reload`, async ({
    page,
  }) => {
    await setup(page, role);
    await page.goto("/profile");
    await expect(
      page.getByRole("heading", { name: "My profile", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "My profile", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByLabel("Name", { exact: true }).fill("Updated name");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Your name has been updated.",
    );
    await expect(page.locator(".sidebar .profile strong")).toHaveText(
      "Updated name",
    );
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Updated name",
    );
    await page.getByLabel("Name", { exact: true }).fill("   ");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "The name field is required.",
    );
    await expect(page.locator(".sidebar .profile strong")).toHaveText(
      "Updated name",
    );
  });

  test(`${role} can preview save replace and remove their picture`, async ({
    page,
  }, testInfo) => {
    await setup(page, role);
    await page.goto("/profile");
    const input = page.getByLabel("Choose profile picture", { exact: true });
    await expect(
      page.getByRole("button", { name: "Save picture", exact: true }),
    ).toBeDisabled();
    await input.setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: pictureBytes,
    });
    await expect(page.locator(".profile-picture-preview img")).toHaveAttribute(
      "src",
      /^blob:/,
    );
    await expect(page.locator(".profile-picture-avatar")).toHaveCSS(
      "width",
      "88px",
    );
    await expect(page.locator(".sidebar .profile img")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Save picture", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Your profile picture has been updated.",
    );
    await expect(page.locator(".sidebar .profile img")).toHaveAttribute(
      "src",
      /\/auth\/profile\/picture\//,
    );
    await expect(page.locator(".topbar-right img")).toBeVisible();
    await page.reload();
    await expect(page.locator(".profile-picture-preview img")).toHaveAttribute(
      "src",
      /\/auth\/profile\/picture\//,
    );
    await input.setInputFiles({
      name: "invalid.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg></svg>"),
    });
    await expect(page.getByRole("alert")).toContainText(
      "Choose a JPG, PNG or WebP image up to 5 MB.",
    );
    await input.setInputFiles({
      name: "fail.png",
      mimeType: "image/png",
      buffer: pictureBytes,
    });
    await page
      .getByRole("button", { name: "Save picture", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Unable to save your profile picture.",
    );
    await expect(page.locator(".sidebar .profile img")).toBeVisible();
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("profile-picture-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Remove picture", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Your profile picture has been removed.",
    );
    await expect(page.locator(".profile-picture-preview img")).toHaveCount(0);
    await expect(page.locator(".topbar-right .avatar")).toHaveText("P");
  });
}

test("password form shows errors and clears passwords after success", async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto("/profile");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("incorrect-password");
  await page
    .getByLabel("New password", { exact: true })
    .fill("replacement-password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("different-password");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "The password confirmation does not match.",
  );
  expect(requests).toHaveLength(0);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("replacement-password");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "The current password is incorrect.",
  );
  await page
    .getByLabel("Current password", { exact: true })
    .fill("original-password");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Your password has been changed.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const label of [
    "Current password",
    "New password",
    "Confirm new password",
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  expect(requests).toHaveLength(2);
});

test("profile is accessible from the header and mobile navigation and fits phone widths", async ({
  page,
}, testInfo) => {
  await setup(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/profile");
  await expect(
    page.getByRole("link", { name: "Open my profile", exact: true }),
  ).toHaveAttribute("href", "/profile");
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("profile-desktop.png"),
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "My profile", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open menu" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Change password", exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath("profile-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
