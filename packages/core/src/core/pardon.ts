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
import { pardonExecution } from "./execution/pardon-execution.js";
import {
  FetchObject,
  ResponseObject,
  SimpleRequestInit,
  fetchIntoObject,
  intoFetchParams,
  intoResponseObject,
} from "./request/fetch-pattern.js";
import { AppContext } from "./app-context.js";
import { PardonOptions } from "../api/pardon-wrapper.js";
import { matchRequest } from "./match.js";
import { ProgressiveMatch } from "./progress.js";
import { createEndpointEnvironment } from "./endpoint-environment.js";
import {
  previewSchema,
  renderSchema,
  postrenderSchema,
  mergeSchema,
} from "./schema/core/schema-utils.js";
import {
  guessContentType,
  httpsRequestSchema,
  httpsResponseSchema,
} from "./request/https-template.js";
import { ScriptEnvironment } from "./schema/core/script-environment.js";
import {
  EndpointConfiguration,
  EndpointStepsLayer,
  LayeredEndpoint,
} from "../config/collection-types.js";
import { HttpsResponseStep } from "../core/formats/https-fmt.js";
import { PardonError } from "./error.js";
import { intoURL, parseURL } from "./request/url-pattern.js";
import { HTTP, RequestObject } from "./formats/http-fmt.js";
import { Schema, SchemaMergingContext } from "./schema/core/types.js";
import { getContextualValues } from "../core/schema/core/context.js";

export type PardonAppContext = Pick<
  AppContext,
  "collection" | "compiler" | "database"
>;

export type PardonMatch = {
  schema: Schema<FetchObject>;
  context: SchemaMergingContext<FetchObject>;
  endpoint: LayeredEndpoint;
  layers: (EndpointStepsLayer & {
    configuration: Partial<EndpointConfiguration>;
  })[];
  values: Record<string, unknown>;
};

export type PardonExecutionInit = {
  ask?: string;
  url?: URL | string;
  init?: SimpleRequestInit;
  options?: PardonOptions;
  values: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  select?: PardonSelectOne;
  app(): PardonAppContext;
};

type PardonSelectOne = (
  matches: PardonMatch[],
  info: { context: PardonExecutionContext; fetchObject: FetchObject },
) => PardonMatch;

const selectOne: PardonExecutionInit["select"] = (
  matches,
  { context, fetchObject },
) => {
  if (matches.length !== 1) {
    const endpoints = matches.map(
      ({
        endpoint: {
          configuration: { name: endpoint },
        },
      }) => endpoint,
    );

    throw new PardonError(
      `${
        matches.length
          ? `ambiguous ask:${endpoints
              .map((endpoint) => `\n - ${endpoint}`)
              .join("")}\n`
          : "no matches for\n"
      }${fetchObject.method ?? "GET"} ${intoURL(fetchObject)} (${JSON.stringify(context.values)})`,
    );
  }

  return matches[0];
};

export type PardonExecutionContext = PardonExecutionInit & {
  timestamps: {
    intent?: number;
    request?: number;
    response?: number;
  };
  durations: {
    match?: number;
    render?: number;
    request?: number;
  };
};

export const PardonFetchExecution = pardonExecution({
  init({
    url,
    init,
    values,
    options,
    app,
    ask,
    ...otherContextData
  }: PardonExecutionInit): PardonExecutionContext {
    const {
      method = (values.method as string) ?? "GET",
      headers = [],
      body = undefined,
    } = init ?? {};

    return {
      url,
      init,
      values: values ?? {},
      options,
      timestamps: {
        intent: Date.now(),
      },
      durations: {},
      app,
      ask:
        ask ??
        HTTP.stringify({
          ...(url && parseURL(url)),
          method,
          headers: new Headers(headers),
          body,
          values,
        }),
      ...otherContextData,
    };
  },
  async match({ context: { url, init, ...context } }) {
    const fetchObject = fetchIntoObject(url, init);

    if (typeof context.values?.method === "string") {
      fetchObject.method ??= context.values?.method;

      if (context.values?.method !== fetchObject.method) {
        throw new Error(
          "specified values method does not match reqeust method",
        );
      }
    }

    // pathname undefined in some places is allowed (matches any template),
    // but we want to ensure it's set when matching requests.
    // but allow undefined origin and pathname for undefined URLs matched/rendered only by values.
    if (fetchObject.origin) {
      fetchObject.pathname ||= "/";
    }

    if (context.options?.unmatched) {
      const { app, values } = context;
      const { compiler } = app();
      const endpoint: LayeredEndpoint = {
        service: "-",
        action: "-",
        layers: [],
        configuration: {
          path: "-",
          name: "-",
          config: {},
          mixin: [],
          defaults: {},
        },
      };

      const archetype = httpsRequestSchema(
        endpoint.configuration.encoding ?? fetchObject.encoding,
        {
          search: { multivalue: endpoint.configuration.search === "multi" },
        },
      );

      const muxed = mergeSchema(
        { mode: "mux", phase: "build" },
        archetype,
        fetchObject,
        createEndpointEnvironment({
          compiler,
          endpoint,
          values,
        }),
      );

      if (!muxed.schema) {
        throw Error("unmatched match failure");
      }

      return {
        schema: muxed.schema,
        context: muxed.context,
        endpoint,
        values,
        layers: [],
      };
    }

    const matches = matchRequest(fetchObject, context);

    if (matches.length === 1) {
      const [result] = matches;
      if (result.status === "rejected") {
        let reason = [result.reason].flat()[0];
        if (reason?.err) {
          reason = reason.err;
        }
        throw new PardonError(
          `error matching ask to endpoint(s): ${reason?.stack ?? reason}`,
        );
      } else if (result.value?.schema === undefined) {
        throw new PardonError(
          `error(s) matching ask to ${result.value?.endpoint.configuration.name}:${result.value?.diagnostics
            ?.map(({ loc, err }) =>
              typeof err === "string"
                ? err
                : (err?.stack?.split("\n").slice(0, 2).join("\n  ") ?? loc),
            )
            .join("\n")}`,
        );
      }
    }

    const goodMatches = matches
      .filter((settled) => settled.status === "fulfilled")
      .map(({ value }) => value)
      .filter(Boolean) as PardonMatch[];

    return (
      context.select?.(goodMatches, { context, fetchObject }) ??
      selectOne(goodMatches, { context, fetchObject })
    );
  },
  async preview({ context: { app }, match: { schema, values, endpoint } }) {
    const { compiler } = app();
    const previewingEnv = createEndpointEnvironment({
      endpoint,
      values,
      compiler,
      secrets: true,
      options: { "pretty-print": true },
    });

    const redactingEnv = createEndpointEnvironment({
      endpoint,
      values,
      compiler,
      secrets: false,
      options: { "pretty-print": true },
    });

    const rendered = await previewSchema(schema, previewingEnv);
    const redacted = await previewSchema(schema, redactingEnv);

    return {
      request: {
        ...rendered.output,
        values: getContextualValues(redacted.context, {
          secrets: true,
        }),
      },
      redacted: {
        ...redacted.output,
        values: getContextualValues(rendered.context),
      },
      scope: rendered.context.scope,
    };
  },
  async render({
    context: { durations, app, runtime, options },
    match: { schema, values, endpoint },
  }) {
    const { compiler } = app();

    const renderStart = Date.now();

    const renderingEnv = createEndpointEnvironment({
      endpoint,
      values,
      compiler,
      runtime,
      secrets: true,
      options: { "pretty-print": options?.pretty ?? false },
    });

    const redactingEnv = createEndpointEnvironment({
      endpoint,
      values,
      compiler,
      runtime,
      secrets: false,
      options: { "pretty-print": options?.pretty ?? true },
    });

    const rendered = await renderSchema(schema, renderingEnv);

    const redacting = mergeSchema(
      // build is a little more lenient than validate
      { mode: "match", phase: "build" },
      schema,
      rendered.output,
      redactingEnv,
    )!;

    if (!redacting.schema) {
      console.error("failed to redact output: ", redacting.context.diagnostics);
    }

    const redacted = await renderSchema(redacting.schema!, redactingEnv);

    durations.render = Date.now() - renderStart;

    return {
      request: {
        ...rendered.output,
        values: getContextualValues(rendered.context, {
          secrets: true,
        }),
      } satisfies RequestObject,
      redacted: {
        ...redacted.output,
        values: getContextualValues(rendered.context),
      } satisfies RequestObject,
      scope: rendered.context.scope,
    };
  },
  async fetch({ context: { timestamps }, outbound: { request, redacted } }) {
    timestamps.request = Date.now();

    const [url, init] = intoFetchParams(request);

    init.headers ??= new Headers();
    (init.headers as Headers).append("Connection", "close");

    try {
      return await intoResponseObject(await fetch(url, init));
    } catch (error) {
      console.error("fetch failure", error);
      const [url, init] = intoFetchParams(redacted);
      throw new PardonError(
        `failed to fetch: ${init.method ?? "GET"} ${url}`,
        error as Error,
      );
    }
  },
  async process({ context, outbound, inbound, match }) {
    const { compiler } = context.app();
    const { layers, endpoint } = match;
    const now = Date.now();
    const encoding =
      guessContentType(inbound.headers, inbound.body ?? "") ?? "raw";

    let matchedSchema: Schema<ResponseObject> | undefined;
    let matchedOutcome: string | undefined;

    let matcher = new ProgressiveMatch({
      schema: httpsResponseSchema(encoding),
      match: true,
      object: {
        ...inbound,
        statusText: inbound.statusText?.trim() || undefined,
      },
      values: {},
    });

    for (const { steps, configuration } of layers) {
      for (const responseTemplate of steps) {
        const { status, headers, body, outcome } =
          responseTemplate as HttpsResponseStep;

        const result = matcher.extend(
          {
            status,
            headers,
            ...(body && { body }),
          },
          { mode: configuration.mode, environment: new ScriptEnvironment() },
        );

        if (result?.progress) {
          matcher = result.progress;
          if (outcome) {
            matchedOutcome ??= outcome;
          }

          matchedSchema = result.matching.schema;
          break;
        }
      }
    }

    const responseSchema = httpsResponseSchema(encoding);

    // no response templates, we just try to match the basic response
    // so we can maybe reformat the json.
    if (!matchedSchema) {
      const merged = mergeSchema(
        { mode: "match", phase: "build" },
        responseSchema,
        inbound,
        new ScriptEnvironment(),
      );

      if (merged.schema) {
        matchedSchema = merged.schema;
      }
    }

    context.timestamps.response = now;
    context.durations.request = now - context.timestamps.request!;

    const [uncensored, redacted] = await Promise.all(
      [{ secrets: true }, { secrets: false }].map(async ({ secrets }) => {
        const { output, context } = await postrenderSchema(
          matchedSchema ?? responseSchema,
          createEndpointEnvironment({
            endpoint: {
              // we probably don't want to have the config/defaults applied for response
              // matching? really we're using the EndpointEnvironment here for the
              // secrets redact and pretty-print features only.
              ...endpoint,
              configuration: {
                name: endpoint.configuration.name,
                path: endpoint.configuration.path,
              },
            },
            compiler,
            secrets,
            options: {
              "pretty-print": true,
            },
          }),
        );

        return {
          output,
          scope: context.scope,
          values: getContextualValues(context, { secrets }),
        };
      }),
    );

    return {
      endpoint: endpoint.configuration.path,
      outbound,
      inbound: {
        object: inbound,
        outcome: matchedOutcome,
        scope: uncensored.scope,
        response: uncensored.output,
        secrets: uncensored.values,
        redacted: redacted.output,
        values: redacted.values,
      },
    };
  },
  onerror(error, stage, { match }) {
    if (match) {
      return new PardonError(
        `${match.endpoint.configuration.path} (${stage}): ${why(error)}`,
      );
    }
  },
});

function why(error: unknown) {
  const reasons: string[] = [];

  while (typeof error?.["cause"] === "object") {
    reasons.unshift(String(error?.["message"] ?? error));
    error = error["cause"];
  }

  if (reasons.length) {
    reasons.unshift(String(error?.["message"] ?? error));

    return reasons.join("\n - ");
  }

  return error;
}
