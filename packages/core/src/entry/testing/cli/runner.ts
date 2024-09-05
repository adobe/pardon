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
import { dirname, join, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { arrayIntoObject, mapObject } from "../../../util/mapping.js";
import { TracedResult, awaitedResults } from "../../../features/trace.js";
import { HTTP } from "../../../core/formats/http-fmt.js";
import { onExecute, registerUnit, registerFlow } from "../sequence.js";
import {
  awaitedSequences,
  compileHttpsSequence,
  SequenceReport,
  SequenceStepReport,
  traceSequenceExecution,
} from "../https-sequence.js";
import {
  all_disconnected,
  disconnected,
  semaphore,
  shared,
  tracking,
} from "../../../core/async.js";
import { PardonAppContext } from "../../../core/pardon.js";
import {
  HttpsFlowScheme,
  HttpsUnitScheme,
} from "../../../core/formats/https-fmt.js";
import { flushTrialRegistry, withGamutConfiguration } from "../trial.js";
import { glob } from "glob";
import { AppContext } from "../../../core/app-context.js";
import describeCases, { CaseContext, CaseHelpers } from "../testcases/index.js";
import { notifyFastFailed } from "./failfast.js";
import { applySmokeConfig, SmokeConfig } from "../smoking.js";
import * as YAML from "yaml";
import { cleanObject } from "../../../util/clean-object.js";
import { KV } from "../../../core/formats/kv-fmt.js";

export type TestSetup = {
  test: () => Promise<void>;
  testcase: string;
  environment: Record<string, unknown>;
};

const inflight = new AsyncLocalStorage<{
  scheduled: Promise<unknown>[];
  awaited: ReturnType<typeof tracking>;
}>();

declare let environment: Record<string, unknown>;

onExecute((promise) => {
  const store = inflight.getStore();

  if (!store) {
    return promise;
  }

  const { scheduled, awaited } = store;

  scheduled.push(promise);

  return promise.finally(() => {
    awaited.track(promise);
  });
});

export async function writeResultSummary(
  testResults: {
    testcase: string;
    errors: unknown[];
  }[],
  report: string,
) {
  const passing = testResults.filter(({ errors }) => errors.length == 0);
  const failing = testResults.filter(({ errors }) => errors.length > 0);

  const results = `--- TEST RESULTS ---

${
  passing.length > 0
    ? `- PASSED -
${passing.map(({ testcase }) => `${testcase}: PASS\n`).join("")}
`
    : ""
}${
    failing.length > 0
      ? `- FAILED -
${failing.map(({ testcase }) => `${testcase}: FAIL\n`).join("")}
`
      : ""
  }Summary: TESTS PASSED ${passing.length} / TESTS FAILED ${failing.length}`;

  console.info(`\n\n\n${results}`);

  await writeFile(join(report, "results.txt"), results);
}

export async function executeSelectedTests(
  configuration: PardonTestConfiguration,
  selectedTests: {
    test: () => Promise<void>;
    testcase: string;
    environment: Record<string, unknown>;
  }[],
  report: string,
  ff: boolean | undefined,
) {
  // run at most N tests at once concurrently.
  const concurrently = configuration.concurrency
    ? semaphore(configuration.concurrency)
    : <T>(fn: () => Promise<T> | T) => fn();

  process.once("SIGINT", (signal) => {
    console.warn("... waiting for tests to complete ...");
    notifyFastFailed(signal);
  });

  process.once("SIGTERM", (signal) => {
    console.warn("... waiting for tests to complete ...");
    notifyFastFailed(signal);
  });

  const testResults = await all_disconnected(
    selectedTests.map(
      async ({ test, testcase, environment: { ...environment } }) =>
        await concurrently(() =>
          /*
           * `concurrently(() => disconnected(...))`
           * seems to finally fix the horrible-no-good-very-bad
           * GC/OOM issues with huge (300+ case) tests.
           */
          disconnected(async () => {
            let errors: unknown[] = [];
            let env: Record<string, any> = environment;
            const init = { ...env };
            try {
              ({ errors, environment: env } = await executeTest(
                test,
                testcase,
              ));

              if (ff && errors.length > 0) {
                notifyFastFailed(errors[0]);
              }

              return { testcase, errors, environment: env };
            } catch (error) {
              if (ff) {
                notifyFastFailed(error ?? new Error("undefined error"));
              }
              errors.push(error);

              return { testcase, errors, environment };
            } finally {
              await writeTestExecutionResult(
                report,
                testcase,
                errors,
                init,
                env!,
                awaitedSequences(),
              );
            }
          }),
        ),
    ),
  );

  return testResults.sort((a, b) => a.testcase.localeCompare(b.testcase));
}

type RequestGraph = Record<string, RequestTraceInfo>;
type RequestTraceInfo = { operation: TracedResult; deps: number[] };

export async function writeTestExecutionResult(
  report: string,
  testcase: string,
  errors: unknown[],
  init: Record<string, unknown>,
  env: Record<string, unknown>,
  units: SequenceReport[],
) {
  const { graph: requestGraph, list: requests } = graph();
  const testReportDir = join(report, testcase);

  console.info(`
${errors.length ? "FAIL" : "PASS"}: ${testcase}${errors.map((error) => `\n  - ERROR: ${error}`).join("")}
  - ${requests.length === 0 ? "" : `from: ${requests.map(fmtTraceId).reverse().join(", ")} `}see ${testReportDir}`);

  await mkdir(testReportDir, {
    recursive: true,
  });

  const logFilePromise = writeReportFile(
    testcase,
    testReportDir,
    errors,
    units,
    init,
    env,
  );

  await Promise.all([
    logFilePromise,
    ...Object.entries(requestGraph).map(([traceId, { operation }]) =>
      writeHttpRequestResponseFile(testReportDir, traceId, operation),
    ),
  ]);
}

function formatTracedResult({
  context: {
    trace,
    durations: { request },
  },
  outbound: {
    redacted: { method, origin, pathname },
  },
  inbound: {
    redacted: { status },
    outcome,
  },
}: TracedResult<unknown>) {
  return `${fmtTraceId(trace)} > ${method} ${origin}${pathname} ~ ${status}${outcome ? ` (${outcome})` : ""} +${request}ms`;
}

function formatTracedStep({
  trace,
  outcome: { name } = { name: "ok" },
  outbound: {
    redacted: { method, origin, pathname },
  },
  inbound: {
    redacted: { status },
  },
}: SequenceStepReport) {
  return `${fmtTraceId(trace)} > ${method} ${origin}${pathname} ~ ${status}${name ? ` (${name})` : ""}`;
}

function writeHttpRequestResponseFile(
  testReportDir: string,
  traceId: string,
  operation: RequestTraceInfo["operation"],
): Promise<void> {
  const awaited = operation.context.awaited.results.map((tr) =>
    formatTracedResult(tr),
  );

  const info = cleanObject({
    awaited,
  });

  let values = operation.outbound.redacted.values;
  if (operation.context.ask) {
    const { values: askValues = {} } = HTTP.parse(operation.context.ask);
    values = mapObject(values, {
      filter(key) {
        return key in askValues;
      },
    });
  }

  return writeFile(
    join(
      testReportDir,
      `${fmtTraceId(
        traceId,
      )}--${operation.endpoint.configuration.path.replace(/^pardon:/, "/").replace(/[/]/g, "-")}.log.https`,
    ),
    `${info ? YAML.stringify(info, { lineWidth: Infinity, defaultStringType: "PLAIN", doubleQuotedMinMultiLineLength: Infinity }).trim() : ""}
>>> ${fmtTraceId(traceId)} (${operation.endpoint.configuration.path})
${HTTP.stringify({ ...operation.outbound.redacted, values }).trim()}

<<<
${HTTP.responseObject.stringify(operation.inbound.redacted)}`.trim(),
  );
}

function writeReportFile(
  testcase: string,
  testReportDir: string,
  errors: unknown[],
  sequences: SequenceReport[],
  init: Record<string, unknown>,
  env: Record<string, unknown>,
) {
  return writeFile(
    join(testReportDir, `requests.log`),
    [
      `# ${errors.length ? "FAIL" : "PASS"} - ${testcase}`,
      ...errors.flatMap((error) =>
        [...String((error as any)?.stack ?? error).split("\n"), ""]
          .filter((line) => line.trim())
          .map((line) => `# ${line}`),
      ),
      ...(sequences.length
        ? [
            "",
            `>>>>>`,
            KV.stringify(init, "\n", 2),
            "",
            ...sequences.map(
              ({ type, name, key, values, result, error, steps }) =>
                `>>> ${name}.${type} : ${key}
${KV.stringify(cleanObject(values), "\n", 2)}

${steps.map((step) => `# ${formatTracedStep(step)}`).join("\n")}
${
  result
    ? `  <<< ${result.outcome ?? "ok"}
${resultKV(result, values)}\n`
    : `  <<< error: ${error}
${String(error?.["stack"] ?? error)
  .split("\n")
  .map((s) => `  # ${s}`)
  .join(`\n`)}\n`
}`,
            ),
          ]
        : []),
      "<<<<<",
      KV.stringify(resultEnv(env, init) ?? {}, "\n", 2),
    ].join("\n"),
    "utf-8",
  );
}

function resultEnv(
  result: Record<string, unknown>,
  init: Record<string, unknown>,
) {
  return cleanObject(
    mapObject(
      { ...result, outcome: undefined },
      {
        filter(key, value) {
          return init?.[key] !== value;
        },
      },
    ),
  );
}

function resultKV(
  result: Record<string, unknown>,
  init: Record<string, unknown>,
) {
  const output = resultEnv(result, init) ?? {};

  const text = KV.stringify(output, "\n", 2).split("\n").join("\n  ");

  if (!text.trim()) return "";
  return `  ${text}`;
}

export async function executeTest(fn: () => Promise<void>, testcase: string) {
  const rejected: unknown[] = [];
  const awaited = tracking<Promise<unknown>>();
  const scheduled: Promise<unknown>[] = [];
  let env: Record<string, any>;

  console.info("starting test -- " + testcase);

  await inflight.run({ scheduled, awaited }, async () => {
    try {
      await Promise.resolve(
        shared(async () => {
          environment = null!;
          await fn();
        }),
      );
    } catch (error) {
      rejected.push(error);
    } finally {
      env = { ...environment };

      const completions: PromiseSettledResult<unknown>[] = [];
      let once = true;
      while (scheduled.length) {
        const resolved = awaited.awaited();
        const todo = scheduled
          .splice(0, scheduled.length)
          .filter((p) => !resolved.includes(p));

        if (once && todo.length) {
          console.info("finalizing test -- " + testcase);
          once = false;
        }

        completions.push(...(await Promise.allSettled(todo)));
      }

      const errors = [
        ...completions
          .map((result) => result.status === "rejected" && result.reason)
          .filter(Boolean)
          .filter((error) => !rejected.includes(error)),
      ];

      console.info(
        `test complete -- ${testcase}: ${errors.length ? `FAIL ${errors.length} errors` : "PASS"}`,
      );

      rejected.push(...errors);
    }
  });

  return { errors: rejected, environment: env! };
}

function formatReportPath(
  format: string,
  { date, num }: { date: Date; num: number },
) {
  return format.replace(/%([a-z_]+)%?|%%/g, (match, key) => {
    if (match === "%%") {
      return "%";
    }

    switch (key) {
      case "date": {
        const [, ymd] = /^([^T]+)T.*Z$/.exec(date.toISOString())!;
        return ymd;
      }
      case "num":
        return String(num);
      default:
        throw new Error(`unknown report format pattern: ${match}`);
    }
  });
}

export async function chooseReportOutput(format: string) {
  const date = new Date(
    Date.now() - new Date().getTimezoneOffset() * 1000 * 60,
  );

  let num = 1;

  while (true) {
    const candidate = formatReportPath(format, { date, num });

    if (!existsSync(candidate)) {
      return candidate;
    }

    if (
      !format.split(/(%[a-z]+%?|%%)/g).some((tok) => tok.startsWith("%num"))
    ) {
      throw new Error(`${candidate} : report already exists`);
    }

    num++;
  }
}

function graph(): { graph: RequestGraph; list: number[] } {
  const operations = awaitedResults();

  const graph = arrayIntoObject(operations, (operation) => ({
    [operation.context.trace]: {
      operation,
      deps: operation.context.awaited.results.map(
        ({ context: { trace } }) => trace,
      ),
    },
  }));

  minimize(graph);
  const list = operations.map(({ context: { trace } }) => trace);

  return { graph, list };
}

function minimize<T extends { deps: number[] }>(graph: Record<number, T>) {
  const complete = mapObject(graph, ({ deps }) => deps);

  for (const record of Object.values(graph)) {
    const depdeps = new Set<number>(
      record.deps.flatMap((dep) => complete[dep]),
    );

    record.deps = record.deps.filter((dep) => !depdeps.has(dep));
  }
}

function fmtTraceId(trace: number | string) {
  return `000${trace}`.slice(-3);
}

export async function registerHttpsUnit(
  { compiler }: PardonAppContext,
  unitName: string,
  unitPath: string,
  unitScheme: HttpsUnitScheme,
) {
  if (unitScheme.mode !== "unit") {
    throw new Error("unit sequence expected");
  }

  const sequence = compileHttpsSequence(unitScheme, {
    path: unitPath,
    name: unitName,
  });

  return registerUnit(unitName, {
    path: unitPath,
    params: sequence.params ?? { dict: {}, rested: "", required: false },
    async action(values, key) {
      return await traceSequenceExecution({ compiler }, sequence, key, values);
    },
  });
}

export async function registerHttpsFlow(
  { compiler }: PardonAppContext,
  flowName: string,
  flowPath: string,
  flowScheme: HttpsFlowScheme,
) {
  if (flowScheme.mode !== "flow") {
    throw new Error("flow sequence expected");
  }

  const sequence = compileHttpsSequence(flowScheme, {
    path: flowPath,
    name: flowName,
  });

  return registerFlow(flowName, {
    path: flowPath,
    params: sequence.params ?? { dict: {}, rested: "", required: false },
    async action(values, key) {
      return await traceSequenceExecution({ compiler }, sequence, key, {
        ...environment,
        ...values,
      });
    },
  });
}

export type PardonTestConfiguration = {
  gamut?: string;
  concurrency?: number;
  sequences?: string[];
  tests?: string[];
  opening?(helpers: CaseHelpers): void;
  closing?(helpers: CaseHelpers): void;
  report?(
    reportdir: string,
    results: {
      testcase: string;
      environment: typeof environment;
      errors: any[];
    }[],
  ): void | Promise<void>;
};

export type TestLoadOptions = {
  testPath: string;
  concurrency?: number;
};

export async function loadTests(
  context: AppContext,
  { testPath, concurrency }: TestLoadOptions,
) {
  const cwd = dirname(testPath);

  const configuration = (
    await withGamutConfiguration(
      () => import(testPath, { with: { type: "tests" } }),
    )
  ).default as PardonTestConfiguration;

  if (concurrency !== undefined) {
    configuration.concurrency = concurrency;
  }

  configuration.sequences ??= ["./sequences/**"];
  configuration.tests ??= ["./**/*.test.ts", "./!(node_modules)/**/*.test.ts"];

  for (const sequenceRoot of configuration.sequences) {
    if (!sequenceRoot.endsWith("/**")) {
      throw new Error("expect sequences root glob to end with /**");
    }
  }

  await Promise.all(
    configuration.sequences.map(async (sequenceRoot) => {
      const root = resolve(cwd, sequenceRoot);
      const unitTemplates = await glob(join(root, "*.unit.https"), {
        cwd,
        nodir: true,
        absolute: true,
      });

      const base = root.replace(/[/][*][*]$/, "/");

      return await Promise.all(
        unitTemplates.map(async (httpsUnit) => {
          const name = httpsUnit
            .slice(base.length)
            .replace(/[.]unit[.]https$/, "");
          const { default: schema } = await import(httpsUnit);

          return registerHttpsUnit(context, name, httpsUnit, schema);
        }),
      );
    }),
  );

  await Promise.all(
    configuration.sequences.map(async (sequenceRoot) => {
      const root = resolve(cwd, sequenceRoot);
      const flowTemplates = await glob(join(root, "*.flow.https"), {
        cwd,
        nodir: true,
        absolute: true,
      });

      const base = root.replace(/[/][*][*]$/, "/");

      return await Promise.all(
        flowTemplates.map(async (httpsFlow) => {
          const name = httpsFlow
            .slice(base.length)
            .replace(/[.]flow[.]https$/, "");
          const { default: schema } = await import(httpsFlow);

          return registerHttpsFlow(context, name, httpsFlow, schema);
        }),
      );
    }),
  );

  const trialRegistry = await flushTrialRegistry(configuration);

  return {
    testplanner: (
      environment: Record<string, unknown>,
      smokeConfig?: SmokeConfig,
      ...filter: string[]
    ) => {
      const alltestcases = describeCases(
        configuration.closing || (() => {}),
        trialRegistry.flatMap(({ descriptions }) => {
          return descriptions.reduce(
            (cases, description) => describeCases(description, cases),
            [
              {
                defs: {},
                environment: { ...environment },
              },
            ] as CaseContext[],
          );
        }),
      );

      validateTestPlan(alltestcases);

      const cases = describeCases(
        (helpers) => applySmokeConfig(helpers, smokeConfig),
        alltestcases,
      ).map(
        ({
          environment: {
            testcase,
            "::testexecution": testexecution,
            ...environment
          },
        }) =>
          ({
            test: () => testexecution(environment),
            testcase,
            environment,
          }) as TestSetup,
      );

      const patterns = (filter.length ? filter : ["**"]).map(globre);
      return cases.filter(({ testcase }) =>
        patterns.some((pattern) => pattern.test(testcase)),
      );
    },
    configuration,
  };
}

function globre(glob: string) {
  return new RegExp(
    `^${glob.replace(
      /[[\]()\\.*^$+&?{][*]?/g,
      (match) =>
        ({
          "*": "[^/]*",
          "**": ".*",
        })[match] ?? "\\" + match,
    )}$`,
  );
}

function validateTestPlan(testplan: CaseContext[]) {
  testplan.reduce((set, { environment: { testcase } }) => {
    if (set.has(testcase)) {
      throw new Error("duplicate definition of test: " + testcase);
    }

    return set.add(testcase);
  }, new Set<string>([]));
}
