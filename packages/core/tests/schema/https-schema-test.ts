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
import { httpsRequestSchema } from "../../src/core/request/https-schema.js";
import { Schema, executeOp } from "../../src/core/schema/core/schema.js";
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

describe("https-schema-tests", () => {
  it("should abc", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

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

    const httpsPattern = executeOp(jsonBaseSchema, "merge", matchingContext)!;

    const extended = executeOp(
      httpsPattern,
      "merge",
      mixContext(httpsPattern, {
        origin: "https://www.example.com",
        pathname: "/test",
        searchParams: intoSearchParams("?hello=world"),
        headers: new Headers({ hello: "world" }),
        body: "{}",
      }),
    )!;

    const rendered = await executeOp(
      httpsPattern,
      "render",
      renderCtx(httpsPattern),
    );

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

    const httpsPattern = executeOp(
      formBaseSchema,
      "merge",
      mixContext(formBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: "x=y&c=d",
      }),
    )!;

    const extended = executeOp(
      httpsPattern,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
      mixContext(jsonBaseSchema, {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{
          "x": unwrapSingle("{{hello}}")
        }`,
      }),
    )!;

    const {
      context: { scope },
    } = mergeSchema(
      {
        mode: "match",
        phase: "validate",
      },
      httpsPattern,
      {
        origin: "https://www.example.com",
        pathname: "/test",
        body: `{
        "x": "world"
      }`,
      },
      new ScriptEnvironment(),
    )!;

    assert.equal(scope.subscopes["body.x.0"].values["hello"].value, "world");
  });

  it("should match render missing single elements", async () => {
    const jsonBaseSchema = httpsRequestSchema("json");

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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

    const httpsPattern = executeOp(
      jsonBaseSchema,
      "merge",
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
    stub: Parameters<typeof createMergingContext<T>>[2],
  ) {
    return createMergingContext(
      { mode: "mix", phase: "build" },
      s,
      stub,
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
});
