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
import { httpsRequestSchema } from "../../src/core/request/https-template.js";
import { ScriptEnvironment } from "../../src/core/schema/core/script-environment.js";
import { intoSearchParams } from "../../src/core/request/search-pattern.js";
import { executeOp, merge } from "../../src/core/schema/core/schema-ops.js";
import {
  Schema,
  SchemaScriptEnvironment,
  Template,
} from "../../src/core/schema/core/types.js";

describe("schema configuration magic", () => {
  const config = {
    origin: {
      env: {
        prod: {
          region: {
            default: "https://example.com",
            east: "https://east.example.com",
            west: "https://west.example.com",
          },
        },
        stage: {
          region: {
            default: "https://stage.example.com",
            east: "https://stage-east.example.com",
            north: "https://stage-north.example.com",
          },
        },
      },
    },
    pathname: {
      env: {
        prod: "/v1/thing/{{thing}}",
        stage: "/thing/v1/{{thing}}",
      },
    },
  };

  it("should render via config", async () => {
    const { schema: archetype, context: archContext } = extend(
      httpsRequestSchema("json", { search: { multivalue: true } }),
      {
        origin: "https://example.com",
        pathname: "/v1/thing/{{thing}}",
        searchParams: intoSearchParams("?x={{x}}"),
        headers: [],
      },
      new ScriptEnvironment({ config }),
    )!;

    const { schema: prototype, context: protoContext } = extend(
      archetype,
      {
        origin: "https://example.com",
        pathname: "/v1/thing/abc",
        searchParams: new URLSearchParams("?x=10&x=20"),
      },
      new ScriptEnvironment({
        config,
        input: archContext.scope.resolvedValues(),
      }),
    )!;

    const naturalRenderContext = createRenderContext(
      prototype,
      new ScriptEnvironment({
        config,
        input: protoContext.scope.resolvedValues(),
      }).choose({}),
    );
    const natural = await executeOp(prototype, "render", naturalRenderContext);
    assert.equal(natural?.origin, "https://example.com");
    assert.equal(natural?.pathname, "/v1/thing/abc");

    const environment = new ScriptEnvironment({
      config,
      input: protoContext.environment.implied({ env: "stage" }, protoContext),
    });

    const result = await executeOp(
      prototype,
      "render",
      createRenderContext(prototype, environment),
    );
    assert.equal(result?.origin, "https://stage.example.com");
    assert.equal(result?.pathname, "/thing/v1/abc");
  });

  it("should override naturally", async () => {
    const { schema: archetype, context: archContext } = extend(
      httpsRequestSchema("json", { search: { multivalue: true } }),
      {
        origin: "https://example.com",
        pathname: "/v1/thing/{{thing}}",
        searchParams: intoSearchParams("?x={{x}}"),
        headers: [],
      },
      new ScriptEnvironment({ config }),
    )!;

    const protoEnvironment = new ScriptEnvironment({
      config,
      input: archContext.scope.resolvedValues(),
    });

    const { schema: prototype, context: protoContext } = extend(
      archetype,
      {
        origin: "https://east.example.com",
        pathname: "/v1/thing/abc",
        searchParams: new URLSearchParams("?x=10&x=20"),
      },
      protoEnvironment,
    )!;

    console.log(protoEnvironment.implied());

    const protoValues = {
      ...protoContext.scope.resolvedValues(),
      ...protoEnvironment.implied(),
    };

    const naturalRenderContext = createRenderContext(
      prototype,
      new ScriptEnvironment({
        config,
        input: protoValues,
      }).choose({}),
    );

    const natural = await executeOp(prototype, "render", naturalRenderContext);
    assert.equal(natural?.origin, "https://east.example.com");
    assert.equal(natural?.pathname, "/v1/thing/abc");

    protoContext.environment.implied();
    const renderEnvironment = new ScriptEnvironment({
      config,
      input: {
        env: "stage",
      },
    });

    const result = await executeOp(
      prototype,
      "render",
      createRenderContext(prototype, renderEnvironment),
    );
    assert.equal(result?.origin, "https://stage-east.example.com");
    assert.equal(result?.pathname, "/thing/v1/abc");
  });

  function extend<T>(
    s: Schema<T>,
    template: Template<T>,
    environment: SchemaScriptEnvironment,
  ) {
    const context = mixContext(s, template, environment);
    const schema = merge(s, context)!;

    return { context, schema };
  }

  function mixContext<T>(
    s: Schema<T>,
    primer: Parameters<typeof createMergingContext<T>>[2],
    environment: SchemaScriptEnvironment,
  ) {
    return createMergingContext(
      { mode: "mix", phase: "build" },
      s,
      primer,
      environment,
    );
  }
});
