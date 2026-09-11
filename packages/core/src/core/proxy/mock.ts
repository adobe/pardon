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

// ---------------------------------------------------------------------------
// Mock serving
//
// A `mode: "mock"` upstream is fulfilled from a `.mock.https` suite rather than
// forwarded. Each file is a sequence: a `>>>` request matcher (entrypoint),
// `!!!` scripts (with an ephemeral per-proxy `store`, `goto`, and — deferred —
// `replay`/`compare`), and one or more `<<<` response templates (optionally
// labeled). Matching, script execution, and response invention all reuse the
// pardon schema engine, so value-duality (`id = ...`, `token = ...`) is invented
// on the way out exactly as it is matched on the way in during capture.
//
// The reverse-proxy server links to this module for `mode: "mock"` upstreams;
// forwarding (byte-faithful passthrough) stays in `forwarder.ts`.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { PardonError } from "../error.js";
import type { FetchObject, ResponseObject } from "../request/fetch-object.js";
import {
  HTTPS,
  isHttpRequestStep,
  isHttpResponseStep,
  isHttpScriptStep,
  type HttpsRequestStep,
  type HttpsResponseStep,
  type HttpsScriptStep,
  type HttpsStep,
} from "../formats/https-fmt.js";
import {
  httpsRequestSchema,
  httpsResponseSchema,
  type HttpsRequestObject,
} from "../request/https-template.js";
import { ProgressiveMatch } from "../schema/progress.js";
import { mergeSchema, renderSchema } from "../schema/core/schema-utils.js";
import { getContextualValues } from "../schema/core/context.js";
import { createEndpointEnvironment } from "../endpoint-environment.js";
import {
  applyTsMorph,
  evaluation,
  flowScriptTransform,
} from "../evaluation/expression.js";
import { mergeConfigurations } from "../../config/collection.js";
import type { LayeredEndpoint } from "../../config/collection-types.js";
import type { PardonRuntime } from "../pardon/types.js";

/** goto() control-transfer, thrown from a mock script to select a response. */
class MockGoto extends Error {
  constructor(readonly target: string) {
    super(`goto: ${target}`);
  }
}

/** A parsed `.mock.https` file, ready to match and serve. */
export type LoadedMock = {
  name: string;
  path: string;
  endpoint: LayeredEndpoint;
  /** the first `>>>` step — the request matcher. */
  entrypoint: HttpsRequestStep;
  /** steps following the entrypoint, in file order (scripts + responses). */
  rest: HttpsStep[];
};

/** A mock-backed upstream: its parsed suite plus its live session `store`. */
export type MockUpstream = {
  mocks: LoadedMock[];
  store: Record<string, unknown>;
};

/** Globals mock scripts and response templates may reference by bare name. */
const mockGlobals: Record<string, unknown> = {
  JSON: globalThis.JSON,
  Object: globalThis.Object,
  Array: globalThis.Array,
  btoa: globalThis.btoa,
  atob: globalThis.atob,
};

function collectMockFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMockFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".mock.https")) {
      out.push(full);
    }
  }
  return out.sort();
}

function loadMockFile(path: string, base: string): LoadedMock {
  const scheme = HTTPS.parse(readFileSync(path, "utf-8"));
  const { steps } = scheme;

  const entrypointIndex = steps.findIndex(isHttpRequestStep);
  if (entrypointIndex === -1) {
    throw new PardonError(`proxy: mock ${path} has no >>> request matcher`);
  }

  const rel = relative(base, path).replace(/\.mock\.https$/, "");
  const name = rel || path;
  const segments = rel.split("/");

  const configuration = mergeConfigurations({
    name,
    configurations: [scheme.configuration].filter(Boolean),
  });

  const endpoint: LayeredEndpoint = {
    service: segments[0] ?? name,
    action: segments.slice(1).join("/") || name,
    configuration: { ...configuration, path },
    layers: [{ path, steps }],
  };

  return {
    name,
    path,
    endpoint,
    entrypoint: steps[entrypointIndex] as HttpsRequestStep,
    rest: steps.slice(entrypointIndex + 1),
  };
}

/**
 * Load a `.mock.https` suite from a directory (or `dir/**` glob), resolved
 * relative to `cwd`.
 */
export function loadMocks(pattern: string, cwd = process.cwd()): LoadedMock[] {
  const base = resolve(cwd, pattern.replace(/[/]\*\*?$/, ""));

  let stat;
  try {
    stat = statSync(base);
  } catch {
    throw new PardonError(`proxy: mocks path not found: ${base}`);
  }

  const files = stat.isDirectory() ? collectMockFiles(base) : [base];
  return files.map((path) => loadMockFile(path, base));
}

/** A fresh, empty session store for a mock-backed upstream. */
export function createMockStore(): Record<string, unknown> {
  return {};
}

function mockResponse(
  status: number,
  statusText: string,
  body: string,
): ResponseObject {
  return {
    status,
    statusText,
    headers: new Headers({ "content-type": "text/plain" }),
    body,
  };
}

/**
 * Match an inbound request against one mock's entrypoint, returning the
 * extracted values (path/header/body bindings) or `undefined` if it doesn't
 * apply. Origin is not constrained — routing already selected the upstream, so
 * method + path + headers + body discriminate within it.
 */
function matchMock(
  mock: LoadedMock,
  inbound: FetchObject,
  runtime: PardonRuntime,
): Record<string, unknown> | undefined {
  const { request } = mock.entrypoint;
  if (
    inbound.method !== undefined &&
    request.method !== undefined &&
    inbound.method !== request.method
  ) {
    return undefined;
  }

  const environment = createEndpointEnvironment({
    app: runtime,
    endpoint: mock.endpoint,
    values: {},
  });

  const matcher = new ProgressiveMatch<HttpsRequestObject>({
    schema: httpsRequestSchema(),
    object: inbound as HttpsRequestObject,
    values: {},
  });

  const result = matcher.extend(
    {
      ...request,
      computations: mock.entrypoint.computations,
    } as HttpsRequestObject,
    { environment, values: mock.entrypoint.values },
  );

  if (!result?.matching.schema || !result.matching.context) {
    return undefined;
  }

  return getContextualValues(result.matching.context, { secrets: true });
}

/**
 * Run one `!!!` block. Bare assignments persist to (and read back from) `env`
 * via `flowScriptTransform`; `store`/`goto`/`replay`/`compare` are injected and
 * any other free name falls through to a JS global. A `goto(label)` returns the
 * label so the caller can steer response selection.
 */
async function runMockScript(
  script: string,
  env: Record<string, unknown>,
  { store, replay }: { store: Record<string, unknown>; replay: () => unknown },
): Promise<{ target?: string }> {
  const wrapped = `(() => {\n${script}\n;;;\n})()`;
  const { unbound } = applyTsMorph(wrapped);

  try {
    await evaluation(
      wrapped,
      {
        binding(key) {
          const runtime = {
            environment: env,
            console,
            store,
            replay,
            compare() {},
            goto(target: string) {
              throw new MockGoto(target);
            },
          };

          return (
            runtime[key] ?? env[key] ?? mockGlobals[key] ?? globalThis[key]
          );
        },
      },
      flowScriptTransform(unbound),
    );
  } catch (error) {
    if (error instanceof MockGoto) {
      return { target: error.target };
    }
    throw error;
  }

  return {};
}

/**
 * Render a selected `<<<` template into a concrete response, inventing
 * value-duality defaults. `store`/`replay`/globals are exposed as runtime so
 * expressions like `` id = `T${store.nextTodoId = ...}` `` resolve. Returns the
 * response plus the values it produced (e.g. an invented `id`/`token`), so a
 * trailing post-response script can record them.
 */
async function renderMockResponse(
  mock: LoadedMock,
  step: HttpsResponseStep,
  env: Record<string, unknown>,
  store: Record<string, unknown>,
  replay: () => unknown,
  runtime: PardonRuntime,
): Promise<{ response: ResponseObject; values: Record<string, unknown> }> {
  const environment = createEndpointEnvironment({
    app: runtime,
    endpoint: mock.endpoint,
    values: env,
    runtime: { store, replay, ...mockGlobals },
    options: { "pretty-print": true },
  });

  const template: ResponseObject = {
    status: step.status,
    statusText: step.statusText,
    headers: step.headers,
    body: step.body,
  };

  const built = mergeSchema(
    { mode: "merge", phase: "build" },
    httpsResponseSchema(),
    template,
    environment,
  );

  if (!built.schema) {
    throw new PardonError(
      `proxy: mock ${mock.name} response template failed to build`,
    );
  }

  const { output, context } = await renderSchema(built.schema, environment);

  return {
    response: output as ResponseObject,
    values: getContextualValues(context, { secrets: true }),
  };
}

/**
 * Serve an inbound (proxy-prefix-stripped) request from a mock suite: select the
 * first matching entrypoint, run its post-request scripts, pick the response via
 * `goto`/label (or the first unlabeled one), render it, then run any
 * post-response scripts for their side effects.
 */
export async function serveMock(
  inbound: FetchObject,
  { mocks, store }: MockUpstream,
  runtime: PardonRuntime,
): Promise<ResponseObject> {
  const matches = mocks
    .map((mock) => ({ mock, values: matchMock(mock, inbound, runtime) }))
    .filter(
      (m): m is { mock: LoadedMock; values: Record<string, unknown> } =>
        m.values !== undefined,
    );

  if (matches.length === 0) {
    return mockResponse(
      404,
      "Not Found",
      `no mock matches ${inbound.method ?? "GET"} ${inbound.pathname}\n`,
    );
  }

  if (matches.length > 1) {
    console.warn(
      `proxy: ${matches.length} mocks match ${inbound.method ?? "GET"} ${
        inbound.pathname
      } (${matches.map((m) => m.mock.name).join(", ")}); using ${
        matches[0].mock.name
      }`,
    );
  }

  const { mock, values } = matches[0];
  const env: Record<string, unknown> = { ...values };
  const replay = () => undefined;

  // post-request scripts: the `!!!` steps bound to the entrypoint, run in order
  // until one selects a response via goto().
  let target: string | undefined;
  for (let cursor = 0; cursor < mock.rest.length; cursor++) {
    const step = mock.rest[cursor];
    if (!isHttpScriptStep(step)) {
      break;
    }
    ({ target } = await runMockScript(step.script, env, { store, replay }));
    if (target !== undefined) {
      break;
    }
  }

  const responses = mock.rest.filter(isHttpResponseStep);
  const selected =
    target !== undefined
      ? responses.find((step) => step.outcome === target)
      : (responses.find((step) => !step.outcome) ?? responses[0]);

  if (!selected) {
    return mockResponse(
      404,
      "Not Found",
      `mock ${mock.name} has no response${
        target ? ` labeled '${target}'` : ""
      }\n`,
    );
  }

  const { response, values: rendered } = await renderMockResponse(
    mock,
    selected,
    env,
    store,
    replay,
    runtime,
  );
  Object.assign(env, rendered);

  // post-response scripts: the `!!!` steps immediately following the selected
  // response, run for side effects (e.g. recording the invented id into store).
  const selectedIndex = mock.rest.indexOf(selected);
  for (
    let j = selectedIndex + 1;
    j < mock.rest.length && isHttpScriptStep(mock.rest[j]);
    j++
  ) {
    await runMockScript((mock.rest[j] as HttpsScriptStep).script, env, {
      store,
      replay,
    });
  }

  return response;
}
