export function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000, intervalMs = 20) {
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      void Promise.resolve(predicate())
        .then((matched) => {
          if (matched) {
            resolve();
            return;
          }

          if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error(`Timed out after ${timeoutMs}ms waiting for condition.`));
            return;
          }

          setTimeout(tick, intervalMs);
        })
        .catch(reject);
    };

    tick();
  });
}

export function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}
