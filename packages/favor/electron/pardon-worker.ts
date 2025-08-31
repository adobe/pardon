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

import {
  type AssetInfo,
  type PardonAppContextOptions,
  initializePardon,
} from "pardon/runtime";
import { arrayIntoObject, mapObject, recv, ship } from "pardon/utils";
import { type PardonOptions, HTTP, HTTPS, pardon } from "pardon";
import { httpOps, valueOps } from "pardon/database";

import { traced } from "pardon/features/trace";
import undici from "pardon/features/undici";
import encodings from "pardon/features/content-encodings";
import persist, {
  type PardonHttpExecutionContext,
} from "pardon/features/persist";
import {
  type HttpsRequestStep,
  type HttpsResponseStep,
  cleanObject,
} from "pardon/formats";
import { failfast, initTrackingEnvironment } from "pardon/running";

const [cwd] = argv.slice(2);

const tracingHooks = {
  onRenderStart({
    context: { trace, awaited, ask },
    endpoint: {
      configuration: { name: endpoint },
    },
  }) {
    const payload: TracingHookPayloads["onRenderStart"] = {
      trace,
      context: { ask, endpoint },
      awaited: {
        requests: awaited.requests.map(({ context: { trace } }) => trace),
      },
    };

    return {
      id: "trace:rendering" as const,
      trace: payload,
    };
  },
  onRenderComplete({
    context: { trace, awaited, timestamps, durations },
    egress: { request, redacted, reduced },
  }) {
    const payload: TracingHookPayloads["onRenderComplete"] = {
      trace,
      context: { timestamps, durations },
      awaited: {
        requests: awaited.requests.map(({ context: { trace } }) => trace),
        results: awaited.results.map(({ context: { trace } }) => trace),
      },
      egress: {
        request: HTTP.requestObject.json({ ...redacted, values: reduced }),
        values: redacted.values,
      },
      secure: {
        egress: {
          request: HTTP.requestObject.json({ ...request, values: {} }),
          values: request.values,
        },
      },
    };

    return {
      id: "trace:rendered" as const,
      trace: payload as Optional<typeof payload, "secure">,
    };
  },
  onSend({ context: { trace } }) {
    return {
      id: "trace:sent" as const,
      trace: {
        trace,
      } satisfies TracingHookPayloads["onSend"],
    };
  },
  onResult({
    context: { awaited, trace, timestamps, durations },
    ingress: { response, redacted, values, secrets, outcome },
    output,
  }) {
    const payload: TracingHookPayloads["onResult"] = {
      trace,
      context: { timestamps, durations },
      awaited: {
        requests: awaited.requests.map(({ context: { trace } }) => trace),
        results: awaited.results.map(({ context: { trace } }) => trace),
      },
      ingress: {
        response: HTTP.responseObject.json(redacted),
        outcome,
        values,
      },
      secure: {
        ingress: {
          response: HTTP.responseObject.json(response),
          values: secrets,
        },
      },
      output,
    };

    return {
      id: "trace:completed" as const,
      trace: payload as Optional<typeof payload, "secure">,
    };
  },
  onError({ error, trace }) {
    return {
      id: "trace:error" as const,
      trace: {
        trace,
        step: error.step,
        error: String(error?.formatted ?? error),
      } satisfies TracingHookPayloads["onError"],
    };
  },
} as const satisfies Parameters<typeof traced>[0];

async function initializePardonAndLoadSamples(
  options: PardonAppContextOptions,
) {
  const app = await initializePardon(options, [
    undici,
    encodings,
    failfast,
    traced(
      mapObject(tracingHooks, (fn) => (...args: any) => {
        parentPort!.postMessage(ship((fn as any)(...args)));
      }) as typeof tracingHooks,
      Date.now(), // should make trace ids unique per run?
    ),
    persist,
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
      reason: String(error?.formatted ?? error),
    });
  }
});

function handling<Action extends keyof typeof handlers>(
  action: Action,
): (typeof handlers)[Action] {
  return (async (...args: Parameters<(typeof handlers)[Action]>) => {
    try {
      return await (handlers[action] as any)(...args);
    } catch (exception) {
      const rejection = Promise.resolve({
        exception: String(
          exception?.formatted ?? exception?.stack ?? exception,
        ),
      });

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

function executeInit(
  http: string,
  input: Record<string, unknown>,
  workerOptions: PardonWorkerOptions,
) {
  const { options, select } = makeSelector(workerOptions);

  try {
    return pardon(input, {
      options: { ...options, parsecurl: true },
      select,
    })`${http.trim() || [input.method ?? "GET", "//"].join(" ").trim()}`.init();
  } catch (error) {
    throw error.message; //{ step: "sync", info: { input, options }, error };
  }
}

const ongoing: Record<
  string,
  {
    execution: ReturnType<typeof executeInit>;
    context: Awaited<ReturnType<typeof executeInit>["context"]>;
    render?: PardonExecutionRender;
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
            } as Omit<HttpsRequestStep, "request"> & {
              request: Omit<
                HttpsRequestStep["request"],
                "searchParams" | "headers"
              > & {
                searchParams: string;
                headers: [string, string][];
              };
            };
          } else {
            return {
              ...interaction,
              headers:
                interaction.type !== "script"
                  ? [...interaction.headers]
                  : undefined,
            } as Omit<HttpsResponseStep, "headers"> & {
              headers: [string, string][];
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
      })) as Record<string, AssetInfo>,
      configurations: app.collection.configurations,
      collections: app.config.collections.map((root) =>
        root.replace(/[\\]/g, "/"),
      ),
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
  async preview(handle: string) {
    const { execution } = ongoing[handle];

    const {
      endpoint: {
        configuration: { name: endpoint, type, path, ...configuration },
        action,
        service,
      },
    } = await execution.match;

    const { redacted, reduced } = await execution.preview;

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

  async context(
    http: string,
    values: Record<string, unknown>,
    options?: PardonWorkerOptions,
  ) {
    const execution = executeInit(http, values, options);
    execution.catch(() => {});

    const context = (await execution.context) as PardonHttpExecutionContext;

    const handle = randomUUID() as string;

    ongoing[handle] = { context, execution };

    return { handle, context };
  },

  async render(handle: string) {
    const { execution } = ongoing[handle];

    const { request, redacted, reduced } = await execution.egress;

    const { trace, ask, durations } =
      (await execution.context) as PardonHttpExecutionContext;

    const render: PardonExecutionRender & { http: string } = {
      context: {
        trace,
        ask,
        durations,
      },
      http: HTTP.stringify({ ...redacted, values: reduced }),
      egress: {
        request: HTTP.requestObject.json({ ...redacted, values: reduced }),
        values: redacted.values,
      },
      secure: {
        egress: {
          request: HTTP.requestObject.json(request),
          values: request.values,
        },
      },
    };

    ongoing[handle].render = render;

    return { handle, render };
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

    const { endpoint, egress, ingress } = await execution.result;

    const secure = {
      egress: {
        request: HTTP.requestObject.json(egress.request),
      },
      ingress: {
        response: HTTP.responseObject.json(ingress.response),
        values: ingress.secrets,
      },
    };

    const result = {
      context: { ask, trace, durations },
      endpoint,
      outcome: ingress.outcome,
      egress: {
        request: HTTP.requestObject.json({
          ...egress.redacted,
          values: egress.reduced,
        }),
      },
      ingress: {
        response: HTTP.responseObject.json(ingress.redacted),
        values: ingress.values,
      },
      secure,
    };

    return result as Omit<typeof result, "secure"> &
      Partial<Pick<typeof result, "secure">>;
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
      .map(([http, relations]) => {
        const entity = getHttpEntity({ http });
        if (!entity) {
          return;
        }

        const { ask, req, res, created_at } = entity;

        const values = arrayIntoObject(
          getValuesByHttp({ http }),
          ({ name, value, scope, type }) =>
            scope === "" && type === "res" && { [name]: value },
        );

        const output = arrayIntoObject(
          getValuesByHttp({ http }),
          ({ name, value, scope, type }) =>
            scope === "" && type.endsWith("+out") && { [name]: value },
        );

        return {
          http: Number(http),
          ask,
          req,
          res,
          values,
          output,
          relations,
          created_at,
        };
      })
      .filter(Boolean);
  },
  async debug() {
    const { default: inspector } = await import("node:inspector");

    inspector.open();
    inspector.waitForDebugger();

    // eslint-disable-next-line no-debugger
    debugger;
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
