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
import { it } from "node:test";
import { describeCases } from "../../src/modules/playground.js";
import assert from "node:assert";

it("testcase-formatting", async () => {
  const cases = (
    await describeCases(({ format, set, each, local }) => {
      local(() => {
        set("x-y", each("x", "y"));
        set("p-q", each("p", "q"));
      }).export(set("n", format("%(x-y)-%{p-q}")));
    })
  ).map(({ environment }) => environment);

  assert.deepEqual(cases, [
    { n: "x-p" },
    { n: "x-q" },
    { n: "y-p" },
    { n: "y-q" },
  ]);
});
