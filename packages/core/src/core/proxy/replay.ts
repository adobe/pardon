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

// ---------------------------------------------------------------------------
// Replay
//
// The read side of ./record.ts. A `mode: "replay"` upstream loads the durable
// `.https` log written during recording and resolves `replay({ ...index })`
// calls against it — by the same `hash(index, mock context)` key — instead of
// forwarding to a real origin.
//
// Resolution serializes replayed responses to the *recorded* order while
// tolerating out-of-order *arrival*. Each key carries a budget (how many times
// it was recorded) and a FIFO of parked requests:
//
//   - A request immediately claims a slot for its key (decrementing the budget)
//     and parks. If the budget is already spent — an unexpected or unknown call —
//     it gets an error response and the whole replay is flagged invalid (a stray
//     4xx/5xx need not fail the service, so the test must fail on `valid()`).
//   - We then drain from the head of the recorded sequence: the head response is
//     released only once a request for *its* key has parked. An early arrival for
//     a later key therefore waits (delayed, not missed) behind the earlier one.
//
// Because every released response first claimed a slot and there are exactly
// `sequence.length` slots, a parked request always implies an undrained head —
// so `remaining() === 0` (cursor exhausted) already means nothing is parked;
// completeness needs no separate waiter accounting.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { PardonError } from "../error.js";
import type { ResponseObject } from "../request/fetch-object.js";
import {
  HTTPS,
  isHttpRequestStep,
  isHttpResponseStep,
} from "../formats/https-fmt.js";

/** A loaded recording log, resolvable by recording key in recorded order. */
export type Recordings = {
  /**
   * Claim the next recorded slot for `key` and resolve once it reaches the head
   * of the recorded sequence (parking until earlier, differently-keyed entries
   * have been served). If no budget remains for `key` — an unexpected/unknown
   * call — resolves immediately with an error response and marks the replay
   * invalid (see `valid`).
   */
  resolve(key: string): Promise<ResponseObject>;
  /**
   * Recorded exchanges not yet served (cursor to end). A test isn't complete
   * until this reaches 0 — a positive value means the service made fewer
   * downstream calls than were recorded. `0` also implies nothing is parked.
   */
  remaining(): number;
  /**
   * Whether every `resolve` so far had a recorded slot to draw from. Turns false
   * on the first out-of-budget/unknown-key call — a violation the service may
   * have swallowed, so the test consults this even when `remaining()` is 0.
   */
  valid(): boolean;
  /**
   * Release any still-parked requests with an error response (so their proxied
   * connections don't hang) and mark the replay invalid. Called once at
   * finish/timeout when the service made fewer downstream calls than recorded.
   */
  release(): void;
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function replayError(message: string): ResponseObject {
  return {
    status: 409,
    statusText: "Replay Conflict",
    headers: new Headers({ "content-type": "text/plain" }),
    body: `${message}\n`,
  };
}

/** Load and parse a recording log into an ordered `(key, response)` sequence. */
export function loadRecordings(path: string, cwd = process.cwd()): Recordings {
  const full = resolvePath(cwd, path);

  let text: string;
  try {
    text = readFileSync(full, "utf-8");
  } catch {
    throw new PardonError(`replay: recordings log not found: ${full}`);
  }

  const { steps } = HTTPS.parse(text);
  const sequence: { key: string; response: ResponseObject }[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!isHttpRequestStep(step)) {
      continue;
    }

    const key = step.variant;
    const next = steps[i + 1];
    if (!key || !next || !isHttpResponseStep(next)) {
      throw new PardonError(
        `replay: malformed recording in ${full} (each >>> <key> must be followed by a <<< response)`,
      );
    }

    const { status, statusText, headers, body } = next;
    sequence.push({ key, response: { status, statusText, headers, body } });
  }

  // per-key budget (unclaimed occurrences) + FIFO of parked requests for it.
  const byKey = new Map<string, { count: number; pending: Deferred<ResponseObject>[] }>();
  for (const { key } of sequence) {
    const bucket = byKey.get(key) ?? { count: 0, pending: [] };
    bucket.count++;
    byKey.set(key, bucket);
  }

  let cursor = 0;
  let valid = true;

  // release the head response as soon as a request for its key has parked;
  // one arrival can unblock a run of consecutive same-nexted entries.
  function drain() {
    while (cursor < sequence.length) {
      const head = sequence[cursor];
      const bucket = byKey.get(head.key)!;
      if (bucket.pending.length === 0) {
        break; // head's request hasn't arrived yet — hold the barrier
      }
      cursor++;
      bucket.pending.shift()!.resolve(head.response);
    }
  }

  return {
    resolve(key) {
      const bucket = byKey.get(key);
      if (!bucket || bucket.count === 0) {
        valid = false;
        return Promise.resolve(
          replayError(
            bucket
              ? `replay: unexpected extra call for key ${key.slice(0, 12)}…`
              : `replay: no recorded call for key ${key.slice(0, 12)}…`,
          ),
        );
      }

      bucket.count--;
      const slot = deferred<ResponseObject>();
      bucket.pending.push(slot);
      drain();
      return slot.promise;
    },
    remaining() {
      return sequence.length - cursor;
    },
    valid() {
      return valid;
    },
    release() {
      for (const bucket of byKey.values()) {
        while (bucket.pending.length > 0) {
          valid = false;
          bucket.pending
            .shift()!
            .resolve(replayError("replay: recording finished with calls pending"));
        }
      }
    },
  };
}
