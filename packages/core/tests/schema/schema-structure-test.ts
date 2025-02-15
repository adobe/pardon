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
import { describe, it } from "node:test";
import assert from "node:assert";

import { jsonEncoding } from "../../src/core/schema/definition/encodings/json-encoding.js";
import { referenceTemplate } from "../../src/core/schema/definition/structures/reference.js";
import { keyed } from "../../src/core/schema/definition/structures/keyed-list.js";
import { deepStrictMatchEqual } from "../asserts.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import { executeOp, merge } from "../../src/core/schema/core/schema-ops.js";
import { evalBodyTemplate } from "../../src/core/request/body-template.js";
import { Schema, Schematic } from "../../src/core/schema/core/types.js";
import {
  createMergingContext,
  createRenderContext,
} from "../../src/core/schema/core/context.js";
import { mixing } from "../../src/core/schema/core/contexts.js";

describe("schema structure", () => {
  it("should render captures / references", async () => {
    const s = mixing({
      computed: "{{= body.toLowerCase()}}",
      json: referenceTemplate<string[]>({ ref: "json" }),
      body: referenceTemplate({ ref: "body" }).of(
        jsonEncoding(
          referenceTemplate({ ref: "json" }).of(["A", "B", '{{C = "C"}}']),
        ),
      ),
    });

    const result = (await executeOp(s, "render", renderCtx(s)))!;

    assert.equal(result.computed, '["a","b","c"]');
    assert.deepEqual(result.json, ["A", "B", "C"]);

    const ctx2 = renderCtx(s);
    ctx2.evaluationScope.define(ctx2, "C", "D");
    const result2 = (await executeOp(s, "render", ctx2))!;

    assert.equal(result2.computed, '["a","b","d"]');
    assert.deepEqual(result2.json, ["A", "B", "D"]);
  });

  it("should capture key-values", async () => {
    const s = mixing(
      keyed(
        { name: evalBodyTemplate("$key") as Schematic<string> },
        {
          hello: { name: "hello", value: "{{hello}}" },
          world: { name: "world", value: evalBodyTemplate("$world") },
        },
      ),
    );

    const matchCtx = mixContext(s, [
      { name: "world", value: "earth" },
      { name: "hello", value: "hola" },
    ]);

    const merged = merge(s, matchCtx);
    assert(merged);
    deepStrictMatchEqual(matchCtx.evaluationScope.lookup("hello"), {
      value: "hola",
    });
    deepStrictMatchEqual(matchCtx.evaluationScope.lookup("world"), {
      value: "earth",
    });
  });

  it("should capture key-values structure", async () => {
    //    const k = keyed(mixing({ name: "{{key}}" }));

    const s = mixing(
      evalBodyTemplate(`
      keyed({ name: $key }, [{ value: $named.$value }])
    `),
    );

    const matchCtx = mixContext(s, [
      { name: "world", value: "earth" },
      { name: "hello", value: "hola" },
    ]);

    const merged = merge(s, matchCtx);
    assert(merged);
    deepStrictMatchEqual(matchCtx.evaluationScope.resolvedValues(), {
      named: { hello: { value: "hola" }, world: { value: "earth" } },
    });
  });

  const builtins = {
    Number,
    String,
    Object,
  };

  function renderCtx(s: Schema<unknown>) {
    return createRenderContext(
      s,
      new ScriptEnvironment({
        runtime: builtins,
      }),
    );
  }

  function mixContext<T>(
    s: Schema<T>,
    primer: Parameters<typeof createMergingContext<T>>[2],
  ) {
    return createMergingContext(
      { mode: "match", phase: "build" },
      s,
      primer,
      new ScriptEnvironment({
        runtime: builtins,
      }),
    );
  }
});
