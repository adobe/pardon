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
  HttpsFlowScheme,
  HttpsRequestStep,
  HttpsResponseStep,
  HttpsFlowConfig,
} from "../../formats/https-fmt.js";
import { ResponseObject } from "../../request/fetch-pattern.js";
import { pardon } from "../../../api/pardon-wrapper.js";
import {
  mergeSchema,
  prerenderSchema,
  renderSchema,
} from "../../schema/core/schema-utils.js";
import { httpsResponseSchema } from "../../request/https-template.js";
import { ScriptEnvironment } from "../../schema/core/script-environment.js";
import { definedObject, mapObject } from "../../../util/mapping.js";
import { createSequenceEnvironment } from "./flow-environment.js";
import { stubSchema } from "../../schema/definition/structures/stub.js";
import { HTTP } from "../../formats/http-fmt.js";
import { TracedResult } from "../../../features/trace.js";
import { Schema, EvaluationScope } from "../../schema/core/types.js";
import { JSON } from "../../json.js";
import { withoutEvaluationScope } from "../../schema/core/context-util.js";
import {
  contextAsFlowParams,
  ejectValuesDict,
  extractValuesDict,
  FlowParamsDict,
  injectValuesDict,
} from "./flow-params.js";
import { FlowContext } from "./data/flow-context.js";
import { PardonRuntime } from "../../pardon/types.js";
import { Flow, FlowResult, makeFlowIdempotent } from "./flow-core.js";
import { flow } from "./index.js";

export type SequenceReport = {
  type: "unit" | "flow";
  name: string;
  values: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
  deps: SequenceReport[];
  steps: SequenceStepReport[];
  executions: TracedResult[];
};

export type SequenceStepReport = Awaited<
  ReturnType<typeof executeHttpsSequenceStep>
>;

type HttpsSequenceInteraction = {
  request: HttpsRequestStep;
  responses: HttpsResponseStep[];
};

export function compileHttpsFlow(
  scheme: HttpsFlowScheme,
  { path, name }: { path: string; name: string },
) {
  const sequence = compileHttpsFlowSequence(scheme, { path, name });

  const flow = createHttpsFlow(sequence);

  if (sequence.configuration.idempotent) {
    return makeFlowIdempotent(flow);
  }

  return flow;
}

function createHttpsFlow(sequence: CompiledHttpsSequence): Flow {
  return {
    signature: sequence.signature ?? {
      dict: {},
      rested: "",
      required: false,
    },
    async action({ argument, context }) {
      context = context.mergeEnvironment(argument);
      return await executeHttpsSequence(
        sequence,
        context.mergeEnvironment(argument),
      );
    },
    source: sequence,
  };
}

function buildDefinitionSchema(definitions: Record<string, any>) {
  const definitionSchemaTemplate = mapObject(definitions, {
    values(value, key) {
      if (value === true) {
        return `{{?${key}}}`;
      }

      return `{{?${key} = $$expr(${JSON.stringify(value)})}}`;
    },
    filter(_key, defined) {
      return Boolean(defined);
    },
  }) as Record<string, unknown>;

  return mergeSchema(
    { mode: "mux", phase: "build" },
    stubSchema(),
    definitionSchemaTemplate,
  ).schema!;
}

function compileHttpsFlowSequence(
  scheme: HttpsFlowScheme,
  { path, name }: { path: string; name: string },
): CompiledHttpsSequence {
  const { interactionMap, interactions, tries, configuration } =
    parseHttpsSequenceScheme(scheme);
  const definitions: Record<string, true | string> = {};
  const params: FlowParamsDict | undefined =
    configuration.context === undefined
      ? undefined
      : contextAsFlowParams(configuration.context, definitions);

  const schema = buildDefinitionSchema(definitions);

  return {
    scheme,
    path,
    name,
    signature: params,
    schema,
    interactionMap,
    interactions,
    tries,
    configuration,
  };
}

export type CompiledHttpsSequence = {
  scheme: HttpsFlowScheme;
  path: string;
  name: string;
  signature?: FlowParamsDict;
  schema: Schema<Record<string, unknown>>;
  interactionMap: Record<string, number>;
  interactions: HttpsSequenceInteraction[];
  tries: Record<number, number>;
  configuration: HttpsFlowConfig;
};

export async function executeHttpsSequence(
  sequence: CompiledHttpsSequence,
  flowContext: FlowContext,
): Promise<FlowResult> {
  const { signature: params } = sequence;
  const { compiler } = flowContext.runtime;

  const definedValues = params
    ? extractValuesDict(params, flowContext.environment)
    : flowContext.environment;

  const sequenceEnvironment = createSequenceEnvironment({
    flowScheme: sequence.scheme,
    compiler,
    flowPath: sequence.path,
    values: definedValues,
  });

  const renderedTemplate = await renderSchema(
    sequence.schema,
    sequenceEnvironment,
  );

  let effectiveValues = definedObject(renderedTemplate.output) as Record<
    string,
    any
  >;

  const attemptLimit = sequence.configuration.attempts;
  const dependentFlowResult = await evaluateDependentFlows(
    sequence.configuration,
    effectiveValues,
    flowContext,
  );

  flowContext = dependentFlowResult.context;

  effectiveValues = {
    ...effectiveValues,
    ...dependentFlowResult.result,
  };

  let attempts = 0;
  const sequenceRun = async () => {
    for (;;) {
      try {
        const result = await executeHttpsFlowSequence(
          sequence,
          effectiveValues,
          flowContext,
        );
        return result;
      } catch (error) {
        if (!attemptLimit) {
          throw error;
        } else if (++attempts >= attemptLimit) {
          console.warn(`attempt limit reached: ${sequence.name}`);
          throw error;
        }

        flowContext.checkAborted();
        console.warn(`reattempting unit: ${sequence.name}`);
      }
    }
  };

  return await sequenceRun();
}

async function executeHttpsFlowSequence(
  sequence: CompiledHttpsSequence,
  effectiveValues: Record<string, unknown>,
  flowContext: FlowContext,
): Promise<FlowResult> {
  let index = 0;

  const retries = { ...sequence.tries };

  while (index < sequence.interactions.length) {
    const next = sequence.interactions[index];

    flowContext.checkAborted();

    if (retries[index] !== undefined) {
      if (--retries[index] < 0) {
        throw new Error(
          `ran out of retries for step ${index + 1} of ${sequence.name}`,
        );
      }
    }

    const { outcome, values } = await executeHttpsSequenceStep(
      {
        sequenceInteraction: next,
        sequenceScheme: sequence.scheme,
        sequencePath: sequence.path,
        values: effectiveValues,
      },
      flowContext,
    );

    flowContext = flowContext.mergeEnvironment(values);

    flowContext.checkAborted();

    effectiveValues = {
      ...effectiveValues,
      ...values,
    };

    // if the outcome is named in the flow, loop, else exit
    if (outcome) {
      index =
        sequence.interactionMap[outcome.name] ?? sequence.interactions.length;
    } else {
      index = index + 1;
    }

    if (outcome?.delay) {
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, outcome.delay)),
        flowContext.aborting(),
      ]);
    }

    flowContext.checkAborted();

    if (index == sequence.interactions.length && outcome) {
      effectiveValues = {
        outcome: outcome.name,
        ...effectiveValues,
      };
    }
  }

  const result = !sequence.configuration.provides
    ? {
        ...(Boolean(effectiveValues.outcome) && {
          outcome: effectiveValues.outcome,
        }),
        ...effectiveValues,
      }
    : {
        ...(Boolean(effectiveValues.outcome) && {
          outcome: effectiveValues.outcome,
        }),
        ...injectValuesDict(
          contextAsFlowParams(sequence.configuration.provides),
          effectiveValues,
        ),
      };

  return { result, context: flowContext };
}

async function evaluateDependentFlows(
  configuration: HttpsFlowConfig,
  values: Record<string, unknown>,
  flowContext: FlowContext,
) {
  const effectiveValues = {
    ...flowContext.environment,
    ...values,
  };

  const result = Object.assign(
    {},
    ...(await Promise.all(
      (configuration.use ?? [])
        .filter((usage) => usageNeeded(usage.provides, values))
        .map(async ({ provides, context, flow: flowName }) => {
          const useDefinitions = {};
          const useParams = contextAsFlowParams(context ?? [], useDefinitions);

          const schema = buildDefinitionSchema(
            mapObject(useDefinitions, {
              filter(key) {
                return effectiveValues[key] === undefined;
              },
            }),
          );

          const { output } = await renderSchema(
            schema,
            new ScriptEnvironment({
              input: effectiveValues,
            }),
          );

          const useValues = { ...effectiveValues, ...output };

          const flowValues = context
            ? injectValuesDict(useParams, useValues)
            : useValues;

          let { result } = await flow(flowName, flowValues, flowContext);
          if (provides) {
            result = ejectValuesDict(contextAsFlowParams(provides), result);
          }

          return result;
        }),
    )),
  );

  return { result, context: flowContext.mergeEnvironment(result) };
}

function parseHttpsSequenceScheme({
  steps,
  mode,
  configuration = { context: [], use: [], defaults: {}, import: {} },
}: HttpsFlowScheme) {
  if (mode !== "flow") {
    throw new Error("invalid https seqeuence scheme, not a flow");
  }

  const start = steps[0];
  if (!start) {
    return {
      interactions: [],
      interactionMap: {},
      tries: {},
      configuration,
    };
  }

  if (start.type !== "request") {
    throw new Error("https schemes should start with a request");
  }

  let current: HttpsSequenceInteraction = { request: start, responses: [] };
  const interactions: HttpsSequenceInteraction[] = [current];
  const interactionMap: Record<string, number> = {
    fail: -1,
  };

  if (start.name) {
    interactionMap[start.name] = 0;
  }

  const tries: Record<number, number> = {};
  for (const flowItem of steps.slice(1)) {
    if (flowItem.type === "response") {
      current.responses.push(flowItem);
      continue;
    }

    interactions.push((current = { request: flowItem, responses: [] }));
    if (flowItem.name) {
      const { name, retries } = parseIncome(flowItem.name)! ?? {};
      if (retries) {
        tries[interactions.length - 1] = retries;
      }

      if (name) {
        interactionMap[name] = interactions.length - 1;
      }
    }
  }

  return { interactions, interactionMap, tries, configuration };
}

const coreValues = new Set([
  "method",
  "origin",
  "pathname",
  "search",
  "headers",
  "body",
]);

async function executeHttpsSequenceStep(
  {
    sequenceInteraction: interaction,
    sequenceScheme: sequenceScheme,
    sequencePath: sequenceFile,
    values,
  }: {
    sequenceInteraction: HttpsSequenceInteraction;
    sequenceScheme: HttpsFlowScheme;
    sequencePath: string;
    values: Record<string, any>;
  },
  context: FlowContext,
) {
  const { compiler } = context.runtime;
  const { request, responses: responseTemplates } = interaction;

  const executionValues = {
    ...context.environment,
    ...values,
  };

  const requestHttp = HTTP.stringify({
    ...request.request,
    values: request.values,
  });

  const execution = pardon(executionValues)`${requestHttp}`.render();

  try {
    await execution;
  } catch (error) {
    console.warn(
      `\n\n
--- error matching request to collection ---
${requestHttp}
---
values = ${JSON.stringify(executionValues, null, 2)}
---
error = ${error?.stack ?? error}
--------------------------------------------\n\n`,
    );

    throw error;
  }

  const { outbound, inbound } = await execution.result;

  const outboundValues = mapObject(outbound.redacted.values ?? {}, {
    filter(key) {
      return !coreValues.has(key);
    },
  });
  const inboundValues = inbound.values ?? {};

  const matching =
    responseTemplates.length === 0
      ? ({ result: "matched" } as Awaited<ReturnType<typeof responseOutcome>>)
      : await responseOutcome(
          { compiler },
          {
            sequenceScheme,
            sequenceFile,
            values: {
              ...context.environment,
              ...values,
            },
          },
          responseTemplates,
          inbound.response,
        );

  if (matching.result === "unmatched") {
    // TODO: surface this in the test report
    console.info(HTTP.responseObject.stringify(inbound.redacted));

    for (const { outcome, preview, diagnostics } of matching.templates) {
      console.info(`---`);
      console.info(`<<< ${outcome ? ` ${outcome}` : ""}`);
      for (const loc of diagnostics) {
        console.info(`# mismatched at ${loc}`);
      }

      console.info(HTTP.responseObject.stringify(preview));
    }
    console.info("--------------------------------");

    throw new Error("unmatched response");
  }

  const {
    outcome: outcomeText,
    match: { context: { evaluationScope: scope = undefined } = {} } = {},
  } = matching;

  const outcome = parseOutcome(outcomeText);

  // TODO: determine optimal ordering/behavior here
  const effectiveValues = {
    ...outboundValues,
    ...(responseTemplates.length === 0 && inboundValues),
    ...executionValues,
    ...valuesFromScope(scope),
  };

  // makes unit tests better for now.
  if (outcome) {
    console.info(`  > ${outcome.name}`);
  }

  return {
    inbound: withoutEvaluationScope(inbound),
    outbound: withoutEvaluationScope(outbound),
    outcome,
    values: effectiveValues,
    context,
  };
}

type MatchedResponseOutcome = {
  result: "matched";
  match: ReturnType<typeof mergeSchema>;
  outcome?: string;
};

type UnmatchedResponseOutcome = {
  result: "unmatched";
  templates: {
    outcome?: string;
    preview: ResponseObject;
    diagnostics: string[];
  }[];
};

type ResponseOutcome = MatchedResponseOutcome | UnmatchedResponseOutcome;

async function responseOutcome(
  { compiler }: Pick<PardonRuntime, "compiler">,
  {
    sequenceScheme,
    sequenceFile,
    values,
  }: {
    sequenceScheme: HttpsFlowScheme;
    sequenceFile: string;
    values: Record<string, any>;
  },
  responseTemplates: HttpsResponseStep[],
  responseObject: ResponseObject,
): Promise<ResponseOutcome> {
  const responseSchema = httpsResponseSchema();

  const templates: UnmatchedResponseOutcome["templates"] = [];

  for (const responseTemplate of responseTemplates) {
    const { status, headers, body, outcome } =
      responseTemplate as HttpsResponseStep;

    let merged = mergeSchema(
      { mode: "mux", phase: "build" },
      responseSchema,
      {
        status,
        headers,
        ...(body && { body }),
      } satisfies ResponseObject,
      new ScriptEnvironment(),
    );

    if (merged.schema) {
      const previewEnv = createSequenceEnvironment({
        compiler,
        flowScheme: sequenceScheme,
        flowPath: sequenceFile,
        values,
      });

      const preview = await prerenderSchema(merged.schema, previewEnv);

      merged = mergeSchema(
        { mode: "mux", phase: "build" },
        merged.schema,
        preview.output,
      );

      templates.push({
        outcome,
        preview: preview.output,
        diagnostics: merged.context.diagnostics.map(({ loc }) => loc),
      });
    }

    const match =
      merged.schema &&
      mergeSchema(
        { mode: "match", phase: "validate" },
        merged.schema,
        {
          ...responseObject,
          statusText: responseObject.statusText?.trim() || undefined,
        },
        new ScriptEnvironment(),
      );

    if (match?.schema) {
      return { result: "matched", outcome, match };
    }
  }

  return { result: "unmatched", templates };
}

function valuesFromScope(scope?: EvaluationScope): Record<string, unknown> {
  if (!scope) {
    return {};
  }

  return scope.resolvedValues({ secrets: false });
}

function parseOutcome(outcome?: string) {
  if (!outcome?.trim()) {
    return;
  }
  const [, name, delay, unit] = /^\s*([^\s+]+)(?:\s*[+](\d+)(ms|s)\s*)?$/.exec(
    outcome.trim(),
  )!;

  if (delay) {
    return {
      name,
      delay: Number(delay) * { ms: 1, s: 1000 }[unit ?? "ms"]!,
    };
  }

  return { name };
}

function parseIncome(income?: string) {
  if (!income?.trim()) {
    return;
  }

  const [, name, retries] = /^([^\s/]+)(?:\s*[/]\s*(\d+))?$/.exec(
    income.trim(),
  )!;

  return { name, retries: retries ? Number(retries) : undefined };
}

function usageNeeded(
  provides: HttpsFlowConfig["provides"],
  options: Record<string, unknown>,
) {
  if (!provides) {
    return true;
  }

  const defined = {};
  contextAsFlowParams(provides, defined);

  return Object.keys(defined).some((key) => options[key] === undefined);
}
