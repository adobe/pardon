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

import { after, describe, it } from "node:test";

import setup from "../app-tests.js";
import assert from "node:assert";
import { initTrackingEnvironment } from "../../src/runtime/environment.js";
import { runFlow, makeFlow } from "../../src/core/execution/flow/flow-core.js";

describe("flow-fn-tests", async () => {
  after(await setup());
  await initTrackingEnvironment();

  it("should have context", async () => {
    const log: string[] = [];

    const flow = makeFlow(async ({ arg }) => {
      log.push("flow-executed");
      return { arg: arg.toUpperCase() };
    });

    environment.arg = "hello";
    assert.deepStrictEqual((await runFlow(flow, { ...environment })).result, {
      arg: "HELLO",
    });
    assert.deepStrictEqual(log.splice(0, log.length), ["flow-executed"]);

    environment = null!;
    await assert.rejects(() => runFlow(flow, { ...environment }), {
      message: "required param arg undefined",
    });
    assert.deepStrictEqual(log.splice(0, log.length), []);
  });
});
