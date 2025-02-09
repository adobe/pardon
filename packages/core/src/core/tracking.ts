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
 * This is a utility for tracking work across promise chains.
 * It implements a new kind of object scope / lifetime, which could be described
 * by words like "after" or "awaited".
 *
 * A tracking context is created with `const { track, awaited } = tracking();`
 *
 * Then after running
 * <code>
 *   const p_of_x = (async () => { await something(); track(x); })();
 *   const p_of_y = (async () => { await somethingElse(); track(y); })();
 *   track(s)
 *   await p_of_x;
 *   await p_of_y;
 *   track(t)
 * <code>
 * awaited() will produce a list of [s,x,y,t]; in the await-ed order;
 * regardless of whether x or y was (by the clock) tracked "first".
 *
 * We use this in pardon for correlating dataflow between requests and also for
 * managing a global/contextual "environment" object in tests that run concurrently.
 *
 * --- Internal Implementation Guide ---
 *
 * async_hooks provides callbacks when a promise is created, when it is resolved,
 * as well as before and after execution hooks.
 *
 * For each promise object, we store an execution object (identified by
 * execution async id).  The execution object contains a mapping of tracked objects.
 * That mapping itself is a WeakMap, keyed by a tokens stored in a linked list: each
 * token represents a tracking() context.  A FinalizationRegistry removes tokens from the
 * linked list if a context becomes inaccessible, which then allows the WeakMaps to
 * drop their tracked values.
 *
 * In order to help garbage collect tracked values: the promise->execution mapping
 * itself is cleaned (also via a FinalizationRegistry) when its promise is removed.
 *
 * When new promises are created, we can propagate the current executions tracked-values mapping
 * into the new promise.  An ownership and copy-on-write mechanism allows the map
 * to be propagated without cloning in many cases.
 */

import { AsyncResource, createHook } from "node:async_hooks";

type PromiseExecution = {
  init?: PromiseExecution;
  trigger?: PromiseResolution;
  resolution: PromiseResolution;
  values?: TrackedValues;
};

type PromiseResolution =
  | {
      promise: PromiseExecution;
    }
  | Record<string, never>;

type TrackedValues = WeakMap<TrackingKeyRing, TrackedValue<unknown>[]> &
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
 * A counter that provides unique IDs to tracked values.
 */
let trackedValueCounter = 1;

let promiseAsyncId: number | undefined = undefined;
let currentExecution: PromiseExecution | undefined = undefined;

/**
 * createHook is not recommended by NodeJS, but we use it anyway.
 * (This mechanism works as far back as Node16, perhaps earlier.)
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
      // and therefore "currentExecution" should become a stack?
      return;
    }

    // the promise for the future execution here is downstream
    // of both the init (context) of where/when the promise is created
    // and the trigger promise that preceeds execution.
    //
    // init() {
    //   promise = trigger.then(() => { ...execution... });
    // }

    promises.set(asyncId, {
      init: currentExecution,
      trigger: promises.get(triggerAsyncId)?.resolution,
      values: useTracking(currentExecution),
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

    currentExecution = promise;

    /*
     * There are some async types that stack with promises.
     * In order to unset the currentExecution in the
     * after() hook we need to identify the promise asyncId?
     */
    promiseAsyncId = asyncId;
  },
  promiseResolve(asyncId) {
    const promise = promises.get(asyncId);

    if (promise && currentExecution) {
      promise.resolution.promise = currentExecution;
    }
  },
  after(asyncId) {
    if (promiseAsyncId !== asyncId) {
      return;
    }

    promiseAsyncId = undefined;
    currentExecution = undefined;
  },
});

function propagateTracking(into: PromiseExecution) {
  const { trigger, init } = into;
  into.trigger = into.init = undefined;

  // one weird case: when resolution === init we bail.
  //
  // otherwise constructions like
  //   (async () => { await (null! as Promise<void>); p = Promise.resolve(); track('x'); })();
  //   await ...;
  //   await p;
  //
  // can show 'x' as tracked by p even though it's tracked after p's creation.
  const resolution = trigger?.promise;
  if (resolution === init) {
    return;
  }

  const source = useTracking(resolution);
  if (!source) {
    return;
  }

  if (into.values === undefined) {
    into.values = source;

    return;
  }

  if (into.values === source) {
    return;
  }

  const target = copyTrackingBeforeWrite(into);

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

function awaited(collector: (tracking: TrackedValues) => void): void {
  const tracking = currentExecution?.values;

  if (tracking) {
    collector(tracking);
  }
}

function _unlink() {
  // disconnect the promise execution graph here.
  // this prevents the fn() from inheriting any
  // values tracked in by the caller.
  currentExecution = undefined;
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
  await (null! as Promise<void>);
  _unlink();
  await (null! as Promise<void>);

  return await fn();
}

/**
 * do not export any tracking that occurs when running fn.
 *
 * (this should enable improved memory/performance but it does not seem to help yet).
 */
export async function disconnected<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    await (null! as Promise<void>);
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
  if (!execution?.values) {
    return undefined;
  }

  // activate copy-on-write for future values.
  execution.values.delete(execution);

  return execution.values;
}

function copyTrackingBeforeWrite(execution: PromiseExecution) {
  if (execution.values?.has(execution)) {
    return execution.values;
  }

  const tracking = new WeakMap() as TrackedValues;
  tracking.set(execution, "owner");

  if (execution.values) {
    for (let key = sentinelKey.next; key !== sentinelKey; key = key.next) {
      const values = execution.values.get(key);

      if (values) {
        tracking.set(key, [...values]);
      }
    }
  }

  return (execution.values = tracking);
}

export function tracking<T>() {
  const key = createTrackingKey();

  function currentValues() {
    if (!currentExecution) {
      throw new Error("cannot register, not in an async context");
    }

    const values = copyTrackingBeforeWrite(currentExecution);

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

      awaited((tracking) => {
        const list = tracking.get(key);

        if (!list) {
          return;
        }

        for (const item of list) {
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
        identity: trackedValueCounter++,
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

  await (null! as Promise<void>);

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
