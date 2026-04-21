import type { AppDefaults } from "@llm-chat-app/contracts";
import type { SessionRecord } from "./store.js";

export const fixedNow = "2026-04-20T18:00:00.000Z";
export const createdSessionNow = "2026-04-20T18:00:01.000Z";

export const initialDefaults: AppDefaults = {
  systemPrompt: "You are a concise, helpful assistant. Format responses with Markdown, short paragraphs, and lists when useful.",
  requestHistoryCount: 8,
  responseHistoryCount: 8,
  streamThinking: true,
  persistSessions: true,
  options: {
    temperature: 0.7,
    top_k: 40,
    top_p: 0.9,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 5120,
    stop: []
  }
};

export const initialSession: SessionRecord = {
  id: "sess_1",
  title: "New chat",
  model: "llama3.1:8b",
  createdAt: fixedNow,
  updatedAt: fixedNow,
  messages: [],
  overrides: {}
};
