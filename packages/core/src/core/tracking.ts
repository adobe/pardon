/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

/**
 * What is this?
 *
 * This implements a utility for tracking work across promise chains.
 * In this system, after executing
 * <code>
 *   await ... something that calls track(x)
 *   await ... some promise that was created after something that called track(y)
 *   track(z)
 * <code>
 * then awaited() would produce a list, [x,y,z].  Critically, this is not just because
 * these register calls were made, but because they were awaited in the current execution.
 *
 * If a register(x) call is awaited multiple times in the same execution, the later ones
 * have no effect on the resulting order.
 *
 * A "shared" utility is provided for promises that are intended to be shared across
 * contexts (e.g., a promise to loads some resource, where that loading is cached),
 * to avoid cross polution of data across these chains.
 *
 * A "disconnected" utility is also provided to drop tracking (supports garbage collection).
 *
 * A "semaphore" utility is provided to manage concurrency.
 *
 * We use this in pardon for correlating dataflow between requests and also for
 * composing an intelligent/stable "environment" object in integration tests.
 *
 * Note that this system creates a *lot* of objects and every access of the awaited() list
 * involves some graph searching.
 *
 * A best-effort is made to garbage collect unreachable data, but this is
 * not particularly performant nor is it designed for use in long-lived systems as its tracking
 * mechanism inherently accumulates information (uses a fair amount of memory).
 */

import { AsyncResource, createHook } from "node:async_hooks";

/**
 * function task() {
 *    await ...;
 *    track("trigger")
 * }
 *
 * track("init");
 *
 * // promise p created with "init" from current execution node and
 * // triggerAsyncId is from task() (not yet resolved), which will provide
 * // "trigger" to awaited eventually.
 * p = task().then(() => {
 *   track("current");
 *
 *   return awaited(); // returns ["init", "trigger", "current"]
 * });
 */
type PromiseExecution = {
  // the promise we created the promise in
  init?: PromiseExecution;
  // the promise this promise is waiting for to start (trigger.then(...))
  trigger?: PromiseResolution;
  // we record the current execution node here when this promise is resolved.
  resolution: PromiseResolution;
  // the values we've tracked in this context. (cloned with copy-on-write semantics)
  tracking?: ValueTracking;
};

type PromiseResolution =
  | {
      promise: PromiseExecution;
      sequence: number;
    }
  | Record<string, never>;

type ValueTracking = WeakMap<TrackingKeyRing, TrackedValue<unknown>[]> &
  WeakMap<PromiseExecution, "owner">;

/**
 * keyed on the asyncId values provided by NodeJS
 * (garbage collected along with the promise objects.)
 */
const promises = new Map<number, PromiseExecution>();
const promiseRegistry = new FinalizationRegistry((asyncId: number) => {
  const record = promises.get(asyncId);

  if (record) {
    // no more init() calls expected with this as the trigger.
    record.resolution = undefined!;
  }

  promises.delete(asyncId);
});

/**
 * This is a shared counter for
 *   1. executions.
 *   2. tracked values in executions.
 *   3. marking the points executions are correlated.
 *
 * One operation might synchronously
 *  - mark A
 *  - mark B
 *  - start operation X
 *  - mark C
 *
 * awaiting the result of X will inherit the A and B values
 * but not C, despite that promise tracking all three.
 */
let executionSequenceCounter = 1;

let promiseAsyncId: number | undefined = undefined;
let currentPromise: PromiseExecution | undefined = undefined;

/**
 * createHook is not recommended by NodeJS, but we use it anyway.
 * (This mechanism basically works as far back as Node16.)
 *
 * From https://nodejs.org/docs/latest-v20.x/api/async_hooks.html#async-hooks
 *
 * Stability: 1 - Experimental. Please migrate away from this API, if you can.
 * We do not recommend using the createHook, AsyncHook, and executionAsyncResource
 * APIs as they have usability issues, safety risks, and performance implications.
 * Async context tracking use cases are better served by the stable AsyncLocalStorage API.
 * If you have a use case for createHook, AsyncHook, or executionAsyncResource
 * beyond the context tracking need solved by AsyncLocalStorage or diagnostics
 * data currently provided by Diagnostics Channel, please open an issue at
 * https://github.com/nodejs/node/issues describing your use case so we can create
 * a more purpose-focused API.
 */
const trackingHook = createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    if (type !== "PROMISE") {
      // TBD: if we remove this most tests do continue to pass
      // except we also get awaited() propagation into other resource types,
      // e.g., setTimeout() functions.
      //
      // On the other hand, before() and after() hooks can be nested for some async resource types,
      // and therefore "currentPromise" may to become a stack and
      // tracked values aggregated at init for all layers of the stack?
      //
      // The mental model was originally only Promise propagation but this could be revisited.
      return;
    }

    promises.set(asyncId, {
      trigger: promises.get(triggerAsyncId)?.resolution,
      init: currentPromise,
      tracking: useTracking(currentPromise),
      resolution: {},
    });

    promiseRegistry.register(resource, asyncId);
  },
  before(asyncId) {
    const promise = promises.get(asyncId);

    if (!promise) {
      return;
    }

    propagateTracking(promise);

    currentPromise = promise;

    // this is largely redundant with executionAsyncId()
    // except it's possible for other async resources.
    //
    // (not sure if this is the correct thing or not)
    promiseAsyncId = asyncId;
  },
  promiseResolve(asyncId) {
    const promise = promises.get(asyncId);

    if (promise && currentPromise) {
      promise.resolution.promise = currentPromise;
      promise.resolution.sequence = executionSequenceCounter++;
    }
  },
  after(asyncId) {
    if (promiseAsyncId === asyncId) {
      promiseAsyncId = undefined;
      currentPromise = undefined;
    }
  },
});

function propagateTracking(into: PromiseExecution) {
  const { trigger: from, init } = into;
  into.trigger = into.init = undefined;

  const resolution = from?.promise;
  const source = useTracking(resolution);

  // one weird case: when resolution === init we must bail.
  // otherwise constructions like
  //   (async () => { await Promise.resolve(); p = Promise.resolve(); track('x'); })();
  //   await ...;
  //   await p;
  // will show 'x' as tracked erroneosly.
  if (!source || resolution === init) {
    return;
  }

  if (into.tracking === undefined) {
    into.tracking = source;

    return;
  }
  
  if (into.tracking === source) {
    return;
  }

  const target = makeValueTracking(into);

  for (let key = sentinelKey.next; key !== sentinelKey; key = key.next) {
    const sourceValues = source.get(key);
    const targetValues = target.get(key);

    if (sourceValues) {
      if (!targetValues) {
        target.set(key, sourceValues);

        continue;
      }

      const seen = new Set<number>();
      function once(n: number) {
        if (seen.has(n)) {
          return false;
        }

        seen.add(n);

        return true;
      }

      for (const { identity } of targetValues) {
        seen.add(identity);
      }

      sourceValues
        .filter(({ identity }) => once(identity))
        .forEach((value) => targetValues.push(value));

      target.set(key, targetValues);
    }
  }
}

type TrackedValue<T> = {
  value: T;
  identity: number;
};

function awaited(
  collector: (tracking: ValueTracking, sequence: number) => void,
): void {
  const tracking = currentPromise?.tracking;

  if (tracking) {
    collector(tracking, Infinity);
  }
}

function _unlink() {
  // disconnect the promise execution graph here.
  // this prevents the fn() from inheriting any
  // values tracked in by the caller.
  currentPromise = undefined;
  promises.delete(promiseAsyncId!);
}

/**
 * Executes a function creating a shared execution promise.
 *
 * "Shared" executions do not receive any tracked values from
 * how they're started, as they are meant to be independent / reusable.
 */
export function shared<T>(fn: () => Promise<T>): Promise<T> {
  if (trackerCount === 0) {
    return fn();
  }

  // disarm the promise before returning it
  let promise: Promise<T>;
  (promise = _shared(fn)).catch(() => {});

  return promise;
}

// helper for shared().
async function _shared<T>(fn: () => T | Promise<T>): Promise<T> {
  await Promise.resolve();
  _unlink();
  await Promise.resolve();

  return await fn();
}

/**
 * do not export any tracking that occurs when running fn.
 *
 * (this should enable improved memory/performance but it does not seem to help yet).
 */
export async function disconnected<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    await Promise.resolve();
    return await fn();
  } finally {
    await _unlink();
  }
}

/**
 * Creates an executor for a specified number of actions concurrently
 * (without introducing dependencies between them.)
 */
export function semaphore(n: number = 1) {
  const todo: (() => Promise<void>)[] = [];

  function drain() {
    while (todo.length > 0 && n > 0) {
      n--;
      const task = todo.shift();

      task!()
        .catch(() => {})
        .finally(() => {
          n++;

          drain();
        });
    }
  }

  return function <T>(action: () => Promise<T> | T): Promise<T> {
    // bridge the tracking context across task execution
    const bridge = Promise.resolve();

    return new Promise((resolve, reject) => {
      async function execute() {
        try {
          _unlink();
          await bridge;
          resolve(await action());
        } catch (error) {
          return reject(error);
        }
      }

      todo.push(AsyncResource.bind(execute));

      Promise.resolve().then(() => {
        _unlink();
        drain();
      });
    });
  };
}

// ------ Tracker System ---------

let trackerCount = 0;
type TrackingKeyRing = {
  next: TrackingKeyRing;
  prev: TrackingKeyRing;
};

const trackerFinalizer = new FinalizationRegistry((key: TrackingKeyRing) => {
  if (--trackerCount == 0) {
    trackingHook.disable();
  }

  removeTrackingKey(key);
});

const sentinelKey: TrackingKeyRing = {} as any;
sentinelKey.next = sentinelKey.prev = sentinelKey;

function createTrackingKey() {
  const { next } = sentinelKey;

  const key: TrackingKeyRing = { prev: sentinelKey, next };
  key.prev.next = key.next.prev = key;

  return key;
}

function removeTrackingKey(key: TrackingKeyRing) {
  key.prev.next = key.next;
  key.next.prev = key.prev;
  key.next = key.prev = key;
}

function useTracking(execution?: PromiseExecution) {
  if (!execution?.tracking) {
    return undefined;
  }

  // activate copy-on-write for future values.
  execution.tracking.delete(execution);

  return execution.tracking;
}

function cloneValueTracking(execution: PromiseExecution) {
  const tracking = new WeakMap() as ValueTracking;
  tracking.set(execution, "owner");

  if (execution.tracking) {
    for (let key = sentinelKey.next; key !== sentinelKey; key = key.next) {
      const values = execution.tracking.get(key);

      if (values) {
        tracking.set(key, [...values]);
      }
    }
  }

  return tracking;
}

function makeValueTracking(execution: PromiseExecution) {
  if (execution.tracking?.has(execution)) {
    return execution.tracking;
  }

  return (execution.tracking = cloneValueTracking(execution));
}

export function tracking<T>() {
  const key = createTrackingKey();

  function currentValues() {
    if (!currentPromise) {
      throw new Error("cannot register, not in an async context");
    }

    const values = makeValueTracking(currentPromise);

    let items = values.get(key);
    if (!items) {
      values.set(key, (items = []));
    }

    return items;
  }

  const tracker = {
    awaited() {
      const tracked: T[] = [];
      const seen = new Set<number>();

      awaited((tracking, sequence) => {
        const list = tracking.get(key);

        if (!list) {
          return;
        }

        for (const item of list) {
          if (item.identity > sequence) {
            break;
          }

          if (seen.has(item.identity)) {
            continue;
          }

          seen.add(item.identity);

          tracked.push(item.value as T);
        }
      });

      return tracked;
    },
    track(value: T) {
      currentValues().push({
        value,
        identity: executionSequenceCounter++,
      });

      return value;
    },
  };

  if (trackerCount++ === 0) {
    trackingHook.enable();
  }

  trackerFinalizer.register(tracker, key);

  return {
    awaited() {
      return tracker.awaited();
    },
    track(value: T) {
      return tracker.track(value);
    },
  };
}

// --- Promise agreggate patching ---
// The regular Promise.all, etc... do not execute
// enough async hooks to track the registrations of all
// the promises.  The following polyfills the behavior
// to await every promise, and adds a couple related additional helpers.

export const all_disconnected: PromiseConstructor["all"] = (
  (all) =>
  async (...[promises]: Parameters<typeof Promise.all>) => {
    const allSettled = await allSettled_disconnected(promises);

    return await all.call(Promise, allSettled.map(disturb));
  }
)(Promise.all);

export async function allSettled_disconnected(
  ...[promises]: Parameters<typeof Promise.allSettled>
) {
  // we need to pre-disarm the list of promises
  // because an unhandled error from value[1]
  // might terminate Node while we're awaiting value[0]
  disarmPromises(promises);

  await Promise.resolve();

  return await new Promise<PromiseSettledResult<unknown>[]>((resolve) => {
    const list: unknown[] = [...promises];
    let remaining = list.length;

    if (remaining === 0) {
      resolve(list as []);
      return;
    }

    list.forEach(async (promise, i) => {
      list[i] = await settle(promise);

      if (--remaining === 0) {
        _unlink();
        resolve(list as PromiseSettledResult<unknown>[]);
      }
    });
  });
}

Promise.all = (
  (all) =>
  async (...[promises]: Parameters<typeof Promise.all>) => {
    // we need to pre-disarm the list of promises
    // because an unhandled error from value[1]
    // might terminate Node while we're awaiting value[0]
    disarmPromises(promises);

    for (const promise of promises) {
      try {
        await promise;
      } catch (error) {
        // ignore
        void error;
      }
    }

    return await all.call(Promise, promises);
  }
)(Promise.all);

Promise.allSettled = (
  (allSettled) =>
  async (...[promises]: Parameters<typeof Promise.allSettled>) => {
    // we need to pre-disarm the list of promises
    // because an unhandled error from value[1]
    // might terminate Node while we're awaiting value[0]
    disarmPromises(promises);

    for (const promise of promises) {
      try {
        await promise;
      } catch (error) {
        // ignore
        void error;
      }
    }

    return await allSettled.call(Promise, promises);
  }
)(Promise.allSettled);

async function settle<T = unknown>(
  promise: Promise<T> | T | unknown,
): Promise<PromiseSettledResult<T>> {
  try {
    return {
      status: "fulfilled",
      value: (await Promise.resolve(promise)) as T,
    };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

async function disturb<T>(settled: PromiseSettledResult<T>): Promise<T> {
  switch (settled.status) {
    case "fulfilled":
      return settled.value;
    case "rejected":
      throw settled.reason;
  }
}

function disarmPromises(promises: Iterable<unknown>) {
  for (const promise of promises) {
    // safe-ish disarm for promise-like values
    if (typeof (promise as Partial<Promise<unknown>>)?.then === "function") {
      (promise as Partial<Promise<unknown>>)?.then?.(
        () => {},
        () => {},
      );
    }
  }
}
