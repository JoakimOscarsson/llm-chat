import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryQueueCoordinator } from "./coordination.js";

test("in-memory coordinator recovers stale running requests and frees slots", async () => {
  let now = 0;
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1,
    podHeartbeatTtlMs: 1_000,
    now: () => now
  });

  await coordinator.start();
  await coordinator.heartbeat("pod-a");

  const queuedOne = await coordinator.enqueueRequest({
    requestId: "req_1",
    model: "gemma4"
  });
  assert.equal(queuedOne.position, 1);

  const runningOne = await coordinator.claimRequest("req_1", "pod-a");
  assert.equal(runningOne?.state, "running");
  assert.equal(runningOne?.ownerPodId, "pod-a");

  now = 2_000;

  const queuedTwo = await coordinator.enqueueRequest({
    requestId: "req_2",
    model: "qwen2.5-coder:7b"
  });
  assert.equal(queuedTwo.position, 1);

  await coordinator.cleanupStaleRunningRequests();

  const firstSnapshot = await coordinator.getRequestSnapshot("req_1");
  assert.equal(firstSnapshot?.state, "failed");
  assert.ok(firstSnapshot?.finishedAt);

  const runningTwo = await coordinator.claimRequest("req_2", "pod-b");
  assert.equal(runningTwo?.state, "running");
  assert.equal(runningTwo?.ownerPodId, "pod-b");

  await coordinator.stop();
});

test("in-memory coordinator only retargets queued requests", async () => {
  const coordinator = new InMemoryQueueCoordinator({
    maxParallelRequests: 1
  });

  await coordinator.start();
  await coordinator.heartbeat("pod-a");

  await coordinator.enqueueRequest({
    requestId: "req_1",
    model: "gemma4"
  });

  const updated = await coordinator.updateQueuedRequest("req_1", {
    model: "qwen2.5-coder:7b"
  });

  assert.equal(updated?.state, "queued");
  assert.equal(updated?.model, "qwen2.5-coder:7b");

  await coordinator.claimRequest("req_1", "pod-a");

  const rejected = await coordinator.updateQueuedRequest("req_1", {
    model: "llama3.1:8b"
  });

  assert.equal(rejected?.state, "running");
  assert.equal(rejected?.model, "qwen2.5-coder:7b");

  await coordinator.stop();
});
