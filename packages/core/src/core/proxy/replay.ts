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
// Resolution is a strict global cursor over the recorded sequence: `resolve`
// serves the head entry only when its key matches, so a recorded response is
// never served ahead of an earlier, differently-keyed one (see the ordering
// barrier in docs/design/proxy.md). Out-of-order *arrival* tolerance (waiting
// for the cursor to reach a key) is deliberately not built yet; a miss returns
// undefined so the caller can fall back to inventing a response.
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

/** A loaded recording log, resolvable by recording key in sequence order. */
export type Recordings = {
  /**
   * Serve the next recorded response iff it is at the head of the sequence for
   * this key; advance the cursor past it. Returns undefined on a miss (head has
   * a different key, or the sequence is exhausted) — the caller decides the
   * fallback.
   */
  resolve(key: string): ResponseObject | undefined;
  /**
   * Recorded exchanges not yet served (cursor to end). A test isn't complete
   * until this reaches 0 — a positive value means the service made fewer
   * downstream calls than were recorded.
   */
  remaining(): number;
};

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

  let cursor = 0;

  return {
    resolve(key) {
      if (cursor < sequence.length && sequence[cursor].key === key) {
        return sequence[cursor++].response;
      }
      return undefined;
    },
    remaining() {
      return sequence.length - cursor;
    },
  };
}
