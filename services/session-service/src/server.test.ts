import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("GET /internal/sessions returns session summaries", async () => {
  const app = createApp();

  const response = await app.inject({
    method: "GET",
    url: "/internal/sessions"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().sessions, [
    {
      id: "sess_1",
      title: "New chat",
      model: "llama3.1:8b",
      updatedAt: "2026-04-20T18:00:00.000Z"
    }
  ]);
});
