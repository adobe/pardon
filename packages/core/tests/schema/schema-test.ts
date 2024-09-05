/*
Copyright 2024 Adobe. All rights reserved.
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

import { Schema, executeOp } from "../../src/core/schema/core/schema.js";
import {
  createMergingContext,
  createRenderContext,
} from "../../src/core/schema/core/context.js";
import { scalars } from "../../src/core/schema/definition/scalars.js";
import { SchemaError } from "../../src/core/schema/core/schema-error.js";
import { mixing } from "../../src/core/schema/template.js";
import { arrays } from "../../src/core/schema/definition/arrays.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import { mergeSchema } from "../../src/core/schema/core/schema-utils.js";
import { keyed } from "../../src/core/schema/scheming.js";

describe("schema tests", () => {
  it("should create schemas for basic types", async () => {
    const s = mixing("abc");

    assert.equal(await executeOp(s, "render", renderCtx(s)), "abc");
  });

  it("should render expressions", async () => {
    const s = mixing('abc{{pqr = "xyz"}}');

    assert.equal(await executeOp(s, "render", renderCtx(s)), "abcxyz");
  });

  it("should render dependent expressions", async () => {
    const s = mixing('pre{{pqr = "xyz"}}{{abc = pqr.toUpperCase()}}post');

    assert.equal(await executeOp(s, "render", renderCtx(s)), "prexyzXYZpost");
  });

  it("should render dependent expressions either order", async () => {
    const s = mixing('pre{{abc = pqr.toUpperCase()}}{{pqr = "xyz"}}post');

    assert.equal(await executeOp(s, "render", renderCtx(s)), "preXYZxyzpost");
  });

  it("should merge values into templates", async () => {
    const s = mixing(arrays.multivalue(["xqz", "abc{{z}}"].map(mixing)));
    const z = executeOp(s, "merge", mixContext(s, ["xq{{z}}"]))!;

    assert.deepEqual(await executeOp(z, "render", renderCtx(z)), [
      "xqz",
      "abcz",
    ]);
  });

  it("should merge templates into templates into values", async () => {
    const s = mixing("xq7" as string);
    const z = executeOp(s, "merge", mixContext(s, "xq{{z}}"))!;
    const q = executeOp(z, "merge", mixContext(z, "xq{{z}}"))!;

    assert.deepEqual(await executeOp(q, "render", renderCtx(q)), "xq7");
  });

  it("should merge templates into values", async () => {
    const s = mixing(arrays.multivalue(["xq{{z}}", "abc{{z}}"].map(mixing)));
    const z = executeOp(s, "merge", mixContext(s, ["xqz"]))!;

    assert.deepEqual(await executeOp(z, "render", renderCtx(z)), [
      "xqz",
      "abcz",
    ]);
  });

  it("should render objects", async () => {
    const s = mixing({
      a: "b",
      c: "d",
    });

    assert.deepStrictEqual(await executeOp(s, "render", renderCtx(s)), {
      a: "b",
      c: "d",
    });
  });

  it("should match and renders resolved", async () => {
    const s = mixing({
      a: "{{x}}",
    });

    executeOp(s, "merge", mixContext(s, { a: "xyz" }, { x: "xyz" }));

    assert.deepStrictEqual(
      await executeOp(s, "render", renderCtx(s, { x: "xyz" })),
      {
        a: "xyz",
      },
    );
  });

  it("should reject mismatched resolutions", async () => {
    const s = mixing({
      a: "{{x}}",
      b: "{{x}}",
    });

    assert.throws(
      () => {
        const ctx = mixContext(s, { a: "abc", b: "xyz" });
        executeOp(s, "merge", ctx);
      },
      (error) => {
        assert(error instanceof SchemaError);
        console.log(error.note);
        assert(error.note?.startsWith("redefined:x"));
        return true;
      },
    );
  });

  it("should render objects with expressions", async () => {
    const s = mixing({
      a: scalars.number("{{abc = 1 + 1}}"),
      b: scalars.number("{{xyz = 2 + 2}}"),
      c: "{{pqr = abc + xyz}}",
    });

    assert.deepStrictEqual(await executeOp(s, "render", renderCtx(s)), {
      a: 2,
      b: 4,
      c: 6,
    });
  });

  it("should match objects without all values", async () => {
    const s = mixing({
      a: scalars.number("{{abc = 1 + 1}}"),
      b: scalars.number("{{xyz = 2 + 2}}"),
      c: "{{pqr = abc + xyz}}",
      d: { x: "{{d}}" },
    });
    const ctx = mixContext(s, { a: 7, b: 10 } as any);
    const result = executeOp(s, "merge", ctx);
    assert(result);
  });

  it("should match required properties", async () => {
    const s = mixing({
      x: { d: "{{!d}}" as string | number },
    });
    const ctx = matchContext(s, { a: 7, b: 10 } as any);
    const result = executeOp(s, "merge", ctx);
    assert.strictEqual(result, undefined);
    assert.equal(ctx.diagnostics[0].loc, "|.x.d");
  });

  it("should mix missing required properties", async () => {
    const s = mixing({
      x: { d: "{{!d}}" as string | number },
    });

    executeOp(s, "merge", mixContext(s, { a: 7, b: 10 } as any));
  });

  it("should capture values in arrays", () => {
    const s = mixing({
      list: [
        {
          a: "{{a}}" as string | number,
          b: "{{b}}" as string | number,
        },
      ],
    });

    executeOp(
      s,
      "merge",
      mixContext(s, {
        list: [
          { a: 2, b: 3 },
          { a: 5, b: 8 },
        ],
      }),
    );
  });

  it("should merge and then render values in scope", async () => {
    const s = mixing({
      global: scalars.number("{{g = '100'}}"),
      a: "{{a = 1}}",
      b: "{{b = 1}}",
      ab: "{{?ab = a + b}}",
      list: [
        {
          a: "{{a}}" as string | number,
          b: "{{b}}" as string | number,
          c: "{{c = Number(g) + a + b}}" as string | number,
          ab: "{{ab}}" as string | number,
        },
      ],
    });

    const merged = executeOp(
      s,
      "merge",
      mixContext(s, {
        list: [
          { a: 2, b: 3 },
          { a: 5, b: 8 },
        ],
      }),
    );

    const rendered = await executeOp(merged!, "render", renderCtx(merged!));

    assert.deepStrictEqual(rendered, {
      global: 100,
      a: 1,
      b: 1,
      ab: 2,
      list: [
        { a: 2, b: 3, c: 105, ab: 2 },
        { a: 5, b: 8, c: 113, ab: 2 },
      ],
    });
  });

  it("should not allow double definitions", async () => {
    const s = mixing({
      xy: "{{x}}123",
      xx: "{{x}}345",
    });

    const merged = executeOp(
      s,
      "merge",
      mixContext(s, {
        xy: "abc123",
        xx: "abc345",
      }),
    )!;

    const result = await executeOp(merged, "render", renderCtx(merged));

    assert.deepEqual(result, { xy: "abc123", xx: "abc345" });
  });

  it("should match with evaluated values", async () => {
    let s = mixing({
      list: [
        {
          c: "{{c = p}}",
          a: "{{p}}:{{qqq}}",
        },
      ],
    });

    s = executeOp(
      s,
      "merge",
      createMergingContext({ mode: "mux", phase: "build" }, s, {
        list: [
          {
            a: "{{a = 'a:a:a'}}:q:q",
          },
        ],
      }),
    )!;

    const rendered = await executeOp(s, "render", renderCtx(s));

    assert.deepStrictEqual(rendered, {
      list: [
        {
          c: "a:a:a:q",
          a: "a:a:a:q:q",
        },
      ],
    });
  });

  it("should match with evaluated values - partial known", async () => {
    let s = mixing({
      list: [
        {
          c: "{{@c = p}}",
          a: "{{p}}:{{qqq}}",
        },
      ],
    });

    s = executeOp(
      s,
      "merge",
      muxContext(s, {
        list: [
          {
            a: "{{@a = 'a:a:a'}}:{{qqq = 'q:q'}}",
          },
        ],
      }),
    )!;

    const rendered = await executeOp(s, "render", renderCtx(s));

    assert.deepStrictEqual(rendered, {
      list: [
        {
          c: "a:a:a",
          a: "a:a:a:q:q",
        },
      ],
    });
  });

  // compare with mix
  it("should match templates as literals", async () => {
    const schema = mixing({
      a: "{{a}}",
    });

    const matchCtx = createMergingContext(
      { mode: "match", phase: "validate" },
      schema,
      {
        a: "{{abc}}",
        b: "{{xyz}}",
      } as any,
    );
    const result = executeOp(schema, "merge", matchCtx)!;

    const rendered = await executeOp(result, "render", renderCtx(result));

    assert.deepEqual(rendered, {
      a: "{{abc}}",
      b: "{{xyz}}",
    });
  });

  it("should bind to structural values", async () => {
    const schema = mixing({
      a: ["{{a.item}}"],
    });

    const matchCtx = createMergingContext(
      { mode: "match", phase: "validate" },
      schema,
      {
        a: ["x", "y"],
      } as any,
    );

    executeOp(schema, "merge", matchCtx)!;

    console.log(matchCtx.scope.subscopes);
    assert.deepEqual(matchCtx.scope.resolvedValues(), {
      a: [{ item: "x" }, { item: "y" }],
    });
  });

  it("should bind to structural values 2", async () => {
    const schema = mixing({
      a: [{ item: "{{list.item}}" }],
    });

    const matchCtx = createMergingContext(
      { mode: "match", phase: "validate" },
      schema,
      {
        a: [{ item: "x" }, { item: "y" }],
      } as any,
    );

    executeOp(schema, "merge", matchCtx)!;

    console.log(matchCtx.scope.subscopes);
    assert.deepEqual(matchCtx.scope.resolvedValues(), {
      list: [{ item: "x" }, { item: "y" }],
    });
  });

  it("should bind to structural values 3", async () => {
    const schema = mixing({
      a: [["{{q.sublist.item}}"]],
    });

    const matchCtx = createMergingContext(
      { mode: "match", phase: "validate" },
      schema,
      {
        a: [
          ["x", "y"],
          ["p", "q", "r"],
        ],
      } as any,
    );

    executeOp(schema, "merge", matchCtx)!;

    console.log(JSON.stringify(matchCtx.scope.resolvedValues(), null, 2));

    assert.deepEqual(matchCtx.scope.resolvedValues(), {
      q: [
        { sublist: [{ item: "x" }, { item: "y" }] },
        { sublist: [{ item: "p" }, { item: "q" }, { item: "r" }] },
      ],
    });
  });

  it("should render with structural values", async () => {
    const schema = mixing({
      a: [{ item: "{{list.item}}" }],
    });

    const { schema: mux } = mergeSchema(
      { mode: "mux", phase: "build" },
      schema,
      {
        a: [{}, {}],
      } as any,
    );

    const result = await executeOp(
      mux!,
      "render",
      createRenderContext(
        mux!,
        new ScriptEnvironment({
          input: {
            list: [{ item: "x" }, { item: "y" }],
          },
        }),
      ),
    )!;

    assert.deepEqual(result, {
      a: [{ item: "x" }, { item: "y" }],
    });
  });

  it("should render with structural values", async () => {
    const schema = mixing({
      a: ["{{list.@value}}"],
    });

    const result = await executeOp(
      schema,
      "render",
      createRenderContext(
        schema,
        new ScriptEnvironment({
          input: {
            list: ["a", "b", "c"],
          },
        }),
      ),
    )!;

    assert.deepEqual(result, {
      a: ["a", "b", "c"],
    });
  });

  it("should export structural values", async () => {
    const schema = mixing({
      a: ["{{list.@value}}"],
    });

    const result = mergeSchema({ mode: "match", phase: "validate" }, schema, {
      a: ["a", "b", "c", "d"],
    });

    assert.deepEqual(result!.context.scope.resolvedValues(), {
      list: ["a", "b", "c", "d"],
    });
  });

  it("should not export secret structural values", async () => {
    const schema = mixing({
      a: ["{{@list.@value}}"],
    });

    const result = mergeSchema({ mode: "match", phase: "validate" }, schema, {
      a: ["a", "b", "c", "d"],
    });

    assert.deepEqual(
      result!.context.scope.resolvedValues({ secrets: false }),
      {},
    );

    assert.deepEqual(result!.context.scope.resolvedValues({ secrets: true }), {
      list: ["a", "b", "c", "d"],
    });
  });

  it("should infer structural values length", async () => {
    const schema = mixing({
      a: [{ item: "{{a.v}}", ITEM: "{{ = v.toUpperCase() }}" }],
    });

    const result = await executeOp(
      schema,
      "render",
      createRenderContext(
        schema,
        new ScriptEnvironment({
          input: {
            a: [{ v: "x" }, { v: "y" }],
          },
        }),
      ),
    )!;

    assert.deepEqual(result, {
      a: [
        { item: "x", ITEM: "X" },
        { item: "y", ITEM: "Y" },
      ],
    });
  });

  it("should infer deep structural values length", async () => {
    const schema = mixing({
      a: [["{{q.sublist.item}}"]],
    });

    const matchCtx = createMergingContext(
      { mode: "match", phase: "validate" },
      schema,
      {
        a: [
          ["x", "y"],
          ["p", "q", "r"],
        ],
      } as any,
    );

    executeOp(schema, "merge", matchCtx)!;

    console.log(JSON.stringify(matchCtx.scope.resolvedValues(), null, 2));

    assert.deepEqual(matchCtx.scope.resolvedValues(), {
      q: [
        { sublist: [{ item: "x" }, { item: "y" }] },
        { sublist: [{ item: "p" }, { item: "q" }, { item: "r" }] },
      ],
    });
  });

  it("should render complex values", async () => {
    const schema = mixing({
      a: [["{{q.sublist.item}}"]],
    });

    const result = await executeOp(
      schema,
      "render",
      createRenderContext(
        schema,
        new ScriptEnvironment({
          input: {
            q: [
              { sublist: [{ item: "x" }, { item: "y" }] },
              { sublist: [{ item: "p" }, { item: "q" }, { item: "r" }] },
            ],
          },
        }),
      ),
    )!;

    assert.deepEqual(result, {
      a: [
        ["x", "y"],
        ["p", "q", "r"],
      ],
    });
  });

  it("should render map of headers", async () => {
    const schema = mixing({
      a: keyed(
        ["{{key}}", undefined],
        [["{{headers.@key}}", "{{headers.value}}"]],
      ),
    });

    const result = await executeOp(
      schema,
      "render",
      createRenderContext(
        schema,
        new ScriptEnvironment({
          input: {
            headers: {
              a: { value: "AAA" },
              b: { value: "BBB" },
            },
          },
        }),
      ),
    )!;

    assert.deepEqual(result, {
      a: [
        ["a", "AAA"],
        ["b", "BBB"],
      ],
    });
  });

  it("should render a simple map", async () => {
    const schema = mixing({
      a: keyed(
        ["{{key}}", "{{value}}"],
        [["{{headers.@key}}", "{{headers.@value}}"]],
      ),
    });

    const result = await executeOp(
      schema,
      "render",
      createRenderContext(
        schema,
        new ScriptEnvironment({
          input: {
            headers: {
              a: "AAA",
              b: "BBB",
            },
          },
        }),
      ),
    )!;

    assert.deepEqual(result, {
      a: [
        ["a", "AAA"],
        ["b", "BBB"],
      ],
    });
  });

  it("should export an object map", async () => {
    const schema = mixing({
      a: keyed(
        ["{{key}}", undefined],
        [["{{headers.@key}}", "{{headers.value}}"]],
      ),
    });

    const result = mergeSchema({ mode: "match", phase: "validate" }, schema, {
      a: [
        ["a", "AAA"],
        ["b", "BBB"],
      ],
    })?.context;

    assert.deepEqual(result!.scope.resolvedValues(), {
      headers: {
        a: { value: "AAA" },
        b: { value: "BBB" },
      },
    });
  });

  function mixContext<T>(
    s: Schema<T>,
    primer: Parameters<typeof createMergingContext<T>>[2],
    definitions?: Record<string, unknown>,
  ) {
    return createMergingContext(
      { mode: "mix", phase: "validate" },
      s,
      primer,
      new ScriptEnvironment({
        runtime: { ...builtins, ...definitions },
      }),
    );
  }

  function muxContext<T>(
    s: Schema<T>,
    primer: Parameters<typeof createMergingContext<T>>[2],
    definitions?: Record<string, unknown>,
  ) {
    return createMergingContext(
      { mode: "mux", phase: "build" },
      s,
      primer,
      new ScriptEnvironment({
        runtime: { ...builtins, ...definitions },
      }),
    );
  }

  function matchContext<T>(
    s: Schema<T>,
    primer: Parameters<typeof createMergingContext<T>>[2],
    definitions?: Record<string, unknown>,
  ) {
    return createMergingContext(
      { mode: "match", phase: "validate" },
      s,
      primer,
      new ScriptEnvironment({
        runtime: { ...builtins, ...definitions },
      }),
    );
  }

  const builtins = {
    Number,
    String,
    Object,
  };

  function renderCtx(s: Schema<unknown>, init?: Record<string, string>) {
    return createRenderContext(
      s,
      new ScriptEnvironment({
        input: init,
        runtime: builtins,
      }),
    );
  }
});
