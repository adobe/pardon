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

import { argv } from "node:process";
import { randomUUID } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as YAML from "yaml";
import { glob } from "glob";

import { PardonAppContextOptions, initializePardon } from "pardon/runtime";
import { arrayIntoObject, mapObject, recv, ship } from "pardon/utils";
import {
  Flow,
  FlowName,
  HTTP,
  HTTPS,
  PardonOptions,
  disconnected,
  executeFlowInContext,
  pardon,
} from "pardon";
import { httpOps, valueOps } from "pardon/database";

import { traced } from "pardon/features/trace";
import undici from "pardon/features/undici";
import remember, { PardonHttpExecutionContext } from "pardon/features/remember";
import { cleanObject, HttpsRequestStep, RequestJSON } from "pardon/formats";
import {
  CompiledHttpsSequence,
  failfast,
  initTrackingEnvironment,
} from "pardon/running";

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
      trace: payload,
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
      trace: payload as Optional<typeof payload, "secure">,
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
      trace: payload,
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
      trace: payload as Optional<typeof payload, "secure">,
    };
  },
  onError(error, stage, trace) {
    return {
      id: "trace:error" as const,
      trace: { trace, stage, error: String(error) },
    };
  },
} as const satisfies Parameters<typeof traced>[0];

async function initializePardonAndLoadSamples(
  options: PardonAppContextOptions,
) {
  const app = await initializePardon(options, [
    undici,
    failfast,
    traced(
      mapObject(tracingHooks, (fn) => (...args) => {
        disconnected(() => {
          parentPort!.postMessage(ship((fn as any)(...args)));
        });
      }) as typeof tracingHooks,
      Date.now(), // should make trace ids unique per run?
    ),
    remember,
  ]);

  const samples = loadSamples(app.samples || []);

  await initTrackingEnvironment();

  return { app, samples };
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
      ship({
        id,
        status: "fulfilled",
        value: await handling(action)(...recv(args)),
      }),
    );
  } catch (error) {
    parentPort.postMessage({
      id,
      status: "rejected",
      reason: String(error?.message ?? error),
    });
  }
});

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
    durations: PardonHttpExecutionContext["durations"];
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

function isFlowSequenceSource(
  flow?: Flow["source"],
): flow is CompiledHttpsSequence {
  return flow?.["interactions"];
}

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
      flows: mapObject(app.collection.flows ?? {}, ({ signature, source }) => ({
        signature,
        interactions: isFlowSequenceSource(source) && source.interactions,
      })),
      example: app.example,
      data: app.collection.data,
      mixins: app.collection.mixins,
      errors: app.collection.errors,
    };
  },
  async samples() {
    const { samples } = await ready;
    return await samples;
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

    const preview = pardon(input, {
      options: { ...options, parsecurl: true },
      select,
    })`${http.trim() || [input.method ?? "GET", "//"].join(" ").trim()}`.preview();

    const {
      endpoint: {
        configuration: { name: endpoint, type, path, ...configuration },
        action,
        service,
      },
    } = await preview.match;

    const { redacted, reduced } = await preview;

    return {
      service,
      action,
      endpoint,
      values: redacted.values,
      http: HTTP.stringify({ ...redacted, values: reduced }),
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
    const { request, redacted, reduced } = await execution.outbound;

    const { trace, ask, durations } =
      (await execution.context) as PardonHttpExecutionContext;

    const render: PardonExecutionRender = {
      context: {
        trace,
        ask,
        durations,
      },
      outbound: {
        request: HTTP.requestObject.json({ ...redacted, values: reduced }),
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
      execution,
      render: {
        context: { ask, trace, durations },
      },
    } = ongoing[handle];

    const { endpoint, outbound, inbound } = await execution.result;

    const secure = {
      outbound: {
        request: HTTP.requestObject.json(outbound.request),
      },
      inbound: {
        response: HTTP.responseObject.json(inbound.response),
        values: inbound.secrets,
      },
    };

    return {
      context: { ask, trace, durations },
      endpoint,
      outcome: inbound.outcome,
      outbound: {
        request: HTTP.requestObject.json({
          ...outbound.redacted,
          values: outbound.reduced,
        }),
      },
      inbound: {
        response: HTTP.responseObject.json(inbound.redacted),
        values: inbound.values,
      },
      secure: secure as typeof secure | undefined,
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
  async flow(name: FlowName, input: Record<string, unknown>) {
    const runtime = await ready;
    const context = runtime.app.createFlowContext();
    return {
      ...(await executeFlowInContext(name, input, context)).context.environment,
    };
  },
};

function archetype({ steps }: Partial<ReturnType<typeof HTTPS.parse>> = {}) {
  const request = steps?.find(
    ({ type }) => type === "request",
  ) as HttpsRequestStep;
  if (request) {
    // TODO: render and include sample body here?
    const { method, url } = HTTP.requestObject.json(request.request);
    return `${method} ${url}`;
  }
}
