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
import {
  createMergingContext,
  createRenderContext,
} from "../../src/core/schema/core/context.js";
import { intoSearchParams } from "../../src/core/request/search-pattern.js";
import assert from "node:assert";
import { deepMatchEqual } from "../asserts.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import {
  mergeSchema,
  renderSchema,
} from "../../src/core/schema/core/schema-utils.js";
import { executeOp, merge } from "../../src/core/schema/core/schema-ops.js";
import { Schema } from "../../src/core/schema/core/types.js";
import {
  applyTsMorph,
  jsonSchemaTransform,
} from "../../src/core/evaluation/expression.js";
import { httpsRequestSchema } from "../../src/core/request/https-template.js";

describe("https-schema-tests", () => {
  it("should abc", async () => {
    const jsonBaseSchema = httpsRequestSchema("json", {
      search: { multivalue: false },
    });

    const matchingContext = mixContext(jsonBaseSchema, {
      origin: "https://www.example.com",
      pathname: "/test",
      searchParams: intoSearchParams([
        ["a", "{{a}}"],
        ["c", "d"],
        ["m", "{{a}}"],
        ["m", "2"],
      ]),
      headers: new Headers([
        ["Content-Type", "json"],
        ["xyz", "w"],
      ]),
      body: '{ "hello": "world", "queryParam": { "a": "{{a=\'100\'}}" } }',
    });

    const httpsPattern = merge(jsonBaseSchema, matchingContext)!;

    const mctx = mixContext(httpsPattern, {
      origin: "https://www.example.com",
      pathname: "/test",
      searchParams: intoSearchParams("?hello=world"),
      headers: new Headers({ hello: "world" }),
      body: "{}",
    });
    const extended = merge(httpsPattern, mctx)!;

    mctx.evaluationScope.lookup("a");

    const rctx = renderCtx(httpsPattern);
    const rendered = await executeOp(httpsPattern, "render", rctx);

    assert((rendered?.searchParams?.has as any)("c", "d"));
    deepMatchEqual(rendered, {
      origin: "https://www.example.com",
      pathname: "/test",
      method: "GET",
      searchParams: intoSearchParams("?a=100&c=d&m=100&m=2"),
    });

    const renderExtended = await executeOp(
      extended,
      "render",
      renderCtx(httpsPattern),
    );

    assert.equal(renderExtended?.headers?.get("hello"), "world");

    deepMatchEqual(renderExtended, {
      origin: "https://www.example.com",
      pathname: "/test",
      method: "GET",
      searchParams: intoSearchParams("?a=100&c=d&m=100&m=2"),
    });
  });

  it("should something todo", async () => {
    const formBaseSchema = httpsRequestSchema("form");

    const httpsPattern = merge(
      formBaseSchema,
      mixContext(formBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: "x=y&c=d",
      }),
    )!;

    const extended = merge(
      httpsPattern,
      mixContext(httpsPattern, {
        origin: "https://www.example.com",
        pathname: "/test",
        searchParams: intoSearchParams("?hello=world"),
        headers: new Headers({ hello: "world" }),
      }),
    )!;

    const base = await executeOp(httpsPattern, "render", renderCtx(extended));
    console.log("base", base);

    const rendered = await executeOp(extended, "render", renderCtx(extended));
    console.log("extended", rendered);
  });

  it("should match unwrapped single elements", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const hctx = mixContext(jsonBaseSchema, {
      origin: "https://www.example.com",
      pathname: "/test",
      body: `{
        "x": unwrapSingle("{{hello}}")
      }`,
    });

    const httpsPattern = merge(jsonBaseSchema, hctx)!;

    const { schema, context } = mergeSchema(
      {
        mode: "match",
        phase: "validate",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": "world" }`,
      },
      new ScriptEnvironment(),
    )!;

    const rendered = await renderSchema(schema!);
    console.log(rendered);

    assert.equal(
      context.evaluationScope.subscopes["body.x.0"].values["hello"].value,
      "world",
    );
  });

  it("should match render missing single elements", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{
          "x": unwrapSingle("{{hello}}")
        }`,
      }),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "match",
        phase: "validate",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{}`,
      },
      new ScriptEnvironment(),
    )!;

    const { output } = await renderSchema(schema!, new ScriptEnvironment())!;
    assert.equal(output.body, "{}");
  });

  it("should match and render nulls", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{
          "x": "{{hello}}"
        }`,
      }),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "match",
        phase: "validate",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": null }`,
      },
      new ScriptEnvironment(),
    )!;

    const { output } = await renderSchema(schema!, new ScriptEnvironment())!;
    assert.equal(output.body, `{"x":null}`);
  });

  it("should match and render nulls in lenient arrays", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{
          "x": unwrapSingle("{{hello}}")
        }`,
      }),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "mux",
        phase: "build",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": null }`,
      },
      new ScriptEnvironment(),
    )!;

    const { output } = await renderSchema(schema!, new ScriptEnvironment())!;
    assert.equal(output.body, `{"x":null}`);
  });

  it("should match defaulted numbers", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `[{ "x": number("{{x = 5}}") }]`,
      }),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "mux",
        phase: "build",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `[{}]`,
      },
      new ScriptEnvironment(),
    );

    const { output } = await renderSchema(schema!, new ScriptEnvironment())!;
    assert.equal(output.body, `[{"x":5}]`);
  });

  it("should match on identical values", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      matchContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": 10, "abc": "y" }`,
      }),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "match",
        phase: "validate",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": 10, "abc": "y" }`,
      },
      new ScriptEnvironment(),
    )!;

    const { output } = await renderSchema(schema!, new ScriptEnvironment())!;
    assert.equal(output.body, `{"x":10,"abc":"y"}`);
  });

  it("should fail on missing values", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": 10, "abc": "y" }`,
      }),
    )!;

    assert.equal(
      null,
      mergeSchema(
        {
          mode: "match",
          phase: "validate",
        },
        httpsPattern,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{ }`,
        },
        new ScriptEnvironment(),
      ).schema,
    );
  });

  it("should fail on missing template values", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": "{{!x}}", "abc": "{{!y}}" }`,
      }),
    )!;

    assert.equal(
      null,
      mergeSchema(
        {
          mode: "match",
          phase: "validate",
        },
        httpsPattern,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{ }`,
        },
        new ScriptEnvironment(),
      ).schema,
    );
  });

  it("should allow missing optional template values", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ "x": "{{?x}}", "abc": "{{?y}}" }`,
      }),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "match",
        phase: "validate",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{ }`,
      },
      new ScriptEnvironment(),
    )!;

    const { output } = await renderSchema(schema!, new ScriptEnvironment())!;

    assert.equal(output.body, `{}`);
  });

  const builtins = {
    Number,
    String,
    Object,
    Math,
  };

  function mixContext<T>(
    s: Schema<T>,
    template: Parameters<typeof createMergingContext<T>>[2],
  ) {
    return createMergingContext(
      { mode: "mix", phase: "build" },
      s,
      template,
      new ScriptEnvironment({
        runtime: builtins,
      }),
    );
  }

  function matchContext<T>(
    s: Schema<T>,
    primer: Parameters<typeof createMergingContext<T>>[2],
  ) {
    return createMergingContext(
      { mode: "match", phase: "validate" },
      s,
      primer,
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

  // operator overloading - JSON edition.
  //   - (...) -> don't transform the contents, this expression is to be evaluated by the pardon render engine
  //   - /.../ -> anonymous regex match /.../ :: "{{ % /.../ }}"
  //   - $x = (...) -> bind $x to the variable :: $x.of("{{ = (...) }}")
  //   - $x % /.../ -> bind $x to the variable with regex /.../ :: $x.of("{{ % /.../ }}")
  //   - $x = (...) % /.../ -> bind $x to the variable with regex /.../ :: $x.of("{{ = (...) % /.../ }}")
  //   - $x = ... -> bind $x to the structure :: $x.of(...)
  //   - $x! -> mark $x required for match :: $x.required
  //   - void $x -> mark $x optional for match :: $x.optional
  //   - $x?.$y -> mark $y optional for match :: $x.$y.optional

  const transforms = (testname: string) => ({
    from: (source: string) => ({
      to: (expected: string) => {
        it(testname, () => {
          const transformed = applyTsMorph(source.trim(), jsonSchemaTransform);
          assert.equal(transformed, expected.trim());
        });
      },
    }),
  });

  transforms("parens-to-expressions").from("(a)").to(`
      "{{ = $$expr(\\"a\\") }}"
  `);

  transforms("parens-as-assignments")
    .from("$b = ('hello')")
    .to(`"{{ b = $$expr(\\"'hello'\\") }}"`);

  transforms("parens-with-noexport-modifier")
    .from("$b.noexport = ('hello')")
    .to(`"{{ :b = $$expr(\\"'hello'\\") }}"`);

  transforms("parens-with-redact-modifier")
    .from("$b.redact = ('hello')")
    .to(`"{{ @b = $$expr(\\"'hello'\\") }}"`);

  transforms("plus-as-mux").from("+['hello']").to(`mux(['hello'])`);
  transforms("minus-as-mix").from("-{ d: 'world' }").to(`mix({ d: 'world' })`);

  // todo: create a template that can merge two templates,
  // maybe
  //        and("{{ a }}", "{{ b = c }}")
  transforms("reference-reference")
    .from("$a = $b = (c)")
    .to(`$a.of("{{ b = $$expr(\\"c\\") }}")`);

  transforms("regexp").from("/abc/").to(`"{{ % /abc/ }}"`);

  transforms("regexp-binding").from("$a = /abc/").to(`"{{ a % /abc/ }}"`);

  transforms("regexp-binding-and-value")
    .from("$a = (x) % /abc/")
    .to(`"{{ a = $$expr(\\"x\\") % /abc/ }}"`);

  transforms("template-binding")
    .from("`<<${ $abc }::${ $xyz.$pqr = 100+5 }>>`")
    .to(`"<<{{ abc }}::{{ xyz.pqr = $$expr(\\"100+5\\") }}>>"`);

  transforms("kv-expression")
    .from(`[$key, undefined] * [ [$headers.key, $headers.value] ]`)
    .to("keyed([$key, undefined], [[$headers.key, $headers.value]])");

  transforms("kv-expression")
    .from(`{ id: $key } ** { id: $map.key, value: $map.value }`)
    .to("keyed.mv({ id: $key }, { id: $map.key, value: $map.value })");

  transforms("array-with-value")
    .from(`{ x: [$a.value] }`)
    .to(`{ x: [$a.value] }`);

  transforms("kv-with-computed-properties").from(
    `
{ id: $key } * [{
  id: $map.key,
  a: "{{map.value}}",
  a1: ( value + 1 )
}]`,
  ).to(`
keyed({ id: $key }, [{
        id: $map.key,
        a: "{{map.value}}",
        a1: "{{ = $$expr(\\"value + 1\\") }}"
    }])
`);

  transforms("function-calls")
    .from("form({ x: $a = 10 })")
    .to('form({ x: $a.of($$number("10")) })');
});
