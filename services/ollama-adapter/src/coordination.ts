import { EventEmitter } from "node:events";
import { createClient, type RedisClientType } from "redis";

export type QueueRequestState = "queued" | "running" | "completed" | "cancelled" | "failed";

export type QueueRequestSnapshot = {
  requestId: string;
  state: QueueRequestState;
  model: string;
  ownerPodId?: string;
  cancelRequested?: boolean;
  position?: number;
  queueDepth?: number;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type QueueCoordinator = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  heartbeat: (podId: string) => Promise<void>;
  cleanupStaleRunningRequests: () => Promise<void>;
  enqueueRequest: (request: { requestId: string; model: string }) => Promise<QueueRequestSnapshot>;
  claimRequest: (requestId: string, podId: string) => Promise<QueueRequestSnapshot | null>;
  getRequestSnapshot: (requestId: string) => Promise<QueueRequestSnapshot | null>;
  cancelRequest: (requestId: string) => Promise<QueueRequestSnapshot | null>;
  updateQueuedRequest: (
    requestId: string,
    patch: {
      model?: string;
    }
  ) => Promise<QueueRequestSnapshot | null>;
  finalizeRequest: (requestId: string, state: "completed" | "cancelled" | "failed") => Promise<QueueRequestSnapshot | null>;
  getQueueStats: () => Promise<{ activeRequests: number; queueDepth: number }>;
  subscribeToCancels: (listener: (requestId: string) => void) => Promise<() => Promise<void>>;
  publishCancel: (requestId: string) => Promise<void>;
};

type QueueCoordinatorOptions = {
  maxParallelRequests: number;
  podHeartbeatTtlMs?: number;
  now?: () => number;
};

type StoredQueueRequest = {
  requestId: string;
  state: QueueRequestState;
  model: string;
  sequence: number;
  ownerPodId?: string;
  cancelRequested: boolean;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
};

const DEFAULT_POD_HEARTBEAT_TTL_MS = 6_000;
const CANCEL_CHANNEL = "ollama:cancel";
const REDIS_PENDING_KEY = "ollama:queue:pending";
const REDIS_RUNNING_KEY = "ollama:running";
const REDIS_SEQUENCE_KEY = "ollama:seq";
const REDIS_REQUEST_PREFIX = "ollama:request:";
const REDIS_POD_PREFIX = "ollama:pod:";

function nowIso(now: () => number) {
  return new Date(now()).toISOString();
}

function pendingPosition(pending: string[], requestId: string) {
  const index = pending.indexOf(requestId);
  return index >= 0 ? index + 1 : undefined;
}

function requestKey(requestId: string) {
  return `${REDIS_REQUEST_PREFIX}${requestId}`;
}

function podKey(podId: string) {
  return `${REDIS_POD_PREFIX}${podId}`;
}

function toSnapshot(request: StoredQueueRequest, pending: string[]): QueueRequestSnapshot {
  return {
    requestId: request.requestId,
    state: request.state,
    model: request.model,
    ownerPodId: request.ownerPodId,
    cancelRequested: request.cancelRequested,
    position: request.state === "queued" ? pendingPosition(pending, request.requestId) : undefined,
    queueDepth: pending.length,
    queuedAt: request.queuedAt,
    startedAt: request.startedAt,
    finishedAt: request.finishedAt
  };
}

function toHash(snapshot: StoredQueueRequest) {
  return {
    requestId: snapshot.requestId,
    state: snapshot.state,
    model: snapshot.model,
    sequence: String(snapshot.sequence),
    ownerPodId: snapshot.ownerPodId ?? "",
    cancelRequested: snapshot.cancelRequested ? "1" : "0",
    queuedAt: snapshot.queuedAt ?? "",
    startedAt: snapshot.startedAt ?? "",
    finishedAt: snapshot.finishedAt ?? ""
  };
}

function fromHash(hash: Record<string, string>): StoredQueueRequest | null {
  if (!hash.requestId) {
    return null;
  }

  return {
    requestId: hash.requestId,
    state: (hash.state as QueueRequestState) ?? "failed",
    model: hash.model ?? "",
    sequence: Number(hash.sequence ?? 0),
    ownerPodId: hash.ownerPodId || undefined,
    cancelRequested: hash.cancelRequested === "1",
    queuedAt: hash.queuedAt || undefined,
    startedAt: hash.startedAt || undefined,
    finishedAt: hash.finishedAt || undefined
  };
}

export class InMemoryQueueCoordinator implements QueueCoordinator {
  private readonly maxParallelRequests: number;
  private readonly podHeartbeatTtlMs: number;
  private readonly now: () => number;
  private readonly events = new EventEmitter();
  private readonly requests = new Map<string, StoredQueueRequest>();
  private readonly pending: string[] = [];
  private readonly running = new Set<string>();
  private readonly podHeartbeats = new Map<string, number>();
  private sequence = 0;

  constructor(options: QueueCoordinatorOptions) {
    this.maxParallelRequests = Math.max(1, options.maxParallelRequests);
    this.podHeartbeatTtlMs = options.podHeartbeatTtlMs ?? DEFAULT_POD_HEARTBEAT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async start() {}

  async stop() {
    this.events.removeAllListeners();
  }

  async heartbeat(podId: string) {
    this.podHeartbeats.set(podId, this.now());
  }

  async cleanupStaleRunningRequests() {
    const finishedAt = nowIso(this.now);

    for (const requestId of [...this.running]) {
      const request = this.requests.get(requestId);

      if (!request?.ownerPodId) {
        this.running.delete(requestId);
        continue;
      }

      const heartbeatAt = this.podHeartbeats.get(request.ownerPodId);

      if (heartbeatAt !== undefined && this.now() - heartbeatAt <= this.podHeartbeatTtlMs) {
        continue;
      }

      request.state = "failed";
      request.cancelRequested = false;
      request.finishedAt = finishedAt;
      this.running.delete(requestId);
    }
  }

  async enqueueRequest(request: { requestId: string; model: string }) {
    const existing = this.requests.get(request.requestId);

    if (existing) {
      return toSnapshot(existing, this.pending);
    }

    this.sequence += 1;
    const record: StoredQueueRequest = {
      requestId: request.requestId,
      model: request.model,
      sequence: this.sequence,
      state: "queued",
      cancelRequested: false,
      queuedAt: nowIso(this.now)
    };

    this.requests.set(request.requestId, record);
    this.pending.push(request.requestId);
    return toSnapshot(record, this.pending);
  }

  async claimRequest(requestId: string, podId: string) {
    await this.cleanupStaleRunningRequests();

    const request = this.requests.get(requestId);

    if (!request) {
      return null;
    }

    if (request.state !== "queued") {
      return toSnapshot(request, this.pending);
    }

    if (this.running.size >= this.maxParallelRequests || this.pending[0] !== requestId) {
      return toSnapshot(request, this.pending);
    }

    this.pending.shift();
    this.running.add(requestId);
    request.state = "running";
    request.ownerPodId = podId;
    request.startedAt = nowIso(this.now);
    request.cancelRequested = false;

    return toSnapshot(request, this.pending);
  }

  async getRequestSnapshot(requestId: string) {
    const request = this.requests.get(requestId);
    return request ? toSnapshot(request, this.pending) : null;
  }

  async cancelRequest(requestId: string) {
    const request = this.requests.get(requestId);

    if (!request) {
      return null;
    }

    if (request.state === "queued") {
      const index = this.pending.indexOf(requestId);

      if (index >= 0) {
        this.pending.splice(index, 1);
      }

      request.state = "cancelled";
      request.cancelRequested = false;
      request.finishedAt = nowIso(this.now);
      return toSnapshot(request, this.pending);
    }

    if (request.state === "running") {
      request.cancelRequested = true;
      await this.publishCancel(requestId);
    }

    return toSnapshot(request, this.pending);
  }

  async updateQueuedRequest(
    requestId: string,
    patch: {
      model?: string;
    }
  ) {
    const request = this.requests.get(requestId);

    if (!request) {
      return null;
    }

    if (request.state === "queued" && patch.model) {
      request.model = patch.model;
    }

    return toSnapshot(request, this.pending);
  }

  async finalizeRequest(requestId: string, state: "completed" | "cancelled" | "failed") {
    const request = this.requests.get(requestId);

    if (!request) {
      return null;
    }

    const pendingIndex = this.pending.indexOf(requestId);
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
    }
    this.running.delete(requestId);

    request.state = state;
    request.cancelRequested = false;
    request.finishedAt = nowIso(this.now);

    return toSnapshot(request, this.pending);
  }

  async getQueueStats() {
    await this.cleanupStaleRunningRequests();
    return {
      activeRequests: this.running.size,
      queueDepth: this.pending.length
    };
  }

  async subscribeToCancels(listener: (requestId: string) => void) {
    this.events.on(CANCEL_CHANNEL, listener);

    return async () => {
      this.events.off(CANCEL_CHANNEL, listener);
    };
  }

  async publishCancel(requestId: string) {
    this.events.emit(CANCEL_CHANNEL, requestId);
  }
}

type RedisQueueCoordinatorOptions = QueueCoordinatorOptions & {
  url: string;
};

const CLAIM_SCRIPT = `
local requestKey = KEYS[1]
local pendingKey = KEYS[2]
local runningKey = KEYS[3]
local requestId = ARGV[1]
local podId = ARGV[2]
local maxParallel = tonumber(ARGV[3])
local startedAt = ARGV[4]

if redis.call('EXISTS', requestKey) == 0 then
  return {'missing'}
end

local state = redis.call('HGET', requestKey, 'state')
local model = redis.call('HGET', requestKey, 'model') or ''
local ownerPodId = redis.call('HGET', requestKey, 'ownerPodId') or ''
local cancelRequested = redis.call('HGET', requestKey, 'cancelRequested') or '0'
local queuedAt = redis.call('HGET', requestKey, 'queuedAt') or ''
local startedAtValue = redis.call('HGET', requestKey, 'startedAt') or ''
local finishedAt = redis.call('HGET', requestKey, 'finishedAt') or ''

if state ~= 'queued' then
  return {state, model, ownerPodId, cancelRequested, queuedAt, startedAtValue, finishedAt, '', ''}
end

local rank = redis.call('ZRANK', pendingKey, requestId)
if not rank then
  state = redis.call('HGET', requestKey, 'state') or 'missing'
  return {state, model, ownerPodId, cancelRequested, queuedAt, startedAtValue, finishedAt, '', ''}
end

local queueDepth = redis.call('ZCARD', pendingKey)
local runningCount = redis.call('SCARD', runningKey)

if runningCount >= maxParallel then
  return {'queued', model, ownerPodId, cancelRequested, queuedAt, startedAtValue, finishedAt, tostring(rank + 1), tostring(queueDepth)}
end

local first = redis.call('ZRANGE', pendingKey, 0, 0)[1]
if first ~= requestId then
  return {'queued', model, ownerPodId, cancelRequested, queuedAt, startedAtValue, finishedAt, tostring(rank + 1), tostring(queueDepth)}
end

redis.call('ZREM', pendingKey, requestId)
redis.call('SADD', runningKey, requestId)
redis.call('HSET', requestKey, 'state', 'running', 'ownerPodId', podId, 'startedAt', startedAt, 'cancelRequested', '0')

return {'running', model, podId, '0', queuedAt, startedAt, '', '', tostring(queueDepth - 1)}
`;

const CANCEL_SCRIPT = `
local requestKey = KEYS[1]
local pendingKey = KEYS[2]
local requestId = ARGV[1]
local finishedAt = ARGV[2]

if redis.call('EXISTS', requestKey) == 0 then
  return {'missing'}
end

local state = redis.call('HGET', requestKey, 'state')
local model = redis.call('HGET', requestKey, 'model') or ''
local ownerPodId = redis.call('HGET', requestKey, 'ownerPodId') or ''
local queuedAt = redis.call('HGET', requestKey, 'queuedAt') or ''
local startedAt = redis.call('HGET', requestKey, 'startedAt') or ''
local finishedAtValue = redis.call('HGET', requestKey, 'finishedAt') or ''

if state == 'queued' then
  redis.call('ZREM', pendingKey, requestId)
  redis.call('HSET', requestKey, 'state', 'cancelled', 'finishedAt', finishedAt, 'cancelRequested', '0')
  return {'cancelled', model, ownerPodId, '0', queuedAt, startedAt, finishedAt, '', tostring(redis.call('ZCARD', pendingKey))}
end

if state == 'running' then
  redis.call('HSET', requestKey, 'cancelRequested', '1')
  return {'running', model, ownerPodId, '1', queuedAt, startedAt, finishedAtValue, '', tostring(redis.call('ZCARD', pendingKey))}
end

return {state, model, ownerPodId, redis.call('HGET', requestKey, 'cancelRequested') or '0', queuedAt, startedAt, finishedAtValue, '', tostring(redis.call('ZCARD', pendingKey))}
`;

const UPDATE_QUEUED_SCRIPT = `
local requestKey = KEYS[1]
local pendingKey = KEYS[2]
local requestId = ARGV[1]
local model = ARGV[2]

if redis.call('EXISTS', requestKey) == 0 then
  return {'missing'}
end

local state = redis.call('HGET', requestKey, 'state')
if state == 'queued' then
  redis.call('HSET', requestKey, 'model', model)
end

local ownerPodId = redis.call('HGET', requestKey, 'ownerPodId') or ''
local cancelRequested = redis.call('HGET', requestKey, 'cancelRequested') or '0'
local queuedAt = redis.call('HGET', requestKey, 'queuedAt') or ''
local startedAt = redis.call('HGET', requestKey, 'startedAt') or ''
local finishedAt = redis.call('HGET', requestKey, 'finishedAt') or ''
local queueDepth = redis.call('ZCARD', pendingKey)
local rank = redis.call('ZRANK', pendingKey, requestId)
local currentModel = redis.call('HGET', requestKey, 'model') or ''

return {state, currentModel, ownerPodId, cancelRequested, queuedAt, startedAt, finishedAt, rank and tostring(rank + 1) or '', tostring(queueDepth)}
`;

const FINALIZE_SCRIPT = `
local requestKey = KEYS[1]
local pendingKey = KEYS[2]
local runningKey = KEYS[3]
local requestId = ARGV[1]
local state = ARGV[2]
local finishedAt = ARGV[3]

if redis.call('EXISTS', requestKey) == 0 then
  return {'missing'}
end

redis.call('ZREM', pendingKey, requestId)
redis.call('SREM', runningKey, requestId)
redis.call('HSET', requestKey, 'state', state, 'finishedAt', finishedAt, 'cancelRequested', '0')

local model = redis.call('HGET', requestKey, 'model') or ''
local ownerPodId = redis.call('HGET', requestKey, 'ownerPodId') or ''
local queuedAt = redis.call('HGET', requestKey, 'queuedAt') or ''
local startedAt = redis.call('HGET', requestKey, 'startedAt') or ''

return {state, model, ownerPodId, '0', queuedAt, startedAt, finishedAt, '', tostring(redis.call('ZCARD', pendingKey))}
`;

export class RedisQueueCoordinator implements QueueCoordinator {
  private readonly maxParallelRequests: number;
  private readonly podHeartbeatTtlMs: number;
  private readonly now: () => number;
  private readonly client: RedisClientType;
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;

  constructor(options: RedisQueueCoordinatorOptions) {
    this.maxParallelRequests = Math.max(1, options.maxParallelRequests);
    this.podHeartbeatTtlMs = options.podHeartbeatTtlMs ?? DEFAULT_POD_HEARTBEAT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.client = createClient({
      url: options.url
    });
    this.publisher = this.client.duplicate();
    this.subscriber = this.client.duplicate();
  }

  async start() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }

    if (!this.publisher.isOpen) {
      await this.publisher.connect();
    }

    if (!this.subscriber.isOpen) {
      await this.subscriber.connect();
    }
  }

  async stop() {
    const clients = [this.subscriber, this.publisher, this.client];

    for (const client of clients) {
      if (client.isOpen) {
        await client.quit();
      }
    }
  }

  async heartbeat(podId: string) {
    const ttlSeconds = Math.max(1, Math.ceil(this.podHeartbeatTtlMs / 1_000));
    await this.client.set(podKey(podId), String(this.now()), {
      EX: ttlSeconds
    });
  }

  async cleanupStaleRunningRequests() {
    const requestIds = await this.client.sMembers(REDIS_RUNNING_KEY);
    const finishedAt = nowIso(this.now);

    for (const requestId of requestIds) {
      const hash = await this.client.hGetAll(requestKey(requestId));
      const request = fromHash(hash);

      if (!request?.ownerPodId) {
        await this.client.sRem(REDIS_RUNNING_KEY, requestId);
        continue;
      }

      const alive = await this.client.exists(podKey(request.ownerPodId));

      if (alive) {
        continue;
      }

      await this.client
        .multi()
        .sRem(REDIS_RUNNING_KEY, requestId)
        .hSet(requestKey(requestId), {
          state: "failed",
          cancelRequested: "0",
          finishedAt
        })
        .exec();
    }
  }

  async enqueueRequest(request: { requestId: string; model: string }) {
    const existing = await this.getRequestSnapshot(request.requestId);

    if (existing) {
      return existing;
    }

    const sequence = await this.client.incr(REDIS_SEQUENCE_KEY);
    const queuedAt = nowIso(this.now);

    await this.client
      .multi()
      .hSet(requestKey(request.requestId), {
        requestId: request.requestId,
        state: "queued",
        model: request.model,
        sequence: String(sequence),
        cancelRequested: "0",
        queuedAt,
        startedAt: "",
        finishedAt: "",
        ownerPodId: ""
      })
      .zAdd(REDIS_PENDING_KEY, {
        score: sequence,
        value: request.requestId
      })
      .exec();

    const snapshot = await this.getRequestSnapshot(request.requestId);
    if (!snapshot) {
      throw new Error(`Failed to enqueue request ${request.requestId}.`);
    }

    return snapshot;
  }

  async claimRequest(requestId: string, podId: string) {
    await this.cleanupStaleRunningRequests();

    const result = (await this.client.eval(CLAIM_SCRIPT, {
      keys: [requestKey(requestId), REDIS_PENDING_KEY, REDIS_RUNNING_KEY],
      arguments: [requestId, podId, String(this.maxParallelRequests), nowIso(this.now)]
    })) as string[] | null;

    return result ? this.snapshotFromScriptResponse(requestId, result) : null;
  }

  async getRequestSnapshot(requestId: string) {
    const request = fromHash(await this.client.hGetAll(requestKey(requestId)));

    if (!request) {
      return null;
    }

    let position: number | undefined;
    let queueDepth = 0;

    if (request.state === "queued") {
      const [rank, depth] = await Promise.all([
        this.client.zRank(REDIS_PENDING_KEY, requestId),
        this.client.zCard(REDIS_PENDING_KEY)
      ]);

      position = rank === null ? undefined : rank + 1;
      queueDepth = depth;
    } else {
      queueDepth = await this.client.zCard(REDIS_PENDING_KEY);
    }

    return {
      requestId: request.requestId,
      state: request.state,
      model: request.model,
      ownerPodId: request.ownerPodId,
      cancelRequested: request.cancelRequested,
      position,
      queueDepth,
      queuedAt: request.queuedAt,
      startedAt: request.startedAt,
      finishedAt: request.finishedAt
    };
  }

  async cancelRequest(requestId: string) {
    const result = (await this.client.eval(CANCEL_SCRIPT, {
      keys: [requestKey(requestId), REDIS_PENDING_KEY],
      arguments: [requestId, nowIso(this.now)]
    })) as string[] | null;

    return result ? this.snapshotFromScriptResponse(requestId, result) : null;
  }

  async updateQueuedRequest(
    requestId: string,
    patch: {
      model?: string;
    }
  ) {
    if (!patch.model) {
      return this.getRequestSnapshot(requestId);
    }

    const result = (await this.client.eval(UPDATE_QUEUED_SCRIPT, {
      keys: [requestKey(requestId), REDIS_PENDING_KEY],
      arguments: [requestId, patch.model]
    })) as string[] | null;

    return result ? this.snapshotFromScriptResponse(requestId, result) : null;
  }

  async finalizeRequest(requestId: string, state: "completed" | "cancelled" | "failed") {
    const result = (await this.client.eval(FINALIZE_SCRIPT, {
      keys: [requestKey(requestId), REDIS_PENDING_KEY, REDIS_RUNNING_KEY],
      arguments: [requestId, state, nowIso(this.now)]
    })) as string[] | null;

    return result ? this.snapshotFromScriptResponse(requestId, result) : null;
  }

  async getQueueStats() {
    await this.cleanupStaleRunningRequests();

    const [activeRequests, queueDepth] = await Promise.all([
      this.client.sCard(REDIS_RUNNING_KEY),
      this.client.zCard(REDIS_PENDING_KEY)
    ]);

    return {
      activeRequests,
      queueDepth
    };
  }

  async subscribeToCancels(listener: (requestId: string) => void) {
    await this.subscriber.subscribe(CANCEL_CHANNEL, (message) => {
      try {
        const payload = JSON.parse(message) as { requestId?: string };

        if (payload.requestId) {
          listener(payload.requestId);
        }
      } catch {
        // Ignore malformed pubsub payloads.
      }
    });

    return async () => {
      await this.subscriber.unsubscribe(CANCEL_CHANNEL);
    };
  }

  async publishCancel(requestId: string) {
    await this.publisher.publish(
      CANCEL_CHANNEL,
      JSON.stringify({
        requestId
      })
    );
  }

  private snapshotFromScriptResponse(requestId: string, result: string[]): QueueRequestSnapshot {
    const [state, model, ownerPodId, cancelRequested, queuedAt, startedAt, finishedAt, position, queueDepth] = result;

    return {
      requestId,
      state: (state as QueueRequestState) ?? "failed",
      model: model ?? "",
      ownerPodId: ownerPodId || undefined,
      cancelRequested: cancelRequested === "1",
      queuedAt: queuedAt || undefined,
      startedAt: startedAt || undefined,
      finishedAt: finishedAt || undefined,
      position: position ? Number(position) : undefined,
      queueDepth: queueDepth ? Number(queueDepth) : undefined
    };
  }
}
