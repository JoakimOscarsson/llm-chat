import type { AppDefaults } from "@llm-chat-app/contracts";
import { appDefaultsSchema } from "@llm-chat-app/contracts";
import { createdSessionNow, initialDefaults, initialSession } from "../defaults.js";
import type { SessionRecord, SessionStore } from "../store.js";

export function createMemorySessionStore(): SessionStore {
  let defaults = appDefaultsSchema.parse(initialDefaults);
  const sessionStore = new Map<string, SessionRecord>([[initialSession.id, structuredClone(initialSession)]]);
  let nextSessionId = 2;

  return {
    async init() {},
    async close() {},
    async getDefaults() {
      return structuredClone(defaults);
    },
    async setDefaults(nextDefaults: AppDefaults) {
      defaults = appDefaultsSchema.parse(nextDefaults);
      return structuredClone(defaults);
    },
    async listSessions() {
      return Array.from(sessionStore.values()).map((session) => ({
        id: session.id,
        title: session.title,
        model: session.model,
        updatedAt: session.updatedAt
      }));
    },
    async createSession(input) {
      const session: SessionRecord = {
        id: `sess_${nextSessionId}`,
        title: input.title,
        model: input.model,
        createdAt: input.createdAt || createdSessionNow,
        updatedAt: input.createdAt || createdSessionNow,
        messages: [],
        overrides: {}
      };

      nextSessionId += 1;
      sessionStore.set(session.id, session);
      return structuredClone(session);
    },
    async getSession(sessionId) {
      const session = sessionStore.get(sessionId);
      return session ? structuredClone(session) : null;
    },
    async updateSession(sessionId, patch) {
      const session = sessionStore.get(sessionId);

      if (!session) {
        return null;
      }

      const updated: SessionRecord = {
        ...session,
        title: patch.title ?? session.title,
        model: patch.model ?? session.model,
        overrides: patch.overrides ?? session.overrides,
        updatedAt: patch.updatedAt
      };

      sessionStore.set(sessionId, updated);
      return structuredClone(updated);
    },
    async appendModelSwitch(sessionId, input) {
      const session = sessionStore.get(sessionId);

      if (!session) {
        return null;
      }

      const marker = {
        id: `switch_${sessionId}_${input.createdAt}`,
        role: "system" as const,
        content: "",
        createdAt: input.createdAt,
        kind: "model_switch" as const,
        model: input.model
      };
      const updated: SessionRecord = {
        ...session,
        model: input.model,
        messages: [...session.messages, marker],
        updatedAt: input.createdAt
      };

      sessionStore.set(sessionId, updated);
      return structuredClone(updated);
    },
    async appendMessage(sessionId, message) {
      const session = sessionStore.get(sessionId);

      if (!session) {
        return null;
      }

      const updated: SessionRecord = {
        ...session,
        messages: [...session.messages, message],
        updatedAt: message.createdAt
      };

      sessionStore.set(sessionId, updated);
      return structuredClone(updated);
    },
    async appendAssistantResult(sessionId, input) {
      const session = sessionStore.get(sessionId);

      if (!session) {
        return null;
      }

      const updatedMessage = input.thinking
        ? {
            ...input.message,
            thinking: input.thinking
          }
        : input.message;
      const updated: SessionRecord = {
        ...session,
        messages: [...session.messages, updatedMessage],
        updatedAt: input.message.createdAt
      };

      sessionStore.set(sessionId, updated);
      return structuredClone(updated);
    },
    async clearHistory(sessionId, updatedAt) {
      const session = sessionStore.get(sessionId);

      if (!session) {
        return null;
      }

      const updated: SessionRecord = {
        ...session,
        messages: [],
        updatedAt
      };

      sessionStore.set(sessionId, updated);
      return structuredClone(updated);
    }
  };
}
