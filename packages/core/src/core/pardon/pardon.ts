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
import { pardonExecution } from "../execution/pardon-execution.js";
import {
  FetchObject,
  ResponseObject,
  fetchIntoObject,
  intoFetchParams,
  intoResponseObject,
} from "../request/fetch-object.js";
import { PardonOptions } from "../../api/pardon-wrapper.js";
import { matchRequest } from "./match.js";
import { ProgressiveMatch } from "../schema/progress.js";
import { createEndpointEnvironment } from "../endpoint-environment.js";
import {
  previewSchema,
  renderSchema,
  postrenderSchema,
  mergeSchema,
} from "../schema/core/schema-utils.js";
import {
  HttpsRequestObject,
  httpsRequestSchema,
  httpsResponseSchema,
} from "../request/https-template.js";
import { ScriptEnvironment } from "../schema/core/script-environment.js";
import {
  Configuration,
  EndpointStepsLayer,
  LayeredEndpoint,
} from "../../config/collection-types.js";
import {
  HttpsResponseStep,
  HttpsScriptStep,
  guessContentType,
  isHttpRequestStep,
  isHttpResponseStep,
  isHttpScriptStep,
} from "../formats/https-fmt.js";
import { PardonError } from "../error.js";
import { intoURL, parseURL } from "../request/url-object.js";
import { HTTP, RequestObject } from "../formats/http-fmt.js";
import {
  EvaluationScope,
  Schema,
  SchemaMergingContext,
  SchemaRenderContext,
} from "../schema/core/types.js";
import { getContextualValues } from "../schema/core/context.js";
import { definedObject, mapObject } from "../../util/mapping.js";
import { JSON } from "../raw-json.js";
import { PardonRuntime } from "./types.js";
import { valueId } from "../../util/value-id.js";
import { cleanObject } from "../../util/clean-object.js";
import { parseHints, patternize } from "../schema/core/pattern.js";
import { hiddenTemplate } from "../schema/definition/structures/hidden.js";
import { evaluation } from "../evaluation/expression.js";
import { isSecret } from "../schema/definition/hinting.js";
import { makeSecretsProxy } from "../../runtime/secrets.js";

export type PardonAppContext = Pick<
  PardonRuntime,
  "collection" | "compiler" | "database"
>;

export type PardonExecutionMatch = {
  schema: Schema<HttpsRequestObject>;
  context: SchemaMergingContext<HttpsRequestObject>;
  endpoint: LayeredEndpoint;
  layers: (EndpointStepsLayer & {
    configuration: Partial<Configuration>;
  })[];
  values: Record<string, any>;
};

export type PardonExecutionInit = {
  ask?: string;
  url?: URL | string;
  init?: Partial<RequestObject>;
  options?: PardonOptions;
  values: Record<string, any>;
  runtime?: Record<string, unknown>;
  configuration?: Configuration;
  select?: PardonSelectOne;
  app(): PardonAppContext;
};

export type PardonExecutionEgress = {
  request: RequestObject;
  redacted: RequestObject;
  reduced: Record<string, any>;
  evaluationScope: EvaluationScope;
};

export type PardonExecutionIngress = ResponseObject;

export type PardonExecutionResult = {
  endpoint: string;
  output: Record<string, any>;
  egress: PardonExecutionEgress;
  ingress: {
    actual: ResponseObject;
    response: ResponseObject;
    redacted: ResponseObject;
    outcome?: string;
    values: Record<string, any>;
    secrets: Record<string, any>;
  };
};

type PardonSelectOne = (
  matches: PardonExecutionMatch[],
  info: { context: PardonExecutionContext; fetchObject: FetchObject },
) => PardonExecutionMatch;

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

    // if there are multiple requests that match,
    // filter down to only one if there's an "exact match" by patternize/template
    // for pathname or, failing that, origin.
    const disambiguators: (keyof FetchObject)[] = ["pathname", "origin"];
    for (const disambiguator of disambiguators) {
      const { template } = patternize(
        (fetchObject[disambiguator] as string) ?? "",
      );
      const exact = matches.filter(({ endpoint: { layers } }) =>
        layers
          .flatMap(({ steps }) => steps.filter(isHttpRequestStep))
          .some(
            ({ request: { [disambiguator]: value } }) =>
              value && patternize(value as string).template === template,
          ),
      );

      if (exact.length === 1) {
        matches = exact;
        break;
      }
    }

    if (matches.length === 1) {
      return matches[0];
    }

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
  values: Record<string, any>;
  secrets?: Record<string, any>;
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

function redactAsk(ask: string | undefined) {
  if (ask === undefined) return undefined;
  const { values, ...http } = HTTP.parse(ask);

  return HTTP.stringify({ ...http, values: redactValues(values ?? {}) });
}

export function parseSecretsFromValues(values?: Record<string, any>) {
  return {
    values: redactValues(values ?? {}),
    secrets: secretValues(values ?? {}),
  };
}

function redactValues(values: Record<string, any>) {
  return unredactValues(
    mapObject(values, {
      filter: (key) => !isSecret(parseHints(key)),
    }),
  );
}

function secretValues(values: Record<string, any>) {
  return unredactValues(
    mapObject(values, {
      filter: (key) => isSecret(parseHints(key)),
    }),
  );
}

function unredactValues(values: Record<string, any>) {
  return mapObject(values, { keys: (key) => parseHints(key).param });
}

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
      method = values.method as string | undefined,
      headers = [],
      body = undefined,
      meta,
    } = init ?? {};

    return {
      url,
      init,
      ...parseSecretsFromValues(values),
      options,
      timestamps: {
        intent: Date.now(),
      },
      durations: {},
      app,
      ask:
        redactAsk(ask) ??
        HTTP.stringify({
          ...(url && parseURL(url)),
          method,
          headers: new Headers(headers),
          body,
          values: redactValues(values),
          meta,
        }),

      ...otherContextData,
    };
  },
  async match({ context: { url, init, configuration, ...context } }) {
    if (configuration) {
      const request = fetchIntoObject(url, init);
      const { values } = context;
      const app = context.app();
      const endpoint: LayeredEndpoint = {
        action: "flow",
        layers: [],
        service: "flow",
        configuration,
      };
      const { schema, context: mergeContext } = mergeSchema(
        { mode: "merge", phase: "build" },
        httpsRequestSchema(),
        request as HttpsRequestObject,
        createEndpointEnvironment({
          app,
          endpoint,
          values,
        }),
      );

      return {
        endpoint,
        values,
        schema: schema!,
        layers: [],
        context: mergeContext!,
      };
    }

    const request = fetchIntoObject(url, init);

    if (typeof context.values?.method === "string") {
      request.method ??= context.values.method;

      if (context.values.method !== request.method) {
        throw new Error(
          "specified values method does not match reqeust method",
        );
      }
    }

    // pathname undefined in some places is allowed (matches any template),
    // but we want to ensure it's set when matching requests.
    // but allow undefined origin and pathname for undefined URLs matched/rendered only by values.
    if (request.origin) {
      request.pathname ||= "/";
    }

    if (context.options?.unmatched) {
      const { values } = context;
      const app = context.app();
      const endpoint: LayeredEndpoint = {
        service: "-",
        action: "-",
        layers: [],
        configuration: {
          path: "-",
          name: "-",
          config: [{}],
          mixin: [],
          defaults: {},
        },
      };

      const archetype = httpsRequestSchema();

      const muxed = mergeSchema(
        { mode: "merge", phase: "build" },
        archetype,
        request as HttpsRequestObject,
        createEndpointEnvironment({
          app,
          endpoint,
          values,
        }),
      );

      if (!muxed.schema) {
        throw Error("unmatched match failure");
      }

      return {
        schema: muxed.schema!,
        context: muxed.context!,
        endpoint,
        values,
        layers: [],
      };
    }

    const matches = matchRequest(request, context);

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
      .filter(Boolean) as PardonExecutionMatch[];

    return (
      context.select?.(goodMatches, { context, fetchObject: request }) ??
      selectOne(goodMatches, { context, fetchObject: request })
    );
  },
  async preview({ context, match: { schema, values, endpoint } }) {
    const { values: inputValues } = context;
    const app = context.app();
    const previewingEnv = createEndpointEnvironment({
      endpoint,
      values,
      app,
      options: {
        "pretty-print": true,
        // preview won't render real secrets, so we don't redact them
        secrets: true,
      },
    });

    const rendered = await previewSchema(schema, previewingEnv);

    const renderedValues = rendered.context.evaluationScope.resolvedValues({
      secrets: false,
    });

    const redactingEnv = createEndpointEnvironment({
      endpoint,
      values: {
        ...values,
        ...renderedValues,
      },
      app,
      options: { "pretty-print": true, secrets: false },
    });

    const redacted = await previewSchema(schema, redactingEnv);

    const reduced = reducedValues(
      schema,
      redacted.output,
      endpoint,
      app,
      inputValues,
    );

    return {
      request: {
        ...rendered.output,
        meta: cleanObject({ ...rendered.output.meta, body: undefined }),
        values: getContextualValues(rendered.context, {
          secrets: true,
        }),
      },
      redacted: {
        ...redacted.output,
        meta: cleanObject({ ...redacted.output.meta, body: undefined }),
        values: getContextualValues(redacted.context),
      },
      reduced,
      evaluationScope: rendered.context.evaluationScope,
    };
  },
  async render({ context, match: { schema, values, endpoint, layers } }) {
    const {
      durations,
      runtime,
      options,
      values: inputValues,
      secrets,
      init: { computations } = {},
    } = context;

    const app = context.app();

    const mergeComputations = mergeSchema(
      { mode: "merge", phase: "build" },
      schema,
      {
        computations: hiddenTemplate(computations),
      },
    );

    if (!mergeComputations.schema) {
      throw new PardonError(
        "unexpected: failed to merge computations into matched schema: " +
          (mergeComputations.error ??
            mergeComputations.context?.diagnostics[0]),
      );
    }

    schema = mergeComputations.schema;

    const renderStart = Date.now();

    const renderingEnv = createEndpointEnvironment({
      endpoint,
      values,
      secrets,
      app,
      runtime,
      options: { "pretty-print": options?.pretty ?? false, secrets: true },
    });

    const rendered = await renderSchema(schema, renderingEnv);

    // execute all pre-request steps: these follow the matched request.
    for (const { steps } of layers) {
      while (steps.length && isHttpScriptStep(steps[0])) {
        const script = steps.shift() as HttpsScriptStep;

        await executePreRequestScriptStep(context, script, {
          values: {
            ...rendered.context.environment.contextValues,
            ...rendered.context.evaluationScope.resolvedValues({
              secrets: true,
            }),
            egress: rendered.output,
          },
        });
      }
    }
    const renderedValues = rendered.context.evaluationScope.resolvedValues({
      secrets: false,
    });

    const redactingEnv = createEndpointEnvironment({
      endpoint,
      values: { ...values, ...renderedValues },
      secrets,
      app,
      runtime: {},
      options: { "pretty-print": options?.pretty ?? true, secrets: false },
    });

    const redacting = mergeSchema(
      // build used here as it is a little more lenient than validate
      { mode: "match", phase: "build" },
      schema,
      rendered.output,
      redactingEnv,
    )!;

    if (!redacting.schema) {
      console.error(
        "failed to redact output: ",
        redacting.error ?? redacting.context?.diagnostics[0],
      );
    }

    const redacted = await postrenderSchema(redacting.schema!, redactingEnv);

    const reduced = reducedValues(
      schema,
      redacted.output,
      endpoint,
      app,
      inputValues,
    );

    durations.render = Date.now() - renderStart;

    return {
      request: {
        ...rendered.output,
        values: cleanRequestValues(
          getContextualValues(rendered.context, {
            secrets: true,
          }),
        ),
      },
      redacted: {
        ...redacted.output,
        values: cleanRequestValues(getContextualValues(rendered.context)),
      },
      reduced,
      evaluationScope: rendered.context.evaluationScope,
    };
  },
  async fetch({ context: { timestamps }, egress: { request, redacted } }) {
    if (timestamps) {
      timestamps.request = Date.now();
    }

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
    } finally {
      timestamps.response = Date.now();
    }
  },
  async process({ context, egress, ingress, match }) {
    const app = context.app();
    const { layers, endpoint } = match;

    const now = Date.now();

    const encoding =
      ingress.meta?.body ??
      guessContentType(ingress.body ?? "", ingress.headers) ??
      "raw";

    let matchedSchema: Schema<ResponseObject> | undefined;
    let matchedOutcome: string | undefined;

    let matcher = new ProgressiveMatch({
      schema: httpsResponseSchema(),
      match: true,
      object: {
        ...ingress,
        statusText: ingress.statusText?.trim() || undefined,
      },
      values: {},
    });

    layers: for (const { steps } of layers) {
      while (steps.length) {
        if (!steps.some(isHttpResponseStep)) {
          continue layers;
        }

        while (!isHttpResponseStep(steps[0])) {
          steps.shift();
        }

        const responseTemplate = steps.shift() as HttpsResponseStep;

        const { status, headers, body, outcome, meta } = responseTemplate;

        const result = matcher.extend(
          {
            status,
            headers,
            meta,
            ...(body && { body }),
          },
          { environment: new ScriptEnvironment() },
        );

        if (result?.progress) {
          matcher = result.progress;
          if (outcome) {
            matchedOutcome ??= outcome;
          }

          matchedSchema = result.matching.schema;
          break;
        } else {
          // remove all post-request script steps.
          while (steps.length && isHttpScriptStep(steps[0])) {
            steps.shift();
          }
        }
      }
    }

    // no response templates, we just try to match the basic response
    // so we can maybe reformat the json.
    if (!matchedSchema) {
      const responseSchema = httpsResponseSchema();

      const merged = mergeSchema(
        { mode: "match", phase: "build", body: encoding },
        responseSchema,
        ingress,
        new ScriptEnvironment(),
      );

      matchedSchema = merged.schema ?? responseSchema;
    }

    context.timestamps.response = now;
    context.durations.request = now - context.timestamps.request!;

    const [uncensored, redacted] = await Promise.all(
      [{ secrets: true }, { secrets: false }].map(async ({ secrets }) => {
        const { output: response, context } = await postrenderSchema(
          matchedSchema,
          createEndpointEnvironment({
            endpoint: {
              // we probably don't want to have the config/defaults applied for response
              // matching? really we're using the EndpointEnvironment here for the
              // secrets redact and pretty-print features only.
              ...endpoint,
              configuration: {
                name: endpoint.configuration.name,
                path: endpoint.configuration.path,
                import: endpoint.configuration.import,
                config: [{}],
              },
            },
            app,
            options: {
              "pretty-print": true,
              secrets,
            },
          }),
        );

        return {
          response,
          evaluationScope: context.evaluationScope,
          context,
          values: cleanResponseValues(
            getContextualValues(context, { secrets }),
          ),
        };
      }),
    );

    const output = redacted.evaluationScope.resolvedValues({ flow: true });

    // execute all pre-request steps: these follow the matched request.
    for (const { steps } of layers) {
      while (steps.length && isHttpScriptStep(steps[0])) {
        const script = steps.shift() as HttpsScriptStep;

        const {
          service,
          action,
          configuration: { name },
        } = endpoint;

        await executePostRequestScriptStep(uncensored.context, script, {
          values: {
            service,
            action,
            endpoint: name,
            ...context.values,
            ...egress.request.values,
            ...uncensored.values,
            egress: egress.request,
            ingress,
          },
        });
      }
    }

    return {
      endpoint: endpoint.configuration.path,
      egress,
      ingress: {
        actual: ingress,
        outcome: matchedOutcome,
        evaluationScope: uncensored.evaluationScope,
        response: uncensored.response,
        secrets: uncensored.values,
        redacted: redacted.response,
        values: redacted.values,
      },
      output,
    };
  },
  error() {},
});

function cleanRequestValues(request: Record<string, unknown>) {
  return definedObject({
    ...request,
    pathname: undefined,
    origin: undefined,
    search: undefined,
    method: undefined,
  } as Record<string, unknown>);
}

function cleanResponseValues(response: Record<string, unknown>) {
  return definedObject({
    ...response,
    status: undefined,
    statusText: undefined,
  } as Record<string, unknown>);
}

function reducedValues(
  schema: Schema<HttpsRequestObject>,
  request: RequestObject,
  endpoint: LayeredEndpoint,
  app: PardonAppContext,
  values: Record<string, any>,
) {
  const matchingEnv = createEndpointEnvironment({
    endpoint,
    values: {},
    app,
    runtime: {},
    options: { secrets: false },
  });

  const reducedValues = { ...values };

  try {
    const matching = mergeSchema(
      { mode: "match", phase: "build" },
      schema,
      request,
      matchingEnv,
    );

    if (matching.error) {
      throw matching.error;
    }

    const resolvedValues = getContextualValues(matching.context!);

    for (const [key, value] of Object.entries(resolvedValues)) {
      try {
        if (
          reducedValues[key] == value ||
          valueId(reducedValues[key]) === valueId(value)
        ) {
          delete reducedValues[key];
        }
      } catch (error) {
        /* ignore */
        void error;
      }
    }
  } catch (error) {
    /* ignore */
    void error;
  }

  return reducedValues;
}

async function executePreRequestScriptStep(
  context: PardonExecutionContext,
  step: HttpsScriptStep,
  { values }: { values: Record<string, unknown> },
) {
  const script = `(() => { ${step.script} ;;; })()`;

  await evaluation(script, {
    binding(key) {
      return values[key] ?? globalThis[key];
    },
  });
}

async function executePostRequestScriptStep(
  context: SchemaRenderContext,
  step: HttpsScriptStep,
  { values }: { values: Record<string, unknown> },
) {
  const script = `(() => { ${step.script} ;;; })()`;

  await evaluation(script, {
    binding(key) {
      return (
        values[key] ??
        globalThis[key] ??
        {
          get secrets() {
            return makeSecretsProxy(context);
          },
        }[key]
      );
    },
  });
}
