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
import {
  HttpsFlowContext,
  HttpsSequenceScheme,
  HttpsRequestStep,
  HttpsResponseStep,
  HttpsUnitConfig,
  HttpsFlowConfig,
} from "../../core/formats/https-fmt.js";
import { ResponseObject } from "../../core/request/fetch-pattern.js";
import { pardon } from "../../api/pardon-wrapper.js";
import {
  mergeSchema,
  prerenderSchema,
  renderSchema,
} from "../../core/schema/core/schema-utils.js";
import {
  httpsRequestSchema,
  httpsResponseSchema,
} from "../../core/request/https-template.js";
import { ScriptEnvironment } from "../../core/schema/core/script-environment.js";
import { definedObject, mapObject } from "../../util/mapping.js";
import {
  UnitParamsDict,
  extractValuesDict,
  injectValuesDict,
  ejectValuesDict,
  execute,
} from "./sequence.js";
import { createSequenceEnvironment } from "../../core/unit-environment.js";
import { PardonAppContext } from "../../core/pardon.js";
import { stubSchema } from "../../core/schema/definition/structures/stub.js";
import { AppContext } from "../../core/app-context.js";
import { intoURL } from "../../core/request/url-pattern.js";
import {
  awaitedResults,
  PardonTraceExtension,
  withoutScope,
} from "../../features/trace.js";
import { HTTP } from "../../core/formats/http-fmt.js";
import { disconnected, tracking } from "../../core/tracking.js";
import { checkFastFailed, pendingFastFailure } from "./cli/failfast.js";
import { TracedResult } from "../../features/trace.js";
import { Schema, SchemaScope } from "../../core/schema/core/types.js";
import { JSON } from "../../core/json.js";

export type SequenceReport = {
  type: "unit" | "flow";
  name: string;
  key: string;
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

const { awaited: awaitedSteps, track: trackStep } =
  tracking<SequenceStepReport>();

const { awaited: awaitedSequences, track: trackSequence } =
  tracking<SequenceReport>();

export { awaitedSequences, awaitedSteps };

type HttpSequenceNotificationHooks = {
  runSequence<T>(
    info: {
      sequence: CompiledHttpsSequence;
      key: string;
      values: Record<string, unknown>;
    },
    callback: () => Promise<T>,
  ): () => Promise<T>;
  onSequenceStepStart(info: {
    request: HttpsRequestStep;
    values: Record<string, unknown>;
  }): void;
  onSequenceStepEnd(info: {
    trace: number;
    inbound: Awaited<
      ReturnType<ReturnType<ReturnType<typeof pardon>>>
    >["inbound"];
    values: Record<string, unknown>;
    outcome: ReturnType<typeof parseOutcome>;
  }): void;
};

let notificationHooks: HttpSequenceNotificationHooks | undefined = undefined;

export function registerSequenceNotificationHooks(
  hooks: HttpSequenceNotificationHooks,
) {
  notificationHooks = hooks;
}

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

function contextAsUnitParams(
  context: HttpsFlowContext,
  defined: Record<string, true | string> = {},
): UnitParamsDict {
  if (typeof context === "string") {
    context = context.split(/\s*,\s*/);
  }

  const params: UnitParamsDict = { dict: {}, required: false };

  for (let item of context) {
    // allow "x: y" as a synonym of "x as y"
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).length === 1 &&
      typeof item[Object.keys(item)[0]] === "string"
    ) {
      const [[k, v]] = Object.entries(item);

      item = `${k} as ${v}`;
    }

    if (typeof item === "string") {
      if (item.startsWith("...")) {
        defined[(params.rested = item.slice(3).trim())] = true;
      } else {
        const [, name, question, value, expression] =
          /(\w+)([?]?)(?:\s+as\s+(\w+))?(?:\s+(?:default|=)\s+(.*))?$/.exec(
            item.trim(),
          )!;

        params.dict[name] = {
          name: value ?? name,
          required: !question,
        };
        defined[value ?? name] = expression ?? true;
      }
    } else if (Array.isArray(item)) {
      throw new Error("unexpected array in context");
    } else if (typeof item === "object") {
      const [[k, v], ...other] = Object.entries(item);
      if (other.length) {
        throw new Error("unexpected");
      }
      params.dict[k] = contextAsUnitParams(v, defined);
    } else throw new Error("unexpected non-object in context: " + typeof item);
  }

  return params;
}

function usageNeeded(
  provides: HttpsUnitConfig["provides"],
  options: Record<string, unknown>,
) {
  if (!provides) {
    return true;
  }

  const defined = {};
  contextAsUnitParams(provides, defined);

  return Object.keys(defined).some((key) => options[key] === undefined);
}

export function compileHttpsSequence(
  scheme: HttpsSequenceScheme,
  { path, name }: { path: string; name: string },
): CompiledHttpsSequence {
  const { interactionMap, interactions, tries, configuration } =
    parseHttpsSequenceScheme(scheme);
  const definitions: Record<string, true | string> = {};
  const params: UnitParamsDict | undefined =
    configuration.context === undefined
      ? undefined
      : contextAsUnitParams(configuration.context, definitions);

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
  scheme: HttpsSequenceScheme;
  path: string;
  name: string;
  params?: UnitParamsDict;
  schema: Schema<Record<string, unknown>>;
  interactionMap: Record<string, number>;
  interactions: HttpsSequenceInteraction[];
  tries: Record<number, number>;
  configuration: HttpsFlowConfig | HttpsUnitConfig;
};

export async function traceSequenceExecution(
  ...args: Parameters<typeof executeHttpsSequence>
) {
  const preAwaitedExecutions = awaitedResults().length;
  const preAwaitedSteps = awaitedSteps().length;
  const preAwaitedSequences = awaitedSequences().length;

  function trackSequenceOutcome(outcome: { result: any } | { error: unknown }) {
    const deps = awaitedSequences().slice(preAwaitedSequences);

    const preSequenceSteps = new Set(
      deps.flatMap(({ steps }) => steps.map(({ trace }) => trace)),
    );

    const preSequenceExecutions = new Set(
      deps.flatMap(({ executions }) =>
        executions.map(({ context: { trace } }) => trace),
      ),
    );

    const executions = awaitedResults()
      .slice(preAwaitedExecutions)
      .filter(({ context: { trace } }) => !preSequenceExecutions.has(trace));

    const steps = awaitedSteps()
      .slice(preAwaitedSteps)
      .filter(({ trace }) => !preSequenceSteps.has(trace));

    const [
      ,
      {
        name,
        scheme: { mode: type },
      },
      key,
      values,
    ] = args;

    trackSequence({
      type,
      name,
      key,
      values,
      deps,
      steps,
      executions,
      ...outcome,
    });
  }

  try {
    const result = await executeHttpsSequence(...args);
    trackSequenceOutcome({ result });
    return result;
  } catch (error) {
    trackSequenceOutcome({ error });

    throw error;
  }
}

export async function executeHttpsSequence(
  { compiler }: Pick<PardonAppContext, "compiler">,
  sequence: CompiledHttpsSequence,
  key: string,
  values: Record<string, unknown>,
) {
  const { params } = sequence;

  const definedValues = params ? extractValuesDict(params, values) : values;

  const sequenceEnvironment = createSequenceEnvironment({
    sequenceScheme: sequence.scheme,
    compiler,
    sequencePath: sequence.path,
    values: definedValues,
  });

  const valuation = await renderSchema(sequence.schema, sequenceEnvironment);

  let effectiveValues = definedObject(valuation.output) as Record<string, any>;

  let attemptLimit: number | undefined;

  if (sequence.scheme.mode === "unit") {
    attemptLimit = (sequence.configuration as HttpsUnitConfig).attempts;
    effectiveValues = {
      ...effectiveValues,
      ...(await evaluateUsedUnits(sequence.configuration, effectiveValues)),
    };
  }

  let attempts = 0;
  let sequenceRun = async () => {
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
      checkFastFailed();
      console.warn(`reattempting unit: ${sequence.name}`);
    }
  };

  sequenceRun =
    notificationHooks?.runSequence(
      { sequence, key, values: effectiveValues },
      sequenceRun,
    ) ?? sequenceRun;

  return await sequenceRun();
}

async function executeFlowSequence(
  sequence: CompiledHttpsSequence,
  compiler: AppContext["compiler"],
  effectiveValues: Record<string, unknown>,
) {
  let index = 0;

  const retries = { ...sequence.tries };

  while (index < sequence.interactions.length) {
    const next = sequence.interactions[index];

    checkFastFailed();

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

    trackStep(result);

    const outcome = result.outcome;

    checkFastFailed();

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
        pendingFastFailure(),
      ]);
    }

    checkFastFailed();

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
          contextAsUnitParams(sequence.configuration.provides),
          effectiveValues,
        ),
      };
}

async function evaluateUsedUnits(
  configuration: HttpsUnitConfig,
  effectiveValues: Record<string, unknown>,
) {
  return Object.assign(
    {},
    ...(await Promise.all(
      (configuration.use ?? [])
        .filter((usage) => usageNeeded(usage.provides, effectiveValues))
        .map(async ({ provides, context, sequence: unitOrFlow }) => {
          const usageOptions = context
            ? injectValuesDict(contextAsUnitParams(context), {
                ...environment,
                ...effectiveValues,
              })
            : { ...environment, ...effectiveValues };

          if (!provides) {
            return await execute(unitOrFlow, usageOptions);
          }

          // only include the specified environment changes
          return ejectValuesDict(
            contextAsUnitParams(provides),
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
}: HttpsSequenceScheme) {
  if (mode !== "unit" && mode !== "flow") {
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
  { compiler }: Pick<AppContext, "compiler">,
  {
    sequenceInteraction: interaction,
    sequenceScheme: sequenceScheme,
    sequencePath: sequenceFile,
    values,
  }: {
    sequenceInteraction: HttpsSequenceInteraction;
    sequenceScheme: HttpsSequenceScheme;
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
      sequenceScheme: sequenceScheme,
      sequencePath: sequenceFile,
      compiler,
      values,
    }),
  );

  const renderedValues = mapObject(
    valuesFromScope(requestRendering.context.scope),
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

  notificationHooks?.onSequenceStepStart({
    request: interaction.request,
    values,
  });

  const { outbound, inbound } = await execution.result;

  const { trace } =
    (await execution.context) as unknown as PardonTraceExtension;

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

  // makes unit tests better for now.
  await disconnected(async () => {
    const renderedRequest = (await execution).request;
    const requestURL = intoURL(renderedRequest);
    const { status, statusText } = inbound.response;

    console.info(
      `-- (${sequenceScheme.mode}) ${`000${trace}`.slice(-3)}: ${renderedRequest.method} ${requestURL} : ${status}${statusText ? ` ${statusText}` : ""}${!matching ? ` (!)` : ""}`,
    );
  });

  if (matching.result === "unmatched") {
    // TODO: surface this in the test report
    console.info(
      `--- failed to match response (${`000${trace}`.slice(-3)}) ---`,
    );
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

    notificationHooks?.onSequenceStepEnd({
      trace,
      inbound,
      values: {},
      outcome: { name: "unmatched" },
    });

    throw new Error("unmatched response");
  }

  const {
    outcome: outcomeText,
    match: { context: { scope = undefined } = {} } = {},
  } = matching;

  const outcome = parseOutcome(outcomeText);

  const effectiveValues = { ...renderedValues, ...valuesFromScope(scope) };
  notificationHooks?.onSequenceStepEnd({
    trace,
    inbound,
    values: effectiveValues,
    outcome,
  });

  // makes unit tests better for now.
  if (outcome) {
    console.info(`  > ${outcome.name}`);
  }

  return {
    trace,
    inbound: withoutScope(inbound),
    outbound: withoutScope(outbound),
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
  { compiler }: Pick<AppContext, "compiler">,
  {
    sequenceScheme,
    sequenceFile,
    values,
  }: {
    sequenceScheme: HttpsSequenceScheme;
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
        sequenceScheme: sequenceScheme,
        sequencePath: sequenceFile,
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

function valuesFromScope(scope?: SchemaScope): Record<string, unknown> {
  if (!scope) {
    return {};
  }

  return scope.resolvedValues({ secrets: false });
}
