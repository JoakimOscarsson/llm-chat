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
  kind?: "message";
};

export type ModelSwitchMarker = {
  id: string;
  role: "system";
  content: string;
  createdAt: string;
  kind: "model_switch";
  model: string;
};

export type SessionSummary = {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
};
