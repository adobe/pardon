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
import { intoSearchParams } from "../../src/core/request/search-object.js";
import { executeOp, merge } from "../../src/core/schema/core/schema-ops.js";
import {
  Schema,
  SchemaScriptEnvironment,
  Template,
} from "../../src/core/schema/core/types.js";
import { expandConfigMap } from "../../src/core/schema/core/config-space.js";

describe("config map merging", () => {
  it("should expand env/origin", () => {
    const options = expandConfigMap({
      origin: {
        env: {
          stage: "https://stage.example.com",
          prod: "https://stage.example.com",
        },
      },
    });

    assert.equal(options.length, 2);
  });

  it("should expand alternations", () => {
    const options = expandConfigMap({
      origin: {
        env: {
          stage: "https://stage.example.com",
          prod: "https://stage.example.com",
        },
      },
      alternate: ["a", "b"],
    });

    assert.equal(options.length, 4);
  });

  it("should expand unmapped alternatives", () => {
    const options = expandConfigMap({
      origin: {
        env: [
          {
            stage: "https://stage.example.com",
            prod: "https://stage.example.com",
          },
          "local",
        ],
      },
    });

    assert.equal(options.length, 3);
  });

  it("should filter down", () => {
    const options = expandConfigMap(
      { env: ["stage", "prod"] },
      expandConfigMap({
        origin: {
          env: {
            stage: "https://stage.example.com",
            prod: "https://stage.example.com",
            local: "http://locahost",
          },
        },
      }),
    );

    assert.equal(options.length, 2);
  });

  it("should expand on a base", () => {
    const options = expandConfigMap(
      expandConfigMap({
        origin: {
          env: {
            stage: "...",
            prod: "...",
            local: "http://localhost",
          },
        },
      }),
      expandConfigMap({
        origin: {
          env: {
            stage: "https://stage.example.com",
            prod: "https://stage.example.com",
          },
        },
      }),
    );

    assert.equal(
      options.find(({ env }) => env == "stage")!.origin,
      "https://stage.example.com",
    );
    assert.equal(options.length, 3);
  });

  it("should expand merge alternates", () => {
    const options = expandConfigMap(
      expandConfigMap({
        origin: {
          x: ["a", "b"],
        },
      }),
      expandConfigMap({
        origin: {
          env: {
            stage: "https://stage.example.com",
            prod: "https://example.com",
          },
        },
      }),
    );

    assert.equal(
      options.find(({ env }) => env == "stage")!.origin,
      "https://stage.example.com",
    );

    assert.equal(options.length, 4);
  });

  it("should expand merge alternates", () => {
    // this example doesn't need to make any sense
    const options = expandConfigMap(
      expandConfigMap({
        x: ["a", "d"],
      }),
      expandConfigMap({
        origin: {
          env: {
            stage: {
              x: {
                a: "https://stage.example.com",
                b: "https://stage-b.example.com",
              },
            },
            prod: {
              x: {
                a: {
                  y: {
                    s: "https://example.com",
                    t: "https://t.example.com",
                  },
                },
                c: { y: { t: "https://c.example.com" } },
              },
            },
          },
        },
      }),
    );

    assert.equal(options.length, 4);
    assert.equal(options.filter(({ origin }) => origin).length, 3);
  });
});

describe("schema configuration magic", () => {
  const config = expandConfigMap({
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
  });

  it("should render via config", async () => {
    const { schema: archetype, context: archContext } = extend(
      httpsRequestSchema(),
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
        input: archContext.evaluationScope.resolvedValues(),
      }),
    )!;

    const naturalRenderContext = createRenderContext(
      prototype,
      new ScriptEnvironment({
        config,
        input: protoContext.evaluationScope.resolvedValues(),
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
      httpsRequestSchema(),
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
      input: archContext.evaluationScope.resolvedValues(),
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

    const protoValues = {
      ...protoContext.evaluationScope.resolvedValues(),
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
      { mode: "merge", phase: "build" },
      s,
      primer,
      environment,
    );
  }
});
