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

import {
  createMergingContext,
  createRenderContext,
} from "../../src/core/schema/core/context.js";
import { jsonEncoding } from "../../src/core/schema/definition/encodings/json-encoding.js";
import { base64Encoding } from "../../src/core/schema/definition/encodings/base64-encoding.js";
import { mixing } from "../../src/core/schema/template.js";
import { urlEncodedFormTemplate as urlEncodedFormTemplate } from "../../src/core/schema/definition/encodings/url-encoded.js";
import { deepStrictMatchEqual } from "../asserts.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import { mergeSchema } from "../../src/core/schema/core/schema-utils.js";
import { executeOp, merge } from "../../src/core/schema/core/schema-ops.js";
import { Schema } from "../../src/core/schema/core/types.js";

describe("schema json tests", () => {
  it("should parse and render json", async () => {
    const s = mixing(
      jsonEncoding({
        b: "{{= 10 + a}}",
        a: "{{a = 10}}",
      }),
    );

    const result = await executeOp(s, "render", renderCtx(s));
    assert.equal(typeof result, "string");
    const parsed = JSON.parse(result!);
    assert.deepEqual(parsed, {
      a: 10,
      b: 20,
    });
  });

  it("should parse match base64encoded json", async () => {
    const s = mixing(
      base64Encoding(
        jsonEncoding({
          x: "{{x}}",
          a: "{{a}}",
        }),
      ),
    );

    const sample = Buffer.from(JSON.stringify({ a: "abc", x: "xyz" })).toString(
      "base64",
    );

    const ctx = matchContext(s, sample);
    merge(s, ctx);

    deepStrictMatchEqual(ctx.scope.lookup("a"), { value: "abc" });
    deepStrictMatchEqual(ctx.scope.lookup("x"), { value: "xyz" });
  });

  it("should parse and match a form", async () => {
    const singleValueFormEncoding = mixing(urlEncodedFormTemplate({}, false));

    const s = merge(
      singleValueFormEncoding,
      matchContext(singleValueFormEncoding, `a={{= b.toLowerCase()}}&b={{b}}`),
    )!;

    const t = merge(
      singleValueFormEncoding,
      matchContext(singleValueFormEncoding, `a={{= b == b}}&b={{b}}`),
    )!;

    const ctx = matchContext(s, "b=BbBb");
    merge(s, ctx);
    deepStrictMatchEqual(ctx.scope.lookup("b"), { value: "BbBb" });

    {
      const merged = merge(s, matchContext(s, "b=QRST"));

      const render = renderCtx(merged!);
      const result = await executeOp(merged!, "render", render);

      assert(result?.includes("a=qrst"));
      assert(result?.includes("b=QRST"));
    }

    {
      const merged = merge(t, matchContext(t, "b=qrst"));

      const render = renderCtx(merged!);
      const result = await executeOp(merged!, "render", render);

      assert(result?.includes("a=true"));
      assert(result?.includes("b=qrst"));
    }
  });

  it("should support multivalue forms", async () => {
    const u = mixing(urlEncodedFormTemplate([]));

    const m = mergeSchema(
      { mode: "mux", phase: "build" },
      u,
      "a={{x}}&a={{y}}&b=1&b=2&b=3",
      new ScriptEnvironment(),
    );

    const ctx = matchContext(m.schema!, "a=hello&a=world");
    const merged = merge(m.schema!, ctx);
    const result = await executeOp(merged!, "render", renderCtx(merged!));

    deepStrictMatchEqual(ctx.scope.lookup("x"), {
      value: "hello",
    });
    deepStrictMatchEqual(ctx.scope.lookup("y"), {
      value: "world",
    });

    assert.match(result!, /a=hello[&]a=world/);
    assert.match(result!, /b=1[&]b=2[&]b=3/);
  });

  it("should support missing bodies", async () => {
    const u = mixing(urlEncodedFormTemplate());
    const s = mergeSchema(
      { mode: "mix", phase: "build" },
      u,
      "b=1&b=2&b=3",
      new ScriptEnvironment(),
    )!.schema!;

    const ctx = matchContext(s, undefined);
    const merged = merge(s, ctx);

    const result = await executeOp(merged!, "render", renderCtx(merged!));
    assert.match(result!, /b=1[&]b=2[&]b=3/);
  });

  it("should support multivalue handling", async () => {
    const s = mergeSchema(
      { mode: "mix", phase: "build" },
      mixing(urlEncodedFormTemplate()),
      "a={{x}}",
      new ScriptEnvironment(),
    )!.schema!;

    const ctx = matchContext(s, "a=hello&a=world");
    const merged = merge(s, ctx);
    assert.equal(ctx.scope.lookup("x")?.value, "hello");

    const result = await executeOp(merged!, "render", renderCtx(merged!));
    assert.match(result!, /a=hello[&]a=world/);
  });

  const builtins = {
    Number,
    String,
    Object,
  };

  function matchContext<T>(
    s: Schema<T>,
    primer: Parameters<typeof createMergingContext<T>>[2],
  ) {
    return createMergingContext(
      { mode: "mix", phase: "build" },
      s,
      primer,
      new ScriptEnvironment({
        runtime: builtins,
      }),
    );
  }

  function renderCtx(s: Schema<unknown>) {
    return createRenderContext(
      s,
      new ScriptEnvironment({
        runtime: builtins,
      }),
    );
  }
});
