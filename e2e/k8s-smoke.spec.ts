import { expect, test } from "@playwright/test";

import { chatPrompt, modelsButton } from "./helpers";

test("the Kubernetes deployment boots and completes a chat round-trip", async ({ page }) => {
  await page.goto("/");

  const prompt = chatPrompt(page);
  await expect(prompt).toBeEnabled({ timeout: 60_000 });

  await modelsButton(page).click();
  const modelSelector = page.getByLabel("Model selector");
  await expect
    .poll(async () => modelSelector.getByRole("option").count(), {
      timeout: 30_000,
      message: "Expected the model selector to contain at least one chat-capable model."
    })
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  await prompt.fill("Please reply with a short greeting.");
  await page.getByRole("button", { name: "Send" }).click();

  const assistantBubble = page.locator(".assistant-message .markdown-body").last();
  await expect
    .poll(
      async () => {
        const text = (await assistantBubble.textContent())?.trim() ?? "";
        return text && text !== "Waiting for answer..." ? text : "";
      },
      {
        timeout: 60_000,
        message: "Expected the deployed cluster to stream a non-empty assistant response."
      }
    )
    .not.toBe("");
});
