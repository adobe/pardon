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
import { PardonFetchExecution } from "../pardon/pardon.js";
import type { PardonRuntime } from "../pardon/types.js";
import { hookExecution } from "../execution/execution-hook.js";
import { pardonExecutionHandle } from "../../api/pardon-wrapper.js";
import { pardonRuntime } from "../../runtime/runtime-deferred.js";
import persist from "../../features/persist.js";
import { createEndpointEnvironment } from "../endpoint-environment.js";
import { postrenderSchema } from "../schema/core/schema-utils.js";
import { getContextualValues } from "../schema/core/context.js";
import {
  intoFetchParams,
  type FetchObject,
  type ResponseObject,
} from "../request/fetch-object.js";
import type { RequestObject } from "../formats/http-fmt.js";
import type { CaptureHook } from "./server.js";

/**
 * A collection-schema-driven redaction of a forwarded exchange: the concrete
 * request/response run through pardon's classify + postrender pipeline with
 * `secrets: false`, so values a matching endpoint marks secret (e.g. a bearer
 * token, a password field) are replaced by their redacted schema form.
 * Uncatalogued (`default/default`) traffic passes through unaltered.
 */
export type RedactedExchange = {
  request: RequestObject;
  response: ResponseObject;
};

export type Redactor = (
  request: FetchObject,
  response: ResponseObject,
) => Promise<RedactedExchange>;

/**
 * Values carried on a stringified request also include URL parts; strip those
 * so the persisted request body carries only the meaningful KV values (matching
 * the normal egress persistence).
 */
function cleanRequestValues(values: Record<string, unknown>) {
  const { pathname, origin, search, method, ...rest } = values;
  void pathname;
  void origin;
  void search;
  void method;
  return rest;
}

/**
 * Capture a forwarded exchange by driving pardon's normal pipeline for the
 * request while *injecting* the already-obtained upstream response instead of
 * making a second network call. This reuses classification (with the
 * `default/default` fallback), schema-driven redaction, secret vaulting, and
 * trace persistence wholesale — the persisted copy is pardon's redacted,
 * schema-rendered form (not the raw wire bytes; forwarding stays faithful).
 *
 * The composition matters: the injecting hooks are applied *inside* `persist`,
 * so persist still writes the redacted request, then delegates to us for the
 * response, then writes the redacted response on `result`.
 *
 * Capture redacts by *matching* the concrete captured request, never by
 * rendering it: the `render` step is overridden to postrender the matched schema
 * with `evaluate: false`, so request-generating expressions (e.g.
 * `token = authorizeUser(...)`) are left unresolved rather than invoked. Matched
 * literal values still resolve and redact normally. This keeps capture faithful
 * to the bytes we received and robust for uncatalogued (`default/default`)
 * traffic — the firehose can't throw on an unmatched auth mixin.
 */
/**
 * Build the capture execution that drives pardon's pipeline for `request` while
 * *injecting* the already-obtained `response` (no second network call). The
 * `render` step is overridden to postrender the matched schema with
 * `evaluate: false`, so request-generating expressions are left unresolved while
 * matched literals still resolve and redact. Shared by capture (which persists
 * the result) and the redactor (which reads the redacted forms off the result).
 */
function injectingExecution(response: ResponseObject) {
  return hookExecution(PardonFetchExecution, {
    async render({ context, match: { schema, values, endpoint } }) {
      const app = context.app();

      const [rendered, redacted] = await Promise.all(
        [true, false].map((secrets) =>
          postrenderSchema(
            schema,
            createEndpointEnvironment({
              endpoint,
              values,
              app,
              options: { "pretty-print": true, secrets, evaluate: false },
            }),
          ),
        ),
      );

      return {
        request: {
          ...rendered.output,
          values: cleanRequestValues(
            getContextualValues(rendered.context, { secrets: true }),
          ),
        },
        redacted: {
          ...redacted.output,
          values: cleanRequestValues(getContextualValues(redacted.context)),
        },
        reduced: {},
        evaluationScope: rendered.context.evaluationScope,
      };
    },
    async fetch() {
      return response;
    },
  });
}

function captureContext(runtime: PardonRuntime) {
  return {
    app: () => runtime,
    durations: {},
    timestamps: {},
    values: {},
  };
}

export function createPardonCapture(runtime: PardonRuntime): CaptureHook {
  return async (request: FetchObject, response: ResponseObject) => {
    const execution = persist(injectingExecution(response));
    const [url, init] = intoFetchParams(request);

    await pardonExecutionHandle({
      context: captureContext(runtime),
      execution,
    }).fetch(url, init);
  };
}

/**
 * A redactor that returns the schema-redacted request/response for a forwarded
 * exchange (rather than persisting it). Same classify + postrender pipeline as
 * capture, but the redacted forms are read off the execution result — used to
 * redact recording logs and proxy console output.
 */
export function createRedactor(runtime: PardonRuntime): Redactor {
  return async (request, response) => {
    const [url, init] = intoFetchParams(request);

    const result = await pardonExecutionHandle({
      context: captureContext(runtime),
      execution: injectingExecution(response),
    }).fetch(url, init);

    return {
      request: result.egress.redacted,
      response: result.ingress.redacted,
    };
  };
}

/**
 * Convenience capture bound to the ambient pardon runtime (resolved lazily).
 */
export function createAmbientCapture(): CaptureHook {
  return async (request, response) => {
    const runtime = await pardonRuntime();
    return createPardonCapture(runtime)(request, response);
  };
}

/** Convenience redactor bound to the ambient pardon runtime (resolved lazily). */
export function createAmbientRedactor(): Redactor {
  return async (request, response) => {
    const runtime = await pardonRuntime();
    return createRedactor(runtime)(request, response);
  };
}
