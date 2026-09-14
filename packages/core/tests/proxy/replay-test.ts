/*
Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
import { after, before, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";

import { createHttpsLogRecorder } from "../../src/core/proxy/record.js";
import { loadRecordings } from "../../src/core/proxy/replay.js";

// Unit tests for the replay ordering barrier: responses are serialized to the
// recorded order while tolerating out-of-order *arrival* — an early request for
// a later key is delayed (parked) until the earlier entries are served, not
// missed. Out-of-budget/unknown calls are errors that invalidate the replay.

let workspace: string;

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pardon-replay-"));
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Write a recording log whose exchanges carry the given `(key, body)` in order. */
async function recordLog(
  name: string,
  entries: [key: string, body: string][],
): Promise<string> {
  const path = join(workspace, `${name}.log.https`);
  const recorder = createHttpsLogRecorder(path);
  for (const [key, body] of entries) {
    await recorder.append({
      key,
      request: {
        method: "GET",
        origin: "https://svc.example",
        pathname: `/${body}`,
        headers: new Headers(),
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        body,
      },
    });
  }
  return path;
}

it("delays an early arrival until its recorded turn, then serves in order", async () => {
  const log = await recordLog("ordered", [
    ["A", "first"],
    ["B", "second"],
  ]);
  const recordings = loadRecordings(log);

  // B arrives first, but it is recorded second — it must park behind A.
  let bServed = false;
  const bPromise = recordings.resolve("B").then((r) => {
    bServed = true;
    return r;
  });

  await tick();
  assert.equal(bServed, false, "B is held at the barrier until A is served");
  assert.equal(recordings.remaining(), 2, "nothing drained while B waits on A");

  // A arriving releases A, then unblocks B behind it.
  const a = await recordings.resolve("A");
  const b = await bPromise;

  assert.equal(a.body, "first");
  assert.equal(b.body, "second");
  assert.equal(recordings.remaining(), 0);
  assert.equal(recordings.valid(), true);
});

it("serves repeats of the same key positionally, in recorded order", async () => {
  const log = await recordLog("dupes", [
    ["A", "one"],
    ["A", "two"],
    ["A", "three"],
  ]);
  const recordings = loadRecordings(log);

  const r1 = await recordings.resolve("A");
  const r2 = await recordings.resolve("A");
  const r3 = await recordings.resolve("A");

  assert.deepEqual([r1.body, r2.body, r3.body], ["one", "two", "three"]);
  assert.equal(recordings.remaining(), 0);
  assert.equal(recordings.valid(), true);
});

it("errors and invalidates on an out-of-budget or unknown call", async () => {
  const log = await recordLog("scarce", [["A", "only"]]);
  const recordings = loadRecordings(log);

  assert.equal((await recordings.resolve("A")).body, "only");

  // a second A: budget spent -> 409, replay invalid.
  const extra = await recordings.resolve("A");
  assert.equal(extra.status, 409);
  assert.match(extra.body ?? "", /unexpected extra call/);
  assert.equal(recordings.valid(), false, "an extra call invalidates replay");

  // an unknown key -> 409 too (no recorded call for it).
  const unknown = await recordings.resolve("Z");
  assert.equal(unknown.status, 409);
  assert.match(unknown.body ?? "", /no recorded call/);
});

it("release() unhangs parked requests and invalidates", async () => {
  const log = await recordLog("stuck", [
    ["A", "first"],
    ["B", "second"],
  ]);
  const recordings = loadRecordings(log);

  // B parks waiting for A, which never arrives (service made fewer calls).
  const bPromise = recordings.resolve("B");
  await tick();
  assert.equal(recordings.remaining(), 2);

  recordings.release();

  const b = await bPromise;
  assert.equal(b.status, 409, "the hung request is freed with an error");
  assert.equal(recordings.valid(), false);
});
