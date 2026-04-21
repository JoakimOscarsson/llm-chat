import type { AppDefaults, SessionOverrides } from "@llm-chat-app/contracts";

export type SessionMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
  kind?: "message" | "model_switch";
  model?: string;
  thinking?: {
    content: string;
    collapsedByDefault: true;
  };
};

export type SessionRecord = {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  overrides: SessionOverrides;
};

export type SessionStore = {
  init: () => Promise<void>;
  close: () => Promise<void>;
  getDefaults: () => Promise<AppDefaults>;
  setDefaults: (defaults: AppDefaults) => Promise<AppDefaults>;
  listSessions: () => Promise<Array<Pick<SessionRecord, "id" | "title" | "model" | "updatedAt">>>;
  createSession: (input: { title: string; model: string; createdAt: string }) => Promise<SessionRecord>;
  getSession: (sessionId: string) => Promise<SessionRecord | null>;
  updateSession: (
    sessionId: string,
    patch: {
      title?: string;
      model?: string;
      overrides?: SessionOverrides;
      updatedAt: string;
    }
  ) => Promise<SessionRecord | null>;
  appendModelSwitch: (sessionId: string, input: { model: string; createdAt: string }) => Promise<SessionRecord | null>;
  appendMessage: (sessionId: string, message: SessionMessage) => Promise<SessionRecord | null>;
  appendAssistantResult: (
    sessionId: string,
    input: {
      message: SessionMessage;
      thinking?: {
        content: string;
        collapsedByDefault: true;
      };
    }
  ) => Promise<SessionRecord | null>;
  clearHistory: (sessionId: string, updatedAt: string) => Promise<SessionRecord | null>;
};
