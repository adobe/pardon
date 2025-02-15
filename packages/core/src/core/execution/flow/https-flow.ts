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
import {
  httpsRequestSchema,
  httpsResponseSchema,
} from "../../request/https-template.js";
import { ScriptEnvironment } from "../../schema/core/script-environment.js";
import { definedObject, mapObject } from "../../../util/mapping.js";
import { execute } from "./flow.js";
import { createSequenceEnvironment } from "../../unit-environment.js";
import { PardonAppContext } from "../../pardon.js";
import { stubSchema } from "../../schema/definition/structures/stub.js";
import { PardonContext } from "../../app-context.js";
import { HTTP } from "../../formats/http-fmt.js";
//import { checkFastFailed, pendingFastFailure } from "./cli/failfast.js";
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

export function compileHttpsFlow(
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

  const definitionSchemaTemplate = mapObject(definitions, {
    values(value, key) {
      if (value === true) {
        return `{{?${key}}}`;
      }

      return `{{?${key} = ${value}}}`;
    },
    filter(_key, mapped) {
      return Boolean(mapped);
    },
  }) as Record<string, unknown>;

  const schema = mergeSchema(
    { mode: "mux", phase: "build" },
    stubSchema(),
    definitionSchemaTemplate,
  ).schema!;

  return {
    scheme,
    path,
    name,
    params,
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
  params?: FlowParamsDict;
  schema: Schema<Record<string, unknown>>;
  interactionMap: Record<string, number>;
  interactions: HttpsSequenceInteraction[];
  tries: Record<number, number>;
  configuration: HttpsFlowConfig;
};

export async function executeHttpsSequence(
  { compiler }: Pick<PardonAppContext, "compiler">,
  sequence: CompiledHttpsSequence,
  values: Record<string, unknown>,
) {
  const { params } = sequence;

  const definedValues = params ? extractValuesDict(params, values) : values;

  const sequenceEnvironment = createSequenceEnvironment({
    flowScheme: sequence.scheme,
    compiler,
    flowPath: sequence.path,
    values: definedValues,
  });

  const valuation = await renderSchema(sequence.schema, sequenceEnvironment);

  let effectiveValues = definedObject(valuation.output) as Record<string, any>;

  const attemptLimit = sequence.configuration.attempts;

  effectiveValues = {
    ...effectiveValues,
    ...(await evaluateUsedUnits(sequence.configuration, effectiveValues)),
  };

  let attempts = 0;
  const sequenceRun = async () => {
    try {
      const result = await executeFlowSequence(
        sequence,
        compiler,
        effectiveValues,
      );
      return result;
    } catch (error) {
      if (!attemptLimit) {
        throw error;
      } else if (++attempts >= attemptLimit) {
        console.warn(`attempt limit reached: ${sequence.name}`);
        throw error;
      }
      //checkFastFailed();
      console.warn(`reattempting unit: ${sequence.name}`);
    }
  };

  return await sequenceRun();
}

async function executeFlowSequence(
  sequence: CompiledHttpsSequence,
  compiler: PardonContext["compiler"],
  effectiveValues: Record<string, unknown>,
) {
  let index = 0;

  const retries = { ...sequence.tries };

  while (index < sequence.interactions.length) {
    const next = sequence.interactions[index];

    //checkFastFailed();

    if (retries[index] !== undefined) {
      if (--retries[index] < 0) {
        throw new Error(
          `ran out of retries for step ${index + 1} of ${sequence.name}`,
        );
      }
    }

    const result = await executeHttpsSequenceStep(
      { compiler },
      {
        sequenceInteraction: next,
        sequenceScheme: sequence.scheme,
        sequencePath: sequence.path,
        values: effectiveValues,
      },
    );

    const outcome = result.outcome;

    //checkFastFailed();

    effectiveValues = {
      ...effectiveValues,
      ...result.values,
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
        //pendingFastFailure(),
      ]);
    }

    //checkFastFailed();

    if (index == sequence.interactions.length && outcome) {
      effectiveValues = {
        outcome: outcome.name,
        ...effectiveValues,
      };
    }
  }

  return !sequence.configuration.provides
    ? effectiveValues
    : {
        ...(Boolean(effectiveValues.outcome) && {
          outcome: effectiveValues.outcome,
        }),
        ...injectValuesDict(
          contextAsFlowParams(sequence.configuration.provides),
          effectiveValues,
        ),
      };
}

async function evaluateUsedUnits(
  configuration: HttpsFlowConfig,
  effectiveValues: Record<string, unknown>,
) {
  return Object.assign(
    {},
    ...(await Promise.all(
      (configuration.use ?? [])
        .filter((usage) => usageNeeded(usage.provides, effectiveValues))
        .map(async ({ provides, context, flow: unitOrFlow }) => {
          const usageOptions = context
            ? injectValuesDict(contextAsFlowParams(context), {
                ...environment,
                ...effectiveValues,
              })
            : { ...environment, ...effectiveValues };

          if (!provides) {
            return await execute(unitOrFlow, usageOptions);
          }

          // only include the specified environment changes
          return ejectValuesDict(
            contextAsFlowParams(provides),
            await execute(unitOrFlow, usageOptions),
          );
        }),
    )),
  );
}

function parseHttpsSequenceScheme({
  steps,
  mode,
  configuration = { context: [], use: [], defaults: {}, import: {} },
}: HttpsFlowScheme) {
  if (mode !== "flow") {
    throw new Error("invalid https seqeuence scheme, not a flow or unit");
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
  { compiler }: Pick<PardonContext, "compiler">,
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
) {
  const { request, responses: responseTemplates } = interaction;

  const requestBase = mergeSchema(
    { mode: "mux", phase: "build" },
    httpsRequestSchema(undefined, { search: { multivalue: true } }),
    request?.request,
  );

  if (!requestBase.schema) {
    throw new Error(
      "invalid request template: " + JSON.stringify(request?.request),
    );
  }

  const requestRendering = await renderSchema(
    requestBase.schema,
    createSequenceEnvironment({
      flowScheme: sequenceScheme,
      flowPath: sequenceFile,
      compiler,
      values,
    }),
  );

  const renderedValues = mapObject(
    valuesFromScope(requestRendering.context.evaluationScope),
    {
      filter(key) {
        return !coreValues.has(key);
      },
    },
  );

  const executionValues = {
    ...environment,
    ...renderedValues,
    ...values,
  };

  const execution = pardon(
    executionValues,
  )`${HTTP.stringify(requestRendering.output)}`.render();

  try {
    await execution;
  } catch (error) {
    console.warn(
      `\n\n
--- error matching request to collection ---
${HTTP.stringify(requestRendering.output)}
---
values = ${JSON.stringify(executionValues, null, 2)}
---
error = ${error?.stack ?? error}
--------------------------------------------\n\n`,
    );

    throw error;
  }

  const { outbound, inbound } = await execution.result;

  const matching =
    responseTemplates.length === 0
      ? ({ result: "matched" } as Awaited<ReturnType<typeof responseOutcome>>)
      : await responseOutcome(
          { compiler },
          {
            sequenceScheme,
            sequenceFile,
            values: {
              ...environment,
              ...renderedValues,
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

  const effectiveValues = { ...renderedValues, ...valuesFromScope(scope) };

  // makes unit tests better for now.
  if (outcome) {
    console.info(`  > ${outcome.name}`);
  }

  return {
    inbound: withoutEvaluationScope(inbound),
    outbound: withoutEvaluationScope(outbound),
    outcome,
    values: effectiveValues,
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
  { compiler }: Pick<PardonContext, "compiler">,
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
