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
import {
  LayeredEndpoint,
  EndpointConfiguration,
  EndpointStepsLayer,
} from "../../config/collection-types.js";
import { PardonExecutionContext } from "./pardon.js";
import { mapObject } from "../../util/mapping.js";
import { HttpsResponseStep } from "../formats/https-fmt.js";
import {
  HttpsRequestObject,
  httpsRequestSchema,
} from "../request/https-template.js";
import { mergeConfigurations } from "../../config/collection.js";
import { ScriptEnvironment } from "../schema/core/script-environment.js";
import { ProgressiveMatch } from "../schema/progress.js";
import { Schema, SchemaMergingContext } from "../schema/core/types.js";
import { createEndpointEnvironment } from "../endpoint-environment.js";
import { isScalar } from "../schema/definition/scalar.js";
import { InternalEncodingTypes } from "../request/body-template.js";

function selectEndpoints(
  endpoints: Record<string, LayeredEndpoint>,
  values: Record<string, unknown>,
) {
  return Object.values(endpoints)
    .filter(({ configuration: { name: endpoint }, service }) =>
      values.endpoint
        ? values.endpoint === endpoint
        : `${service}/default` !== endpoint,
    )
    .filter(({ service }) =>
      values.service
        ? values.service === service
        : values.endpoint || "default" !== service,
    )
    .filter(({ action }) => !values.action || values.action === action);
}

function selectDefaultEndpoints(
  endpoints: Record<string, LayeredEndpoint>,
  values: Record<string, unknown>,
) {
  return Object.values(endpoints)
    .filter(({ service }) =>
      values.service ? values.service === service : "default" !== service,
    )
    .filter(
      ({ configuration: { name: endpoint }, service }) =>
        `${service}/default` === endpoint,
    )
    .filter(({ action }) => !values.action || values.action === action);
}

type MixinMatch = {
  configuration: Partial<EndpointConfiguration>;
  layers: LayeredEndpoint["layers"];
  specifier: string;
};

class PardonEndpointMatcher {
  readonly context: PardonExecutionContext;
  readonly request: HttpsRequestObject;
  endpoint: LayeredEndpoint;

  readonly responseLayers: (EndpointStepsLayer & {
    configuration: Partial<EndpointConfiguration>;
  })[] = [];

  readonly acceptedMixins: string[] = [];

  readonly todoMixins: MixinMatch[] = [];
  readonly implied: Record<string, string>;
  archetypeSchema: Schema<HttpsRequestObject>;
  requestSchema?: Schema<HttpsRequestObject>;
  requestContext?: SchemaMergingContext<HttpsRequestObject>;

  constructor(
    context: PardonExecutionContext,
    request: HttpsRequestObject,
    endpoint: LayeredEndpoint,
  ) {
    this.context = context;
    this.request = request;
    this.endpoint = endpoint;

    this.implied = scalars(context.values);

    const encoding: InternalEncodingTypes | undefined = endpoint.configuration
      .encoding
      ? `$$${endpoint.configuration.encoding}`
      : undefined;

    this.archetypeSchema = httpsRequestSchema(encoding, {
      search: { multivalue: endpoint.configuration.search === "multi" },
    }) as Schema<HttpsRequestObject>;
  }

  match() {
    const {
      endpoint: {
        configuration: { name, ...configuration },
        layers,
      },
    } = this;

    // apply endpoint primary, we can skip mixin processing if it doesn't match.
    const applied = this.applyLayers({
      configuration,
      layers,
      specifier: name,
    });

    if (!applied) {
      return;
    }

    if (applied.match.requestSchema) {
      this.acceptSlice(applied);
    }

    // apply all mixins.
    while (this.todoMixins.length) {
      const mixin = this.todoMixins.shift()!;
      const applied = this.applyLayers(mixin);

      if (applied && applied.match.matcher) {
        this.acceptedMixins.push(mixin.specifier);

        this.acceptSlice(applied);
      }
    }

    if (this.requestContext && this.requestSchema) {
      const {
        requestSchema,
        requestContext,
        endpoint,
        responseLayers: layers,
        acceptedMixins,
        endpoint: { service, action },
        context: { values },
        implied,
      } = this;

      return {
        schema: requestSchema,
        context: requestContext,
        endpoint: {
          ...endpoint,
          configuration: {
            ...endpoint!.configuration,
            mixin: acceptedMixins,
            name,
          },
        },
        service,
        action,
        layers,
        values: {
          ...requestContext?.environment.implied(implied),
          ...values,
        },
      };
    }

    return {
      diagnostics: applied.match.mismatchContext?.diagnostics,
      endpoint: this.endpoint,
    };
  }

  applyLayers({ configuration, layers }: MixinMatch) {
    const {
      context: { app },
      requestContext,
      implied,
      archetypeSchema,
    } = this;

    const { compiler } = app();

    const endpoint = {
      ...this.endpoint,
      configuration: mergeConfigurations({
        name: this.endpoint.configuration.name,
        configurations: [this.endpoint.configuration, configuration],
        mixing: true,
      }),
    } as LayeredEndpoint;

    // Check if configuration is compatible with the current implied values.
    //
    // TODO (optimization): we should be able to quickly reject incompatible endpoints
    // purely on the request `origin`, and possibly, `pathname` values here.
    // TODO (optimization): we don't necessarily need to use an endpoint env for this check.

    if (
      requestContext &&
      createEndpointEnvironment({
        endpoint,
        compiler,
        values: { ...implied, ...this.context.values },
      })
        .init({ context: requestContext })
        .choose(implied)
        .exhausted()
    ) {
      return false;
    }

    const environment = createEndpointEnvironment({
      compiler,
      endpoint,
      values: { ...implied, ...this.context.values },
      context: requestContext,
    });

    const matcher = new ProgressiveMatch({
      schema: archetypeSchema,
      object: this.request,
      context: requestContext,
      values: { ...implied, ...this.context.values },
    });

    const match = this.matchLayers({
      environment,
      implied,
      layers,
      matcher,
    });

    if (match) {
      return {
        match,
        endpoint,
      };
    }
  }

  private matchLayers({
    implied: { ...implied },
    environment,
    layers,
    matcher,
  }: {
    implied: Record<string, string>;
    environment: ScriptEnvironment;
    layers: EndpointStepsLayer[];
    matcher: ProgressiveMatch<HttpsRequestObject>;
  }) {
    const { request } = this;
    let requestSchema: Schema<HttpsRequestObject> | undefined;
    let requestContext: SchemaMergingContext<HttpsRequestObject> | undefined;
    let mismatchContext: SchemaMergingContext<HttpsRequestObject> | undefined;

    layers = cloneLayers(layers);

    const matches = layers.every(({ steps, mode }) => {
      if (!steps.find(({ type }) => type === "request")) {
        return true;
      }

      while (steps.length) {
        const behavior = steps.shift()!;

        if (behavior.type === "response") {
          continue;
        }

        if (
          request.method !== undefined &&
          behavior.request.method !== undefined &&
          request.method !== behavior.request.method
        ) {
          continue;
        }

        const result = matcher.extend(
          { ...behavior.request, computations: behavior.computations },
          { mode, environment, values: behavior.values },
        );

        if (result?.matching.schema) {
          matcher = result.progress!;
          requestSchema = result.matching.schema;
          requestContext = result.matching.context;
          const { context } = result.matching;

          Object.assign(implied, context.environment.implied(implied, context));

          return true;
        }

        mismatchContext ??= result?.matching.context;
      }

      return false;
    });

    if (matches) {
      return {
        matcher,
        requestSchema,
        requestContext,
        implied,
        layers,
      };
    }

    return {
      mismatchContext,
    };
  }

  acceptSlice({
    match: { requestSchema, requestContext, layers, matcher, implied },
    endpoint,
  }: Exclude<
    ReturnType<PardonEndpointMatcher["applyLayers"]>,
    false | undefined
  >) {
    const {
      todoMixins,
      context: { app },
      endpoint: {
        configuration: { name: endpointname },
      },
    } = this;

    const { compiler, collection } = app();

    this.archetypeSchema = matcher!.schema;
    if (requestContext) {
      this.requestSchema = requestSchema;
      this.requestContext = requestContext;
    }

    this.endpoint = endpoint;
    const todo = endpoint.configuration.mixin;
    endpoint.configuration.mixin = [];

    Object.assign(this.implied, matcher!.values, implied);

    this.responseLayers.push(
      ...layers!.map(({ steps, ...info }) => ({
        steps: steps.filter(
          ({ type }) => type === "response",
        ) as HttpsResponseStep[],
        ...info,
        configuration: endpoint.configuration,
      })),
    );

    const discoveredMixins = [] as typeof todoMixins;

    for (const {
      mixin: { configuration, layers },
      specifier,
    } of [todo || []].flat(1).map((specifier) => {
      const mixinName = compiler.resolveModule(
        specifier,
        endpoint.configuration.path ?? endpointname,
      );

      if (!collection.mixins[mixinName]) {
        console.error(new Error("mixin not found: " + mixinName));
        throw new Error("mixin not found: " + mixinName);
      }

      const mixin = collection.mixins[mixinName];

      return { mixin, specifier };
    })) {
      discoveredMixins.push({
        configuration,
        layers: cloneLayers(layers),
        specifier,
      });
    }

    todoMixins.unshift(...discoveredMixins);
  }
}

function matchEndpoint(
  context: PardonExecutionContext,
  request: HttpsRequestObject,
  endpoint: LayeredEndpoint,
): PromiseSettledResult<ReturnType<PardonEndpointMatcher["match"]>> {
  try {
    const match = new PardonEndpointMatcher(context, request, endpoint).match();

    if (!match?.schema) {
      return {
        status: "rejected",
        reason: match?.diagnostics,
      };
    }

    return {
      status: "fulfilled",
      value: match,
    };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function anyGoodMatches(matches: ReturnType<typeof matchEndpoint>[]) {
  return (
    matches
      .filter((settled) => settled.status === "fulfilled")
      .map(({ value }) => value)
      .filter(Boolean).length > 0
  );
}

/**
 * This is the core of pardon, the "which template are we using to make this request"
 * magic.
 */
export function matchRequest(
  request: HttpsRequestObject,
  context: PardonExecutionContext,
) {
  const { values, app } = context;
  const { endpoints } = app().collection;

  const matches = selectEndpoints(endpoints, values).map((endpoint) =>
    matchEndpoint(context, request, endpoint),
  );

  if (anyGoodMatches(matches) || context.values.endpoint) {
    return matches;
  }

  const defaultMatches = selectDefaultEndpoints(endpoints, values).map(
    (endpoint) => matchEndpoint(context, request, endpoint),
  );

  if (
    anyGoodMatches(defaultMatches) ||
    context.values.service ||
    context.values.action
  ) {
    return defaultMatches;
  }

  return endpoints["default/default"]
    ? [matchEndpoint(context, request, endpoints["default/default"])]
    : [];
}

function scalars(mapping: Record<string, unknown>): Record<string, string> {
  return mapObject(mapping, {
    values: String,
    select: isScalar,
  });
}

function cloneLayers(steps: EndpointStepsLayer[]) {
  return steps.map(({ steps: [...steps], ...info }) => ({
    ...info,
    steps,
  }));
}
