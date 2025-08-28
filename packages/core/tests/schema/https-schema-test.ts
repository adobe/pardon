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
import { httpsRequestSchema } from "../../src/core/request/https-template.js";

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
});
