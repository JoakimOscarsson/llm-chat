export type SessionOverrides = {
  systemPrompt?: string;
  requestHistoryCount?: number;
  responseHistoryCount?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  repeat_penalty?: number;
  seed?: number;
  num_ctx?: number;
  num_predict?: number;
  stop?: string[];
  keep_alive?: string | number;
};

export type AppDefaults = {
  systemPrompt: string;
  requestHistoryCount: number;
  responseHistoryCount: number;
  streamThinking: boolean;
  persistSessions: boolean;
  options: {
    temperature: number;
    top_k: number;
    top_p: number;
    repeat_penalty: number;
    seed?: number;
    num_ctx: number;
    num_predict: number;
    stop: string[];
    keep_alive?: string | number;
  };
};

