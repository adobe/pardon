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

import { argv } from "node:process";
import { randomUUID } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { existsSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import * as YAML from "yaml";
import { glob } from "glob";

import { PardonAppContextOptions, initializePardon } from "pardon/runtime";
import { arrayIntoObject, mapObject, mapObjectAsync } from "pardon/utils";
import { HTTP, HTTPS, PardonOptions, disconnected, pardon } from "pardon";
import { httpOps, valueOps } from "pardon/database";

import { traced } from "pardon/features/trace";
import remember, { PardonHttpExecutionContext } from "pardon/features/remember";
import { cleanObject, FetchObject, RequestJSON } from "pardon/formats";
import {
  CompiledHttpsSequence,
  executeTest,
  failfast,
  loadTests,
  notifyFastFailed,
  all_disconnected,
  registerSequenceNotificationHooks,
  initEnvironment,
  sequenceRegistry,
  type SmokeConfig,
  awaitedSequences,
  semaphore,
} from "pardon/running";

let nextTestRunId = Date.now();
type SequenceId = `${string}`;
type StepId = `${SequenceId}[${number}]`;
type TestRunId = `T${string}`;

const currentTestRun = new AsyncLocalStorage<TestRunId>();

const currentHttpSequence = new AsyncLocalStorage<{
  key: SequenceId;
  stepCount: number;
  sequence: CompiledHttpsSequence;
  values: Record<string, unknown>;
}>();

type TestSetup = ReturnType<
  Awaited<ReturnType<typeof loadTests>>["testplanner"]
>[number];

export type TestStepPayloads = {
  "test:run:start": {
    id: "test:event";
    type: "test:run:start";
    run: TestRunId;
    tests: Pick<TestSetup, "testcase" | "environment">[];
    input: string;
  };
  "test:case:start": {
    id: "test:event";
    type: "test:case:start";
    run: TestRunId;
    testcase: string;
    environment: Record<string, unknown>;
  };
  "test:case:complete": {
    id: "test:event";
    type: "test:case:complete";
    testcase: string;
    run: TestRunId;
    environment: Record<string, unknown>;
    errors: string[];
    awaited: ReturnType<typeof awaitedJsonSequences>;
  };
  "test:step:start": {
    id: "test:event";
    type: "test:step:start";
    sequence: string;
    step: StepId;
    info: {
      request: FetchObject;
      values: Record<string, unknown>;
    };
  };
  "test:step:end": {
    id: "test:event";
    type: "test:step:end";
    sequence: string;
    step: StepId;
    info: {
      trace: number;
      response: string;
      outcome?: string;
      result: Record<string, unknown>;
    };
  };
  "test:sequence:start": {
    id: "test:event";
    type: "test:sequence:start";
    run: TestRunId;
    key: string;
    name: string;
  };
  "test:sequence:complete": {
    id: "test:event";
    type: "test:sequence:complete";
    run: TestRunId;
    key: string;
    error?: unknown;
  };
};

registerSequenceNotificationHooks({
  onSequenceStepStart({ request, values }) {
    const store = currentHttpSequence.getStore()!;
    parentPort!.postMessage(
      nofun({
        id: "test:event",
        type: "test:step:start",
        step: `${store.key}[${store.stepCount}]`,
        sequence: store.key,
        info: {
          request: request.request,
          values,
        },
      }) satisfies TestStepPayloads["test:step:start"],
    );
  },
  onSequenceStepEnd({ trace, inbound: { redacted }, outcome, values: result }) {
    const store = currentHttpSequence.getStore()!;
    parentPort!.postMessage(
      nofun({
        id: "test:event",
        type: "test:step:end",
        step: `${store.key}[${store.stepCount++}]`,
        sequence: currentHttpSequence.getStore()!.key,
        info: {
          trace,
          response: HTTP.responseObject.stringify(redacted),
          outcome: outcome?.name,
          result,
        },
      }) satisfies TestStepPayloads["test:step:end"],
    );
  },
  runSequence({ sequence, values, key }, callback) {
    return () =>
      currentHttpSequence.run(
        {
          key,
          sequence,
          stepCount: 1,
          values: nofun(values),
        },
        async () => {
          try {
            parentPort!.postMessage(
              nofun({
                id: "test:event",
                type: "test:sequence:start",
                run: currentTestRun.getStore(),
                key,
                name: sequence.name,
              }) satisfies TestStepPayloads["test:sequence:start"],
            );

            const result = await callback();

            parentPort!.postMessage(
              nofun({
                id: "test:event",
                type: "test:sequence:complete",
                run: currentTestRun.getStore(),
                key,
              }) satisfies TestStepPayloads["test:sequence:complete"],
            );

            return result;
          } catch (error) {
            parentPort!.postMessage(
              nofun({
                id: "test:event",
                type: "test:sequence:complete",
                run: currentTestRun.getStore(),
                key,
                error: String(error),
              }) satisfies TestStepPayloads["test:sequence:complete"],
            );
            throw error;
          }
        },
      );
  },
});

const [cwd] = argv.slice(2);

const tracingHooks = {
  onRenderStart({ context: { trace, awaited, ask }, endpoint }) {
    const payload = {
      trace,
      context: { ask, endpoint },
      awaited: {
        requests: awaited.requests.map(({ context: { trace } }) => trace),
        results: awaited.results.map(({ context: { trace } }) => trace),
      },
    };

    return {
      id: "trace:rendering" as const,
      trace: nofun(payload),
    };
  },
  onRenderComplete({
    context: { trace, awaited, timestamps, durations },
    outbound: { request, redacted },
  }) {
    const payload = {
      trace,
      context: { timestamps, durations },
      awaited: {
        requests: awaited.requests.map(({ context: { trace } }) => trace),
        results: awaited.results.map(({ context: { trace } }) => trace),
      },
      outbound: {
        request: HTTP.requestObject.json(redacted),
      },
      secure: {
        outbound: {
          request: HTTP.requestObject.json(request),
        },
      },
    };

    return {
      id: "trace:rendered" as const,
      trace: nofun(payload as Optional<typeof payload, "secure">),
    };
  },
  onSend({ context: { trace, timestamps, durations } }) {
    const payload = {
      trace,
      context: { timestamps, durations },
      timestamps,
      durations,
    };

    return {
      id: "trace:sent" as const,
      trace: nofun(payload),
    };
  },
  onResult({
    context: { awaited, trace, timestamps, durations },
    inbound: { response, redacted, values, secrets, outcome },
  }) {
    const payload = {
      trace,
      context: { timestamps, durations },
      awaited: {
        requests: awaited.requests.map(({ context: { trace } }) => trace),
        results: awaited.results.map(({ context: { trace } }) => trace),
      },
      inbound: {
        response: HTTP.responseObject.json(redacted),
        outcome,
        values,
      },
      secure: {
        inbound: {
          response: HTTP.responseObject.json(response),
          values: secrets,
        },
      },
    };

    return {
      id: "trace:completed" as const,
      trace: nofun(payload as Optional<typeof payload, "secure">),
    };
  },
  onError(error, stage, trace) {
    return {
      id: "trace:error" as const,
      trace: { trace, stage, error: String(error) },
    };
  },
} as const satisfies Parameters<typeof traced>[0];

type AppContext = Awaited<ReturnType<typeof initializePardon>>;

async function initializePardonAndLoadSamples(
  options: PardonAppContextOptions,
) {
  const app = await initializePardon(options, [
    failfast,
    traced(
      mapObject(tracingHooks, (fn) => (...args) => {
        disconnected(() => {
          parentPort!.postMessage(nofun((fn as any)(...args)));
        });
      }) as typeof tracingHooks,
      Date.now(), // should make trace ids unique per run?
    ),
    remember,
  ]);

  const samples = loadSamples(app.samples || []);

  const testing = loadTestEngine(app);

  await initEnvironment({});

  return { app, samples, testing };
}

async function loadTestEngine(app: AppContext) {
  try {
    const testPath = join(app.config.root, "pardon.test.ts");
    if (!existsSync(testPath)) {
      console.warn(`${testPath}: no testconfig here`);
      return;
    }

    const testing = await loadTests(app, {
      testPath,
    });

    return {
      ...testing,
      sequences: await mapObjectAsync(sequenceRegistry(), (unitsOrFlows) =>
        mapObjectAsync(unitsOrFlows, async (path) => ({
          path,
          content:
            path !== "script" ? await readFile(path, "utf-8") : undefined,
        })),
      ),
    };
  } catch (error) {
    console.warn("failed to load testcases", error);
  }
}

async function loadSamples(samples: string[]) {
  return (
    await Promise.all(
      (
        await Promise.all(
          samples.map((cwd) =>
            glob(["**/*.http", "**/*.log.https"], { nodir: true, cwd }),
          ),
        )
      ).map((globbed, i) =>
        Promise.all(
          globbed.map(async (name) => ({
            name,
            path: resolve(samples[i], name),
            content: await readFile(resolve(samples[i], name), "utf-8"),
          })),
        ),
      ),
    )
  ).flat(1);
}

const ready = initializePardonAndLoadSamples({ cwd });

parentPort.on("message", async ({ id, action, args }) => {
  await ready;

  try {
    parentPort.postMessage(
      nofun({
        id,
        status: "fulfilled",
        value: await handling(action)(...args),
      }),
    );
  } catch (error) {
    parentPort.postMessage(
      nofun({
        id,
        status: "rejected",
        reason: String(error?.message ?? error),
      }),
    );
  }
});

function nofun<T>(value: T): T {
  switch (true) {
    case typeof value === "function":
      return undefined;
    case !value || typeof value !== "object":
      return value;
    case Array.isArray(value):
      return value.map(nofun) as T;
    default:
      return mapObject(value as any, nofun) as T;
  }
}

function handling<Action extends keyof typeof handlers>(
  action: Action,
): (typeof handlers)[Action] {
  return (async (...args: Parameters<(typeof handlers)[Action]>) => {
    try {
      return await (handlers[action] as any)(...args);
    } catch (error) {
      console.warn(`error:${action}: ${error}`);

      const stack = [];

      let theerror = error as any;
      while (theerror?.cause) {
        if ("stack" in theerror) {
          stack.push(
            "--- in ---",
            ...String(theerror.stack).split("\n").slice(0, 1),
          );
        }
        theerror = theerror.cause;
      }

      const rejection = Promise.reject(
        String((error as Error)?.stack ?? error) +
          (stack.length ? `\n${stack.join("\n")}` : ""),
      );

      rejection.catch(() => {});

      return rejection;
    }
  }) as (typeof handlers)[Action];
}

type PardonSelector = Parameters<typeof pardon>[1]["select"];

function makeSelector({ endpoint, service, ...options }: PardonWorkerOptions): {
  select: PardonSelector;
  options: PardonOptions;
} {
  return {
    options,
    select(matches) {
      if (matches.length <= 1) {
        // standard path
        return;
      }

      const selected = matches.filter((match) => {
        return (
          (!endpoint || match.endpoint.configuration.name === endpoint) &&
          (!service || match.endpoint.service === service)
        );
      });

      // TODO: signal to set service=... or endpoint=... to disambiguate ?
      if (selected.length === 1) {
        return selected[0];
      }
      // TODO: if multiple matches, signal out to get the collection to show all of them
    },
  };
}

function executeToRender(
  http: string,
  input: Record<string, unknown>,
  workerOptions: PardonWorkerOptions,
) {
  const { options, select } = makeSelector(workerOptions);

  return pardon(input, {
    options: { ...options, parsecurl: true },
    select,
  })`${http.trim() || [input.method ?? "GET", "//"].join(" ").trim()}`.render();
}

type PardonExecutionRender = {
  context: {
    trace: number;
    ask: string;
  };
  outbound: {
    request: RequestJSON;
  };
  secure: {
    outbound: {
      request: RequestJSON;
    };
  };
};

const ongoing: Record<
  string,
  {
    execution: ReturnType<typeof executeToRender>;
    render: PardonExecutionRender;
  }
> = {};

export type PardonWorkerHandlers = typeof handlers;

export type PardonWorkerOptions = PardonOptions & {
  endpoint?: string;
  service?: string;
};

const handlers = {
  async manifest() {
    const { app } = await ready;

    const endpoints = mapObject(
      app.collection.endpoints,
      ({ layers, ...endpoint }) => ({
        ...endpoint,
        paths: layers.map(({ path }) => path),
        // FIXME: improved intelligence on template request.
        archetype: archetype({ steps: layers[0].steps }),
        // FIXME: layers
        steps: layers[0].steps.map((interaction) => {
          if (interaction.type === "request") {
            return {
              ...interaction,
              request: {
                ...interaction.request,
                searchParams: String(interaction.request.searchParams),
                headers: [...interaction.request.headers],
              },
            };
          } else {
            return {
              ...interaction,
              headers: [...interaction.headers],
            };
          }
        }),
      }),
    );

    return {
      endpoints,
      assets: mapObject(app.collection.assets, ({ sources, ...info }) => ({
        ...info,
        sources: sources.map(({ content, path }) => ({
          content,
          path: path.replace(/[\\]/g, "/"),
        })),
      })),
      configurations: app.collection.configurations,
      collections: app.config.collections.map((root) =>
        root.replace(/[\\]/g, "/"),
      ),
      example: app.example,
      scripts: app.collection.scripts,
      data: app.collection.data,
      mixins: app.collection.mixins,
      errors: app.collection.errors,
    };
  },
  async testing() {
    const { testing } = await ready;
    return await testing;
  },
  async samples() {
    const { samples } = await ready;
    return await samples;
  },
  async testcases(
    environment: Record<string, unknown>,
    { smoke, filter }: { smoke?: SmokeConfig; filter?: string[] },
  ) {
    const { testing } = await ready;
    return (await testing)
      ?.testplanner(environment, smoke, ...(filter || []))
      ?.map(({ environment, testcase }) => ({ environment, testcase }));
  },
  async executeTestcases(
    testenv: Record<string, unknown>,
    input: string,
    testcases: string[],
    options: {
      concurrency?: string;
    } = {},
  ) {
    const testRun: TestRunId = `T${nextTestRunId++}`;
    const { testing } = await ready;
    const tests = (await testing)?.testplanner(
      testenv,
      undefined,
      ...testcases,
    );

    parentPort!.postMessage(
      nofun({
        id: "test:event",
        type: "test:run:start",
        run: testRun,
        tests: nofun(tests),
        input,
      }) satisfies TestStepPayloads["test:run:start"],
    );

    const concurrency =
      Math.max(Number(options.concurrency ?? "10"), 0) || Infinity;
    console.log(`running tests with concurrency=${concurrency}`);

    const concurrently = semaphore(concurrency);

    return currentTestRun.run(testRun, () =>
      all_disconnected(
        tests.map(
          async ({ environment: initEnv, test, testcase }) =>
            await concurrently(() =>
              disconnected(async () => {
                let errors: unknown[] = [];
                let emitEnv: Record<string, any>;
                try {
                  parentPort.postMessage(
                    nofun({
                      id: "test:event",
                      type: "test:case:start",
                      run: testRun,
                      testcase,
                      environment: initEnv,
                    }) satisfies TestStepPayloads["test:case:start"],
                  );

                  ({ errors, environment: emitEnv } = await executeTest(
                    test,
                    testcase,
                  ));

                  if (errors.length > 0) {
                    notifyFastFailed(errors[0] ?? new Error("undefined error"));
                  }

                  return { testcase, errors, environment: emitEnv };
                } catch (error) {
                  notifyFastFailed(error);
                  errors.push(error);
                  emitEnv = { ...environment };

                  return { testcase, errors, environment: emitEnv };
                } finally {
                  console.info("testcase complete: ", testcase, errors);

                  parentPort!.postMessage(
                    nofun({
                      id: "test:event",
                      type: "test:case:complete",
                      run: testRun,
                      testcase: testcase,
                      errors: errors.map(String),
                      environment: emitEnv,
                      awaited: awaitedJsonSequences(awaitedSequences()),
                    }) satisfies TestStepPayloads["test:case:complete"],
                  );
                }
              }),
            ),
        ),
      ),
    );
  },
  async resolvePath(path: string) {
    return new URL(path, `file://${cwd}/`).href;
  },
  async preview(
    http: string,
    input: Record<string, unknown>,
    workerOptions: PardonWorkerOptions,
  ) {
    const { options, select } = makeSelector(workerOptions);

    const rendering = pardon(input, {
      options: { ...options, parsecurl: true },
      select,
    })`${http.trim() || [input.method ?? "GET", "//"].join(" ").trim()}`.preview();

    const {
      endpoint: {
        configuration: { name: endpoint, type, path, ...configuration },
        action,
        service,
      },
    } = await rendering.match;
    const { redacted } = await rendering;

    return {
      service,
      action,
      endpoint,
      http: HTTP.stringify({ ...redacted }),
      configuration,
      yaml: YAML.stringify(cleanObject(configuration))?.trim(),
    };
  },
  async render(
    http: string,
    values: Record<string, unknown>,
    options?: PardonWorkerOptions,
  ) {
    const execution = executeToRender(http, values, options);
    execution.catch(() => {});

    const handle = randomUUID() as string;
    const { request, redacted } = await execution.outbound;

    const { trace, ask } =
      (await execution.context) as PardonHttpExecutionContext;

    const render: PardonExecutionRender = {
      context: {
        trace,
        ask,
      },
      outbound: {
        request: HTTP.requestObject.json(redacted),
      },
      secure: {
        outbound: {
          request: HTTP.requestObject.json(request),
        },
      },
    };

    ongoing[handle] = { render, execution };

    return { handle, ...render };
  },
  async dispose(handle: string) {
    delete ongoing[handle];
  },
  async continue(handle: string) {
    const {
      execution: flow,
      render: {
        context: { ask, trace },
      },
    } = ongoing[handle];

    const { endpoint, outbound, inbound } = await flow.result;

    return {
      context: { ask, trace },
      endpoint,
      outcome: inbound.outcome,
      outbound: {
        request: HTTP.requestObject.json(outbound.redacted),
      },
      inbound: {
        response: HTTP.responseObject.json(inbound.redacted),
        values: inbound.values,
      },
      secure: {
        outbound: {
          request: HTTP.requestObject.json(outbound.request),
        },
        inbound: {
          response: HTTP.responseObject.json(inbound.response),
          values: inbound.secrets,
        },
      },
    };
  },
  async archetype(httpsMaybe: string) {
    try {
      return archetype(HTTPS.parse(httpsMaybe)) ?? httpsMaybe;
    } catch (error) {
      void error;
      return httpsMaybe;
    }
  },
  async recall(keys: string[], other: Record<string, unknown>, limit: number) {
    const values = mapObject(other, {
      filter(_, mapped) {
        switch (typeof mapped) {
          case "string":
          case "number":
            return true;
          case "object":
            return mapped === null;
          default:
            return false;
        }
      },
      values: String,
    });

    const {
      app: { database },
    } = await ready;

    if (!database) {
      return [];
    }

    const { getRelatedValues, getValuesByHttp } = valueOps(database);
    const { getHttpEntity } = httpOps(database);

    const related = getRelatedValues(keys, values);
    return Object.entries(related)
      .sort(([attp], [bttp]) => Number(bttp) - Number(attp))
      .slice(0, limit)
      .map(([http, values]) => {
        const entity = getHttpEntity({ http });
        if (!entity) {
          return;
        }

        const { ask, req, res, created_at } = entity;

        return {
          http: Number(http),
          ask,
          req,
          res,
          values,
          inbound: arrayIntoObject(
            getValuesByHttp({ http }),
            ({ name, value, scope, type }) =>
              scope === "" && type === "res" && { [name]: value },
          ),
          created_at,
        };
      })
      .filter(Boolean);
  },
};

function archetype({ steps }: Partial<ReturnType<typeof HTTPS.parse>> = {}) {
  const request = steps?.find(({ type }) => type === "request") as any;

  if (request) {
    // TODO: render and include sample body here?
    const { method, url } = HTTP.requestObject.json(request.request);
    return `${method} ${url}`;
  }
}

export type TracingHookPayloads = {
  [Callback in keyof typeof tracingHooks]: ReturnType<
    (typeof tracingHooks)[Callback]
  >;
};

type AwaitedSequences = ReturnType<typeof awaitedSequences>;

function jsonExecutions(
  executions: AwaitedSequences[number]["executions"],
): ExecutionHistory[] {
  return executions.map(
    ({ context: { ask, trace }, inbound, outbound }) =>
      ({
        context: { trace, ask },
        outbound: {
          request: HTTP.requestObject.json(outbound.redacted),
        },
        inbound: {
          response: HTTP.responseObject.json(inbound.redacted),
          values: inbound.values,
        },
        secure: {
          outbound: {
            request: HTTP.requestObject.json(outbound.request),
          },
          inbound: {
            response: HTTP.responseObject.json(inbound.response),
            values: inbound.secrets,
          },
        },
      }) satisfies ExecutionHistory,
  );
}

export type AwaitedJsonSequences = (Omit<
  AwaitedSequences[number],
  "deps" | "executions"
> & {
  deps: AwaitedJsonSequences;
  executions: ExecutionHistory[];
})[];

const jsonSequenceMapping = new WeakMap<
  AwaitedSequences[number],
  AwaitedJsonSequences[number]
>();

function awaitedJsonSequences(
  sequences: AwaitedSequences,
): AwaitedJsonSequences {
  return sequences.map((dep) => {
    const { executions, deps, key, ...other } = dep;

    let inJsonForm = jsonSequenceMapping.get(dep);
    if (inJsonForm) {
      return inJsonForm;
    }

    jsonSequenceMapping.set(
      dep,
      (inJsonForm = {
        deps: awaitedJsonSequences(deps),
        executions: jsonExecutions(executions),
        // ensure every flow has a key for proper UI processing,
        // assume that the last trace id of the executions is unique
        key:
          key ??
          String(`K${dep.executions[dep.executions.length - 1].context.trace}`),
        ...other,
      }),
    );

    return inJsonForm;
  });
}
