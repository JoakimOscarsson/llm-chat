export type MessageRole = "system" | "user" | "assistant";

export type ThinkingTrace = {
  content: string;
  collapsedByDefault: true;
};

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  thinking?: ThinkingTrace;
};

export type SessionSummary = {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
};

