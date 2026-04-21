import type { Locator, Page } from "@playwright/test";

export function chatPrompt(page: Page): Locator {
  return page.getByRole("textbox", { name: /^Prompt$/ });
}

export function modelsButton(page: Page): Locator {
  return page.locator('.panel-header .model-menu > button[aria-label="Models"]').first();
}

export function maxTokensOverrideInput(page: Page): Locator {
  return page.getByRole("textbox", { name: /^Max tokens override$/ }).first();
}

export function queueBanner(page: Page): Locator {
  return page.locator(".queue-banner").first();
}
