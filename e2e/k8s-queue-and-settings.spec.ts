import { expect, test } from "@playwright/test";

import { chatPrompt, maxTokensOverrideInput } from "./helpers";

test("host metrics are visible in the deployed app and session overrides persist", async ({ page }) => {
  await page.goto("/");
  await expect(chatPrompt(page)).toBeEnabled({ timeout: 60_000 });

  await page.getByRole("button", { name: /expand settings sidebar/i }).click();
  await page.getByText("Session overrides").click();

  const maxTokensOverride = maxTokensOverrideInput(page);
  await maxTokensOverride.fill("2048");
  const saveSessionResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/sessions/sess_1") && response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Save session" }).click();
  await saveSessionResponse;

  await page.getByText("System status").click();
  await expect(page.getByText("Metrics current")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".diagnostics-grid").getByText(/11234 MB \/ 16384 MB/i)).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(chatPrompt(page)).toBeEnabled({ timeout: 60_000 });

  await page.getByRole("button", { name: /expand settings sidebar/i }).click();
  await page.getByText("Session overrides").click();
  await expect(maxTokensOverrideInput(page)).toHaveValue("2048");
});
