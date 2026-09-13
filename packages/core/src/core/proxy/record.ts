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
// Recording
//
// A `mode: "record"` upstream serves through the `.mock.https` suite, but a
// `replay({ ...index })` call inside a mock forwards to the real `origin` and
// appends the captured exchange to a durable `.https` log. The log is a flat,
// append-only sequence of `>>>` request / `<<<` response blocks; each block's
// lookup key — `hash(index, mock context)` — rides on the `>>>` line as the
// request variant (load-bearing, so not a comment), with the `index` above it
// as a `#` annotation. Replay mode later resolves exchanges by that key.
// Ordering within the file is the order the service issued the calls (see
// docs/design/proxy.md).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { HTTP } from "../formats/http-fmt.js";
import type { FetchObject, ResponseObject } from "../request/fetch-object.js";
import { valueId } from "../../util/value-id.js";
import { KV } from "../formats/kv-fmt.js";

/** One captured exchange, ready to append to a recording log. */
export type RecordedExchange = {
  key: string;
  index: unknown;
  request: FetchObject;
  response: ResponseObject;
};

/** Appends captured exchanges to a durable `.https` log. */
export type Recorder = {
  append(exchange: RecordedExchange): Promise<void>;
};
/**
 * Derive a recording key from the `replay({ ...index })` argument and the mock
 * context (which `.mock.https` matched). A hash keeps the on-disk key compact
 * and opaque for now; the readable `index` is preserved as a log comment.
 */
export function computeRecordKey(index: unknown, context: unknown): string {
  return createHash("sha256")
    .update(`${valueId(context)}\0${valueId(index)}`)
    .digest("hex");
}

/**
 * Turn a testcase name into a safe recording file stem, so the recording path
 * can be derived automatically from the case being run (`<dir>/<slug>.log.https`)
 * rather than configured by hand. Path separators and other unsafe characters
 * collapse to `-`.
 */
export function recordingSlug(testcase: string): string {
  return (
    testcase.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "recording"
  );
}

/**
 * Serialize one exchange as a `>>>`/`<<<` `.https` block. The key is the
 * load-bearing lookup id, so it rides on the `>>>` line as the request variant
 * (where the parser reads it) rather than in a comment; the `index` is a plain
 * annotation comment above it for humans.
 */
export function stringifyExchange(exchange: RecordedExchange): string {
  const { key, index, request, response } = exchange;
  return [
    ...(index
      ? KV.stringify(index ?? {}, { indent: 2, mode: "kv" })
          .split("\n")
          .map((s) => `# ${s}`)
      : []),
    `>>> ${key}`,
    HTTP.stringify(request),
    ``,
    `<<<`,
    HTTP.responseObject.stringify(response),
    ``,
    ``,
  ].join("\n");
}

/**
 * A recorder that appends each exchange to a single `.https` log file. The
 * parent directory is created and the file truncated on open (each recorder owns
 * one testcase's log for one run — a re-record starts fresh, not appended); the
 * exchange appends within that run are serialized through a promise chain so
 * concurrent `replay()` calls don't interleave partial blocks.
 */
export function createHttpsLogRecorder(path: string): Recorder {
  let chain: Promise<unknown> = mkdir(dirname(path), { recursive: true }).then(
    () => writeFile(path, "", "utf-8"),
  );

  return {
    append(exchange) {
      const write = chain.then(() =>
        appendFile(path, stringifyExchange(exchange), "utf-8"),
      );
      // keep the chain alive even if one append rejects, so later writes still run.
      chain = write.catch(() => undefined);
      return write;
    },
  };
}
