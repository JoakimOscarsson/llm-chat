import { expect, test } from "@playwright/test";

import { chatPrompt, maxTokensOverrideInput, modelsButton, queueBanner } from "./helpers";

test("queued requests can be retargeted and cancelled while another response is streaming", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await firstPage.goto("/");
    await secondPage.goto("/");

    const firstPrompt = chatPrompt(firstPage);
    const secondPrompt = chatPrompt(secondPage);
    await expect(firstPrompt).toBeEnabled({ timeout: 60_000 });
    await expect(secondPrompt).toBeEnabled({ timeout: 60_000 });

    await firstPrompt.fill("Hold the only Ollama slot for a few seconds.");
    await firstPage.getByRole("button", { name: "Send" }).click();

    await expect(firstPage.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 20_000 });

    await secondPrompt.fill("Queue this request behind the first one.");
    await secondPage.getByRole("button", { name: "Send" }).click();

    const queuedNotice = queueBanner(secondPage);
    await expect(queuedNotice).toContainText("Queued for llama3.1:8b", { timeout: 30_000 });
    await expect(queuedNotice).toContainText("Queued at position");

    await modelsButton(secondPage).click();
    await secondPage.getByRole("option", { name: /qwen2\.5-coder:7b/i }).click();

    await expect(queuedNotice).toContainText("Queued for qwen2.5-coder:7b", { timeout: 30_000 });

    await expect(secondPage.getByRole("button", { name: "Leave queue" })).toBeVisible({ timeout: 20_000 });
    await secondPage.getByRole("button", { name: "Leave queue" }).click();

    await expect(secondPage.locator(".assistant-message")).toContainText("Queued request cancelled", {
      timeout: 20_000
    });
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test("host metrics are visible in the deployed app and session overrides persist", async ({ page }) => {
  await page.goto("/");
  await expect(chatPrompt(page)).toBeEnabled({ timeout: 60_000 });

  await page.getByRole("button", { name: /expand settings sidebar/i }).click();
  const sessionOverrides = page.getByText("Session overrides").locator("..");
  await page.getByText("Session overrides").click();

  const maxTokensOverride = maxTokensOverrideInput(page);
  await maxTokensOverride.fill("2048");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Session settings saved.")).toBeVisible({ timeout: 20_000 });

  await page.getByText("System status").click();
  await expect(page.getByText("Metrics current")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/11234 MB \/ 16384 MB/i)).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(chatPrompt(page)).toBeEnabled({ timeout: 60_000 });

  await page.getByRole("button", { name: /expand settings sidebar/i }).click();
  await page.getByText("Session overrides").click();
  await expect(maxTokensOverrideInput(page)).toHaveValue("2048");
});
