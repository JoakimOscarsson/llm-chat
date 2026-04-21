import type { Locator, Page } from "@playwright/test";

export function chatPrompt(page: Page): Locator {
  return page.getByRole("textbox", { name: /^Prompt$/ });
}
