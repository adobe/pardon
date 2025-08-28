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
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { arrayIntoObject, mapObject } from "../../util/mapping.js";
import { TracedResult, awaitedResults } from "../../features/trace.js";
import { HTTP, RequestObject } from "../../core/formats/http-fmt.js";
import {
  FlowReport,
  FlowStepReport,
} from "../../core/execution/flow/https-flow-types.js";
import {
  disconnected,
  semaphore,
  shared,
  tracking,
} from "../../core/tracking.js";
import { notifyFastFailed } from "../../core/execution/flow/failfast.js";
import * as YAML from "yaml";
import { cleanObject } from "../../util/clean-object.js";
import { KV } from "../../core/formats/kv-fmt.js";
import { PardonError } from "../../core/error.js";
import {
  flushTrialRegistry,
  withSurveyConfiguration as withSurveyConfiguration,
} from "./trial.js";
import describeCases, {
  CaseContext,
  CaseHelpers,
} from "../../core/testcases/index.js";
import { applySmokeConfig, type SmokeConfig } from "./smoke-config.js";
import { registerFlowHook } from "../../core/execution/flow/index.js";
import { disarm } from "../../util/promise.js";

export type TestSetup = {
  test: () => Promise<void>;
  testcase: string;
  testenv: Record<string, unknown>;
};

export type TestPlanning = {
  cases: TestSetup[];
  patterns?: RegExp[];
  antipatterns?: RegExp[];
};

const inflight = new AsyncLocalStorage<{
  testcase: string;
  scheduled: Promise<unknown>[];
  awaited: ReturnType<typeof tracking>;
}>();

export function setupRunnerHooks() {
  registerFlowHook(schedulePending);
}

function schedulePending<T>(promise: Promise<T>): Promise<T> {
  const store = inflight.getStore();

  if (!store) {
    return promise;
  }

  const { scheduled, awaited } = store;

  scheduled.push(promise);

  return disarm(promise.finally(() => awaited.track(promise)));
}

export async function writeResultSummary(
  reportDirectory: string,
  testResults: {
    testcase: string;
    errors: unknown[];
  }[],
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

  await writeFile(join(reportDirectory, "results.txt"), results);
}

export async function executeSelectedTests(
  configuration: PardonTestConfiguration,
  selectedTests: TestSetup[],
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

  const testResults = await Promise.all(
    selectedTests.map(
      async ({ test, testcase, testenv: { ...testenv } }) =>
        await concurrently(() =>
          /*
           * `concurrently(() => disconnected(...))`
           * seems to finally fix the horrible-no-good-very-bad
           * GC/OOM issues with huge (300+ case) tests.
           */
          disconnected(async () => {
            let errors: unknown[] = [];
            let env: Record<string, any> = testenv;
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
              try {
                await writeTestExecutionResult(
                  report,
                  testcase,
                  errors,
                  init,
                  env!,
                  [],
                );
              } catch (error) {
                console.error(
                  `${testcase}: failed to write execution report`,
                  error,
                );
              }
            }
          }),
        ),
    ),
  );

  return testResults.sort((a, b) => a.testcase.localeCompare(b.testcase));
}

type RequestGraph = Record<string, RequestTraceInfo>;
type RequestTraceInfo = {
  operation: Omit<TracedResult, "ingress"> &
    Partial<Pick<TracedResult, "ingress">>;
  deps: number[];
};

export async function writeTestExecutionResult(
  report: string,
  testcase: string,
  errors: any[],
  init: Record<string, unknown>,
  env: Record<string, unknown>,
  flows: FlowReport[],
) {
  const { graph: requestGraph, list: requests } = graph();
  const testReportDir = join(report, testcase);

  await mkdir(testReportDir, {
    recursive: true,
  });

  console.info(`
${errors.length ? "FAIL" : "PASS"}: ${testcase}${errors.map((error) => `\n  - ERROR: ${error?.formatted ?? error?.message ?? error}`).join("")}
  - ${requests.length === 0 ? "" : `from: ${requests.map(fmtTraceId).reverse().join(", ")} `}see ${testReportDir}`);

  const logFilePromise = writeReportFile(
    testcase,
    testReportDir,
    errors,
    flows,
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
  egress: {
    redacted: { method, origin, pathname },
  },
  ingress,
  error,
}: TracedResult<unknown>) {
  if (ingress) {
    const {
      redacted: { status },
      outcome,
    } = ingress;
    return `${fmtTraceId(trace)} > ${method} ${origin}${pathname} ~ ${status}${outcome ? ` (${outcome})` : ""} +${request}ms`;
  }

  return `${fmtTraceId(trace)} > ${method} ${origin}${pathname} ~ ERR ${rootcause(error)} +${request}ms`;
}

function formatTracedStep({
  outcome: { name } = { name: "ok" },
  egress: {
    redacted: { method, origin, pathname },
  },
  ingress: {
    redacted: { status },
  },
}: FlowStepReport) {
  return `${method} ${origin}${pathname} ~ ${status}${name ? ` (${name})` : ""}`;
}

function rootcause(error?: any) {
  for (let i = 0; i < 10; i++) {
    if (!error.cause) {
      break;
    }
    error = error.cause;
  }

  return error;
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

  const request: Partial<RequestObject> = {
    ...operation.egress.redacted,
    values: operation.egress.reduced,
  };

  const ask: Partial<RequestObject> | undefined = operation.context.ask
    ? HTTP.parse(operation.context.ask)
    : undefined;

  if (ask) {
    request.values = mapObject(operation.egress.reduced, {
      filter(key) {
        return ask.values && key in ask.values;
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
${
  ask
    ? `${operation.context.ask!.trim()}

>>>`
    : ""
}
${HTTP.stringify(request).trim()}

<<<
${
  !operation.ingress
    ? `ERR ${rootcause(operation.error)}`
    : `${HTTP.responseObject.stringify(operation.ingress.redacted)}`
}`.trim(),
  );
}

function writeReportFile(
  testcase: string,
  testReportDir: string,
  errors: unknown[],
  flows: FlowReport[],
  init: Record<string, unknown>,
  env: Record<string, unknown>,
) {
  return writeFile(
    join(testReportDir, `requests.log`),
    [
      `# ${errors.length ? "FAIL" : "PASS"} - ${testcase}`,
      KV.stringify(init, { indent: 2 }),
      `---`,
      ...errors.flatMap((error) =>
        [...String((error as any)?.stack ?? error).split("\n"), ""]
          .filter((line) => line.trim())
          .map((line) => `# ${line}`),
      ),
      flows.length && `>>>>>`,
      ...flows.flatMap(({ type, name, values, result, error, steps }) => [
        `>>> ${name}.${type}`,
        `${KV.stringify(cleanObject(values), { indent: 2 })}`,
        ``,
        `${steps.map((step) => `# ${formatTracedStep(step)}`).join("\n")}`,
        `${
          result
            ? `  <<< ${result.outcome ?? "ok"}\n${resultKV(result, values)}\n`
            : `  <<< error: ${error}\n${String(error?.["stack"] ?? error)
                .split("\n")
                .map((s) => `  # ${s}`)
                .join(`\n`)}\n`
        }`,
      ]),
      flows.length && "<<<<<",
      KV.stringify(resultEnv(env, init) ?? {}, { indent: 2 }),
    ]
      .filter((line) => line != null && (line as unknown as number) !== 0)
      .join("\n"),
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

  const text = KV.stringify(output, { indent: 2 }).split("\n").join("\n  ");

  if (!text.trim()) return "";
  return `  ${text}`;
}

export async function executeTest(fn: () => Promise<void>, testcase: string) {
  const rejected: unknown[] = [];
  const awaited = tracking<Promise<unknown>>();
  const scheduled: Promise<unknown>[] = [];

  console.info("starting test -- " + testcase);

  return await inflight.run({ testcase, scheduled, awaited }, async () => {
    try {
      await Promise.resolve(shared(fn));
    } catch (error) {
      rejected.push(error);
    } finally {
      const completions: PromiseSettledResult<unknown>[] = [];

      let once = true;

      while (scheduled.length) {
        const resolved = awaited.awaited();
        const todo = scheduled
          .splice(0, scheduled.length)
          .filter((p) => !resolved.includes(p));

        if (once && todo.length) {
          console.warn("finalizing test -- " + testcase);
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

      rejected.push(...errors);

      console.info(`
-----
test complete -- ${testcase}: ${rejected.length ? `FAIL ${rejected.length} errors` : "PASS"}`);
    }

    return { errors: rejected, environment: { ...environment } };
  });
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

  const graph = arrayIntoObject([...operations], (operation) => ({
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

type TrialSelection = () => string | RegExp | (string | RegExp)[];

export type PardonTestConfiguration = {
  /** optional selection for trials to run */
  trials?: TrialSelection | string[];
  concurrency?: number;

  prefix?: string;
  /** initial environment configuration and alternation applying to all testcases */
  setup?(helpers: CaseHelpers): void;
  /**
   * final environment configuration and alternation applying to all testcases
   * (if a large data object is loaded in a loading phase, closing might be useful
   * to undefine that object here)
   */
  finish?(helpers: CaseHelpers): void;
  /**
   * a custom additional report function.
   */
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

function expandInitialCases(testenv: (readonly [string, unknown])[]) {
  return describeCases(({ set, each }) => {
    for (const [key, values] of Object.entries(
      testenv.reduce<Record<string, unknown[]>>(
        (map, [k, v]) => Object.assign(map, { [k]: [...(map[k] ?? []), v] }),
        {},
      ),
    )) {
      set(key, each(...values));
    }
  });
}

export async function loadTests({ testPath, concurrency }: TestLoadOptions) {
  const configuration = ((await withSurveyConfiguration(() => import(testPath)))
    .default ?? {}) as PardonTestConfiguration;

  if (concurrency !== undefined) {
    configuration.concurrency = concurrency;
  }

  const trialRegistry = await flushTrialRegistry(configuration);

  return {
    async testplanner(
      testenv: (readonly [string, unknown])[],
      smokeConfig?: SmokeConfig,
      ...filter: string[]
    ) {
      const alltestcases = await describeCases(
        configuration.finish || (() => {}),
        (
          await Promise.all(
            trialRegistry.flatMap(async ({ descriptions }) => {
              let cases: CaseContext[] = await expandInitialCases(testenv);

              for (const description of descriptions) {
                cases = await describeCases(description, cases);
              }

              return cases ?? [];
            }),
          )
        ).flat(1),
      );

      validateTestPlan(alltestcases);

      const cases = (
        await describeCases(
          (helpers) => applySmokeConfig(helpers, smokeConfig),
          alltestcases,
        )
      ).map(
        ({
          environment: {
            testcase,
            "::testexecution": testexecution,
            ...testenv
          },
        }) =>
          ({
            test: () => testexecution(testenv),
            testcase,
            testenv,
          }) as TestSetup,
      );

      const filtered = filter.length
        ? filter
        : await configureTrials(configuration);

      const patterns =
        filtered &&
        filtered
          .filter(
            (pattern) =>
              typeof pattern !== "string" || !pattern.startsWith("!"),
          )
          .map(globre);

      const antipatterns = (filtered ?? [])
        .filter((pattern) => typeof pattern === "string")
        .filter((pattern) => pattern.startsWith("!"))
        .map((pattern) => pattern.slice(1))
        .map(globre);

      return {
        cases,
        patterns,
        antipatterns,
      } satisfies TestPlanning;
    },
    configuration,
  };
}

export function filterTestPlanning({
  cases,
  patterns,
  antipatterns,
}: TestPlanning): TestSetup[] {
  return cases.filter(
    ({ testcase }) =>
      !patterns?.length ||
      (patterns.some((p) => p.test(testcase)) &&
        !antipatterns?.some((p) => p.test(testcase))),
  );
}

async function configureTrials({ trials }: PardonTestConfiguration) {
  if (typeof trials === "function") {
    return shared(async () => {
      let filtered = trials();

      if (typeof filtered === "string") {
        filtered = [filtered];
      }

      if (
        !Array.isArray(filtered) ||
        !filtered.every(
          (item) => typeof item === "string" || item instanceof RegExp,
        )
      ) {
        throw new PardonError(
          "test-runner: config.trials() did not return a list of filters",
        );
      }

      return filtered;
    });
  }

  return trials;
}

function globre(glob: string | RegExp) {
  if (glob instanceof RegExp) {
    return glob;
  }

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
