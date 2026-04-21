import { describe, expect, it } from "vitest";

import { resolveApiProxyTarget } from "./vite.config";

describe("resolveApiProxyTarget", () => {
  it("falls back to the local compose api-gateway host", () => {
    expect(resolveApiProxyTarget({})).toBe("http://api-gateway:4000");
  });

  it("uses the injected Kubernetes service URL when provided", () => {
    expect(
      resolveApiProxyTarget({
        WEB_API_PROXY_TARGET: "http://llm-chat-llm-chat-api-gateway:4000"
      })
    ).toBe("http://llm-chat-llm-chat-api-gateway:4000");
  });
});
