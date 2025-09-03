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
  type HttpsFlowScheme,
  type HttpsResponseStep,
  type HttpsFlowConfig,
  type FlowFileName,
  HTTPS,
} from "../../formats/https-fmt.js";
import type { ResponseObject } from "../../request/fetch-object.js";
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
import {
  definedObject,
  mapObject,
  mapObjectAsync,
} from "../../../util/mapping.js";
import { createSequenceEnvironment } from "./flow-environment.js";
import { stubSchema } from "../../schema/definition/structures/stub.js";
import { HTTP } from "../../formats/http-fmt.js";
import type { TracedResult } from "../../../features/trace.js";
import type { EvaluationScope } from "../../schema/core/types.js";
import { JSON } from "../../raw-json.js";
import { withoutEvaluationScope } from "../../schema/core/context-util.js";
import {
  type FlowParamsDict,
  contextAsFlowParams,
  ejectValuesDict,
  injectValuesDict,
} from "./flow-params.js";
import type { FlowContext } from "./flow-context.js";
import type { PardonRuntime } from "../../pardon/types.js";
import { type Flow, type FlowResult, runFlow } from "./flow-core.js";
import { KV } from "../../formats/kv-fmt.js";
import { PardonError } from "../../error.js";
import {
  type TsMorphTransform,
  applyTsMorph,
  evaluation,
} from "../../evaluation/expression.js";
import { SyntaxKind, ts } from "ts-morph";
import type {
  CompiledHttpsSequence,
  HttpExchangeInterraction,
  HttpScriptInterraction,
  HttpsSequenceInteraction,
  FlowStepReport,
} from "./https-flow-types.js";
import { evaluateIdentifierWithExpression } from "../../schema/core/evaluate.js";
import { readFile } from "node:fs/promises";
import { reducedValues } from "../../pardon/pardon.js";
import { dirname, resolve } from "node:path";

export type SequenceReport = {
  type: "unit" | "flow";
  name: string;
  values: Record<string, any>;
  result?: Record<string, any>;
  error?: unknown;
  deps: SequenceReport[];
  steps: FlowStepReport[];
  executions: TracedResult[];
};

export function compileHttpsFlow(
  scheme: HttpsFlowScheme,
  { path, name }: { path: string; name: string },
) {
  const sequence = compileHttpsFlowSequence(scheme, { path, name });
  const flow = createHttpsFlow(sequence);

  return flow;
}

function createHttpsFlow(sequence: CompiledHttpsSequence): Flow {
  return {
    signature: sequence.signature ?? {
      dict: {},
      rested: "",
      required: false,
    },
    action: ({ input: argument, context }) =>
      executeHttpsSequence(sequence, context, argument),
    source: sequence,
  };
}

function buildDefinitionSchema(definitions: Record<string, any>) {
  const definitionSchemaTemplate = mapObject(definitions, {
    values(value, key) {
      if (value === true) {
        return `{{?${key}}}`;
      }

      return `{{ ?${key} = $$expr(${JSON.stringify(value)}) }}`;
    },
    filter(_key, defined) {
      return Boolean(defined);
    },
  }) as Record<string, unknown>;

  return mergeSchema(
    { mode: "merge", phase: "build" },
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

export async function executeHttpsSequence(
  sequence: CompiledHttpsSequence,
  flowContext: FlowContext,
  input: Record<string, unknown>,
): Promise<FlowResult> {
  const { compiler } = flowContext.runtime;

  const definedValues = input;

  flowContext = flowContext.mergeEnvironment(definedValues);

  const sequenceEnvironment = createSequenceEnvironment({
    flowScheme: sequence.scheme,
    compiler,
    flowPath: `pardon:${sequence.name}`,
    values: definedValues,
  });

  const renderedTemplate = await renderSchema(
    sequence.schema,
    sequenceEnvironment,
  );

  const allValues = definedObject(renderedTemplate.output) as Record<
    string,
    any
  >;

  const attemptLimit = sequence.configuration.attempts;
  const dependentFlowResult = await evaluateDependentFlows(
    sequence.configuration,
    allValues,
    flowContext,
  );

  flowContext = dependentFlowResult.context.mergeEnvironment(
    {},
    dependentFlowResult.result,
  );

  let attempts = 0;
  const sequenceRun = async () => {
    for (;;) {
      try {
        const { result, context } = await executeHttpsFlowSequence(
          sequence,
          flowContext,
        );

        return {
          result,
          context,
        };
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

  return sequenceRun();
}

const flowScriptTransform: (unbound: {
  symbols: Set<string>;
  literals: Set<string>;
}) => TsMorphTransform =
  (unbound) =>
  ({ factory, visitChildren }) => {
    const node = visitChildren();

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.EqualsToken
    ) {
      const lhs = node.left;
      if (ts.isIdentifier(lhs) && unbound.symbols.has(lhs.text)) {
        return factory.createBinaryExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("environment"),
            lhs.text,
          ),
          node.operatorToken,
          node.right,
        );
      }
    }

    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "$" &&
      ts.isNoSubstitutionTemplateLiteral(node.template)
    ) {
      return factory.createElementAccessExpression(
        factory.createIdentifier("environment"),
        factory.createStringLiteral(node.template.text),
      );
    }

    return node;
  };

async function executeHttpsFlowSequence(
  sequence: CompiledHttpsSequence,
  flowContext: FlowContext,
): Promise<FlowResult> {
  let index = 0;

  let resultValues = { ...flowContext.flow };

  const retries = { ...sequence.tries };

  while (index < sequence.interactions.length) {
    const next = sequence.interactions[index];

    flowContext.checkAborted();

    if (retries[index] !== undefined) {
      console.log(`step ${index + 1}: retries remaining: ${retries[index]}`);
      if (--retries[index] < 0) {
        throw new Error(
          `ran out of retries for step ${index + 1} of ${sequence.name}`,
        );
      }
    }

    if (next.type === "script") {
      const {
        context: contextValues,
        flow: flowValues,
        target,
      } = await runFlowScript(next, flowContext);

      flowContext.mergeEnvironment(contextValues, flowValues);
      index++;

      if (target) {
        const { name, delay } = parseOutcome(target)!;

        if (delay) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        index = sequence.interactionMap[name] ?? sequence.interactions.length;
      }

      continue;
    }

    const { outcome, context: stepResultContext } =
      await executeHttpsSequenceStep({
        sequenceInteraction: next,
        sequenceScheme: sequence.scheme,
        sequencePath: sequence.path,
        context: flowContext,
      });

    flowContext = stepResultContext;

    // return value from flow has lots of data
    resultValues = {
      ...stepResultContext.context,
      ...stepResultContext.flow,
    };

    // if the outcome is named in the flow, loop, else exit
    if (outcome?.name) {
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

    if (index == sequence.interactions.length && outcome?.name) {
      resultValues.outcome = outcome.name;
    }
  }

  const result = sequence.configuration.provides
    ? {
        ...(resultValues?.outcome
          ? { outcome: resultValues.outcome as string }
          : null),
        ...injectValuesDict(
          contextAsFlowParams(sequence.configuration.provides),
          resultValues,
        ),
      }
    : resultValues;

  return {
    result,
    context: flowContext,
  };
}

async function evaluateDependentFlows(
  configuration: HttpsFlowConfig,
  values: Record<string, any>,
  flowContext: FlowContext,
) {
  const effectiveValues = {
    ...flowContext.context,
    ...values,
  };

  const dependentResults = await Promise.all(
    (configuration.use ?? [])
      .filter((usage) => usageNeeded(usage.provides, values))
      .map(async ({ provides, context, flow: flowFileName }) => {
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

        let { result, context: resultContext } =
          await executeHttpsFlowInContext(
            flowFileName,
            flowValues,
            flowContext,
          );

        if (provides) {
          result = ejectValuesDict(contextAsFlowParams(provides), result);
        }

        return { result, context: resultContext };
      }),
  );

  const result = Object.assign(
    {},
    ...dependentResults.map(({ result }) => result),
  );

  const mergedContext = dependentResults.reduce(
    (mergedContext, { context: resultContext }) => {
      return mergedContext.mergeWithContext(resultContext);
    },
    flowContext,
  );

  return { result, context: mergedContext };
}

function parseHttpsSequenceScheme({
  steps,
  mode,
  configuration = { context: [], use: [], defaults: {}, import: {} },
}: HttpsFlowScheme) {
  if (mode !== "flow") {
    throw new Error("invalid https seqeuence scheme, not a flow");
  }

  if (!steps.length) {
    return {
      interactions: [],
      interactionMap: {},
      tries: {},
      configuration,
    };
  }

  let current: HttpExchangeInterraction | null = null;
  const interactions: HttpsSequenceInteraction[] = [];
  const interactionMap: Record<string, number> = {
    fail: -1,
  };

  const tries: Record<number, number> = {};

  steps = steps.slice();

  while (steps.length) {
    const flowItem = steps.shift()!;

    if (flowItem.type === "script") {
      const interaction: HttpScriptInterraction = {
        type: "script",
        script: flowItem,
      };

      interactions.push(interaction);

      if (flowItem.label) {
        const { name, retries } = parseIncome(flowItem.label)! ?? {};
        if (retries) {
          tries[interactions.length - 1] = retries;
        }

        if (name) {
          interactionMap[name] = interactions.length - 1;
          interaction.name = name;
        }
      }

      current = null;
      continue;
    }

    if (flowItem.type === "response") {
      if (!current) {
        throw new PardonError("flow: unexpected response step after a request");
      }

      current.responses.push(flowItem);
      continue;
    }

    if (flowItem.type !== "request") {
      throw new PardonError(
        "unexpected flow item type: " + (flowItem as any).type,
      );
    }

    interactions.push(
      (current = {
        type: "exchange",
        request: flowItem,
        responses: [],
      }),
    );

    if (flowItem.variant) {
      const { name, retries } = parseIncome(flowItem.variant)! ?? {};

      if (retries) {
        tries[interactions.length - 1] = retries;
        current.retries = retries;
      }

      if (name) {
        interactionMap[name] = interactions.length - 1;
        current.name = name;
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

function removeHttpValues(values?: Record<string, unknown>) {
  return mapObject(values ?? {}, {
    filter(key) {
      return !coreValues.has(key);
    },
  });
}

async function executeHttpsSequenceStep({
  sequenceInteraction: interaction,
  sequenceScheme,
  sequencePath,
  context: flowContext,
}: {
  sequenceInteraction: HttpsSequenceInteraction & { type: "exchange" };
  sequenceScheme: HttpsFlowScheme;
  sequencePath: string;
  context: FlowContext;
}): Promise<FlowStepReport> {
  const { compiler } = flowContext.runtime;
  const { request: requestTemplate, responses: responseTemplates } =
    interaction;

  let preRenderedRequestTemplate: string | undefined;
  let preRenderedValues: Record<string, any> = {};

  if (requestTemplate.request.pathname || requestTemplate.request.origin) {
    const requestSchema = mergeSchema(
      { mode: "merge", phase: "build" },
      httpsRequestSchema(),
      {
        ...requestTemplate.request,
        values: requestTemplate.values,
        computations: requestTemplate.computations,
      },
    );

    if (!requestSchema.schema) {
      throw requestSchema.error ?? new PardonError("failed to merge request");
    }

    const previewEnv = createSequenceEnvironment({
      compiler,
      flowScheme: sequenceScheme,
      flowPath: sequencePath,
      values: {
        ...flowContext.context,
        ...flowContext.flow,
        context: { ...flowContext.context },
        flow: { ...flowContext.flow },
      },
    });

    const renderResult = await prerenderSchema(
      requestSchema.schema,
      previewEnv,
    );

    const evaluatedValues = await mapObjectAsync(
      requestTemplate.computations ?? {},
      (_value, key) =>
        evaluateIdentifierWithExpression(renderResult.context, key),
    );

    preRenderedRequestTemplate = HTTP.stringify(renderResult.output);

    preRenderedValues = {
      ...renderResult.context.evaluationScope.resolvedValues({
        declaredOnly: true,
      }),
      ...requestTemplate.values,
      ...evaluatedValues,
    };
    preRenderedValues = reducedValues(
      requestSchema.schema,
      requestTemplate.request,
      {
        action: "flow",
        configuration: { name: "flow", path: "inline", config: [{}] },
        layers: [],
        service: "default",
      },
      flowContext.runtime,
      preRenderedValues,
    );
  }

  flowContext.checkAborted();

  const executionValues = {
    ...flowContext.context,
    ...preRenderedValues,
  };
  console.log(`
>>>
${KV.stringify(executionValues, { trailer: "\n" })}${preRenderedRequestTemplate ?? requestTemplate.source}`);

  const execution = pardon(
    executionValues,
  )`${preRenderedRequestTemplate ?? requestTemplate.source}`.render();

  try {
    const rendered = await execution;
    void rendered;
  } catch (error) {
    console.warn(
      `\n\n
--- error matching request to collection ---
error = ${error?.stack ?? error}
--------------------------------------------\n\n`,
    );

    throw error;
  }

  const { egress, ingress, output } = await execution.result;

  console.log(`
<<<
${HTTP.responseObject.stringify(ingress.redacted)}`);

  const matching =
    responseTemplates.length === 0
      ? ({ result: "matched", preview: ingress.redacted } as Awaited<
          ReturnType<typeof matchResponseToOutcome>
        >)
      : await matchResponseToOutcome(
          { compiler },
          {
            sequenceScheme,
            sequencePath,
            values: executionValues,
          },
          responseTemplates,
          ingress.response,
        );

  if (matching.result === "unmatched") {
    console.info("=!= unmatched response");
    for (const { outcome, preview, diagnostics } of matching.templates) {
      console.info(`---`);
      if (diagnostics.length == 0) {
        console.info(`# oops, no diagnostics produced about the mismatch`);
      } else {
        for (const loc of diagnostics) {
          console.info(`# mismatched at ${loc}`);
        }
      }

      console.info(`<<<${outcome ? ` ${outcome}` : ""}`);
      console.info(HTTP.responseObject.stringify(preview));
    }

    throw new Error("unmatched response");
  }

  const {
    outcome: outcomeText,
    match: { context: { evaluationScope: scope = undefined } = {} } = {},
  } = matching;

  const outcome = parseOutcome(outcomeText);

  const flowResponseValues =
    responseTemplates.length === 0 ? output : flowValuesFromScope(scope);

  // makes unit tests better for now.
  if (outcome?.name) {
    console.info(`--> ${outcome.name}`);
  }

  return {
    egress: withoutEvaluationScope(egress),
    ingress: withoutEvaluationScope(ingress),
    outcome,
    values: {
      send: removeHttpValues(egress.redacted.values),
      recv: ingress.values,
      data: scope?.resolvedValues() ?? {},
      flow: flowResponseValues,
    },
    context: flowContext.mergeEnvironment({}, flowResponseValues),
  };
}

type MatchedResponseOutcome = {
  result: "matched";
  match: ReturnType<typeof mergeSchema>;
  preview: ResponseObject;
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

async function matchResponseToOutcome(
  { compiler }: Pick<PardonRuntime, "compiler">,
  {
    sequenceScheme,
    sequencePath,
    values,
  }: {
    sequenceScheme: HttpsFlowScheme;
    sequencePath: string;
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
      { mode: "merge", phase: "build" },
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
        flowPath: sequencePath,
        values,
      });

      const preview = await prerenderSchema(merged.schema, previewEnv);

      merged = mergeSchema(
        { mode: "merge", phase: "build" },
        merged.schema,
        preview.output,
      );

      if (merged.error) {
        throw merged.error;
      }

      templates.push({
        outcome,
        preview: preview.output,
        diagnostics: merged.context!.diagnostics.map(({ loc }) => loc),
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
        new ScriptEnvironment({
          input: values,
        }),
      );

    if (match?.schema) {
      return {
        result: "matched",
        outcome,
        match,
        preview: templates.slice(-1)[0].preview,
      } satisfies MatchedResponseOutcome;
    } else if (match) {
      if (match.error) {
        throw match.error;
      }

      templates
        .slice(-1)[0]
        .diagnostics.push(
          ...(match?.context!.diagnostics.map(({ loc }) => loc) || []),
        );
    }
  }

  return { result: "unmatched", templates };
}

function flowValuesFromScope(scope?: EvaluationScope): Record<string, unknown> {
  if (!scope) {
    return {};
  }

  return scope.resolvedValues({ secrets: false });
}

function parseOutcome(outcome?: string) {
  if (!outcome?.trim()) {
    return;
  }

  const [, name, delay, unit] =
    /^\s*([^\s+]+)?(?:\s*[+](\d+)(ms|s|m)\s*)?$/.exec(outcome.trim())!;

  if (delay) {
    return {
      name,
      delay: Number(delay) * { ms: 1, s: 1000, m: 60 * 1000 }[unit ?? "ms"]!,
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

class Goto extends Error {
  target: string;
  constructor(target: string) {
    super("goto: " + target);
    this.target = target;
  }
}

async function runFlowScript(
  next: HttpScriptInterraction,
  flowContext: FlowContext,
): Promise<{
  context: Record<string, any>;
  flow: Record<string, any>;
  target?: string;
}> {
  const flowValues = { ...flowContext.flow };
  const contextValues = { ...flowContext.context };

  const script = `(() => { ${next.script.script} ;;; })()`;

  const { unbound } = applyTsMorph(script);

  try {
    await evaluation(
      script,
      {
        binding(key) {
          if (key === "environment") {
            return flowValues;
          }

          if (key === "context") {
            return contextValues;
          }

          if (key === "console") {
            return console;
          }

          if (key === "goto") {
            return (next: string) => {
              throw new Goto(next);
            };
          }
          return (
            flowValues[key] ?? flowContext.flow[key] ?? flowContext.context[key]
          );
        },
      },
      flowScriptTransform(unbound),
    );
  } catch (error) {
    if (error instanceof Goto) {
      return {
        context: contextValues,
        flow: flowValues,
        target: error.target,
      };
    }
    throw error;
  }

  return { context: contextValues, flow: flowValues };
}

async function loadFlowFile(context: FlowContext, path: FlowFileName) {
  if (context.relative) {
    path = resolve(dirname(context.relative), path) as FlowFileName;
  }

  const flowFilePath = context.runtime.compiler.resolve(path, "");
  console.log(`flowFilePath: ${flowFilePath}: ${resolve(flowFilePath)}`);
  try {
    const content = await readFile(flowFilePath, "utf-8");
    const scheme = HTTPS.parse(content, "flow") as HttpsFlowScheme;
    return compileHttpsFlow(scheme, {
      path: flowFilePath,
      name: path,
    });
  } catch (error) {
    void error;
    return null;
  }
}

export async function executeHttpsFlowInContext(
  name: FlowFileName,
  input: Record<string, unknown>,
  context: FlowContext,
) {
  const flow = await loadFlowFile(context, name);

  if (!flow) {
    throw new PardonError(`no flow named ${name}`);
  }

  return runFlow(flow, input, context);
}
