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
import { intoSearchParams } from "../../src/core/request/search-object.js";
import assert from "node:assert";
import { deepMatchEqual } from "../asserts.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import {
  mergeSchema,
  renderSchema,
} from "../../src/core/schema/core/schema-utils.js";
import { executeOp, merge } from "../../src/core/schema/core/schema-ops.js";
import { Schema } from "../../src/core/schema/core/types.js";
import { applyTsMorph } from "../../src/core/evaluation/expression.js";
import { httpsRequestSchema } from "../../src/core/request/https-template.js";
import { jsonSchemaTransform } from "../../src/core/request/eval-template.js";

describe("https-schema-tests", () => {
  it("should abc", async () => {
    const jsonBaseSchema = httpsRequestSchema();

    const matchingContext = mixContext(
      jsonBaseSchema,
      {
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
      },
      "json",
    );

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
    const formBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      formBaseSchema,
      mixContext(
        formBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: "x=y&c=d",
        },
        "form",
      ),
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

  it("should match single elements", async () => {
    const jsonBaseSchema = httpsRequestSchema();

    const hctx = mixContext(
      jsonBaseSchema,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{
        "x": ![ ..."{{hello}}" ]
      }`,
      },
      "json",
    );

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
      context!.evaluationScope.subscopes["body.x.0"].values["hello"].value,
      "world",
    );
  });

  it("should match render missing single elements", async () => {
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{
          "x": ![ ..."{{hello}}" ]
        }`,
        },
        "json",
      ),
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
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{
          "x": "{{hello}}"
        }`,
        },
        "json",
      ),
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
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{
          "x": ![ ..."{{hello}}" ]
        }`,
        },
        "json",
      ),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "merge",
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
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `[{ "x": $$number("{{x = 5}}") }]`,
        },
        "json",
      ),
    )!;

    const { schema } = mergeSchema(
      {
        mode: "merge",
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
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      matchContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{ "x": 10, "abc": "y" }`,
        },
        "json",
      ),
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
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{ "x": 10, "abc": "y" }`,
        },
        "json",
      ),
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
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{ "x": "{{!x}}", "abc": "{{!y}}" }`,
        },
        "json",
      ),
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
    const jsonBaseSchema = httpsRequestSchema();

    const httpsPattern = merge(
      jsonBaseSchema,
      mixContext(
        jsonBaseSchema,
        {
          origin: "https://www.example.com",
          pathname: "/test",
          body: `{ "x": "{{?x}}", "abc": "{{?y}}" }`,
        },
        "json",
      ),
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
    encoding?: string,
  ) {
    return createMergingContext(
      { mode: "merge", phase: "build", encoding: encoding! },
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
    encoding?: string,
  ) {
    return createMergingContext(
      { mode: "match", phase: "validate", encoding: encoding! },
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

  const transforms = Object.assign(
    (testname: string, mode?: "only" | "skip" | "fails" | "todo") => ({
      from: (source: string) => ({
        to: (expected: string) => {
          let expectedSymbols: Set<string>;
          let expectedLiterals: Set<string>;

          function execute() {
            const { morphed, unbound } = applyTsMorph(
              source.trim(),
              jsonSchemaTransform,
            );

            assert.equal(morphed, expected.trim());
            if (expectedSymbols) {
              assert.deepEqual(expectedSymbols, unbound.symbols);
            }
            if (expectedLiterals) {
              assert.deepEqual(expectedLiterals, unbound.literals);
            }
          }

          (mode == "only" || mode === "skip" ? it[mode] : it)(testname, () => {
            try {
              execute();
            } catch (ex) {
              if (mode === "fails" || mode === "todo") {
                return;
              }

              throw ex;
            }
          });

          return {
            symbols(...symbols: string[]) {
              expectedSymbols = new Set(symbols);
              return {
                literals(...literals: string[]) {
                  expectedLiterals = new Set(literals);
                },
              };
            },
            literals(...literals: string[]) {
              expectedLiterals = new Set(literals);
            },
          };
        },
      }),
    }),
    {
      skip: (name: string) => transforms(name, "skip"),
      only: (name: string) => transforms(name, "only"),
      todo: (name: string) => transforms(name, "todo"),
      fails: (name: string) => transforms(name, "fails"),
    },
  );

  transforms("parens-to-expressions").from("(a)").to(`$.$expr("a")`).symbols();

  transforms("optional-chain").from("a?.b").to(`a?.b`).symbols("a");

  transforms("parens-as-assignments")
    .from("b = ('hello')")
    .to(`b.$expr("'hello'")`);

  transforms("parens-with-noexport-modifier")
    .from("b = ('hello') as internal")
    .to(`b.$noexport.$expr("('hello')")`);

  transforms("no-parens") //
    .from("b = 'hello'")
    .to(`$merged(b, 'hello')`)
    .symbols("$merged", "b");

  transforms("as-secret") //
    .from("{ data: data as secret }")
    .to(`{ data: data.$secret }`)
    .symbols("data");

  transforms("no-parens-with-modifier")
    .from("b = 'hello' as secret")
    .to(`$merged('hello', b.$secret)`)
    .symbols("$merged", "b");

  transforms("parens-with-redact-modifier")
    .from("b.$secret = ('hello')")
    .to(`b.$secret.$expr("'hello'")`);

  transforms("plus-as-flow").from("+x").to(`$flow(x)`).symbols("x", "$flow");

  // todo: create a template that can merge two templates,
  // maybe
  //        and("{{ a }}", "{{ b = c }}")
  transforms("reference-reference")
    .from("a = b = (c)")
    .to(`$merged(a, b.$expr("c"))`)
    .symbols("a", "b", "$merged");

  transforms("regexp").from("/abc/").to(`"{{ % /abc/ }}"`).symbols();

  transforms("regexp-binding")
    .from("a = /abc/")
    .to(`"{{ a % /abc/ }}"`)
    .symbols();

  transforms("regexp-binding-with-hyphenated-variable")
    .from("$`a-b` = /abc/")
    .to(`"{{ a-b % /abc/ }}"`)
    .symbols();

  transforms("regexp-binding-with-hyphenated-variable-and-path")
    .from("$`a-b`.c = /abc/")
    .to(`"{{ a-b.c % /abc/ }}"`)
    .symbols();

  transforms("regexp-binding-and-value")
    .from("a = (x) % /abc/")
    .to(`"{{ a = $$expr(\\"x\\") % /abc/ }}"`);

  transforms("regexp-binding-and-value-hyphenated")
    .from("$`a-b` = (x) % /abc/")
    .to(`"{{ a-b = $$expr(\\"x\\") % /abc/ }}"`);

  transforms("template-binding")
    .from("`<<${ abc }::${ xyz.pqr = 100+5 }>>`")
    .to(`"<<{{ abc }}::{{ xyz.pqr = $$expr(\\"100+5\\") }}>>"`);

  transforms("kv-expression")
    .from(`[key, undefined] * [ ...[headers.$key, headers.$value] ]`)
    .to("$keyed([key, undefined], $elements([headers.$key, headers.$value]))")
    .symbols("$keyed", "$elements", "key", "undefined", "headers");

  transforms("required-regex").from(`x! % /abc/`).to(`"{{ !x % /abc/ }}"`);
  transforms("required-regex")
    .from(`x.y.z! % /abc/`)
    .to(`"{{ !x.y.z % /abc/ }}"`);

  transforms("multi-kv-expression")
    .from(`{ id: key } ** { id: map.$key, value: map.each.$value }`)
    .to("$keyed$mv({ id: key }, { id: map.$key, value: map.each.$value })")
    .symbols("$keyed$mv", "key", "map");

  transforms("array-with-value")
    .from(`{ x: [a.$value] }`)
    .to(`{ x: [a.$value] }`)
    .symbols("a");

  transforms("kv-with-computed-properties")
    .from(
      `
{ id: key } * [...{
  id: map.$key,
  a: "{{map.value}}",
  a1: ( value + 1 )
}]`,
    )
    .to(
      `
$keyed({ id: key }, $elements({
    id: map.$key,
    a: "{{map.value}}",
    a1: $.$expr("value + 1")
}))
`,
    )
    .symbols("$keyed", "$elements", "key", "map");

  transforms("function-calls")
    .from("form({ x: a = 10 })")
    .to('$form({ x: $merged(a, $$number("10")) })')
    .symbols("$form", "a", "$$number", "$merged");

  transforms("muddling-operator")
    .from("~x")
    .to("$muddle(x)")
    .symbols("$muddle", "x");

  transforms("merge-operator-array-archetype-and-array")
    .from(
      `
      {
        x: [...{ p: xs.p, q: xs.q = (1) }] = [{ p: "hello" }, { p: "world", q: 7 }] 
      }`,
    )
    .to(
      `
{
    x: $merged($elements({ p: xs.p, q: xs.q.$expr("1") }), [{ p: "hello" }, { p: "world", q: $$number("7") }])
}`,
    );

  transforms("match-mode")
    .from(`match / { x: "{{x}}" }`)
    .to(`$match({ x: "{{x}}" })`)
    .symbols("$match");

  transforms("meld-mode")
    .from(`meld / { x: "{{x}}" }`)
    .to(`$meld({ x: "{{x}}" })`)
    .symbols("$meld");

  transforms("hidden-template")
    .from(`hidden / { x: "{{x}}" }`)
    .to(`$hidden({ x: "{{x}}" })`)
    .symbols("$hidden");

  transforms("scoped-objects")
    .from(`{ ...{ x: obj.x, y: obj.y } }`)
    .to(`$scoped({ x: obj.x, y: obj.y })`)
    .symbols("$scoped", "obj");

  transforms("secret-spread-elements")
    .from(`[...x.$value as secret]`)
    .to(`$elements(x.$value.$secret)`)
    .symbols("$elements", "x");

  transforms("secret-spread-unwrapped")
    .from(`![...x.$value as secret]`)
    .to(`$itemOrArray(x.$value.$secret)`)
    .symbols("$itemOrArray", "x");
});
