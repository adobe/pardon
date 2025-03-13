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

import Resizable from "corvu/resizable";
import ValuesInput from "./ValuesInput.tsx";
import {
  createMemo,
  createResource,
  createSignal,
  For,
  Suspense,
} from "solid-js";
import { HTTP, JSON, KV, ResponseJSON } from "pardon/formats";
import LoadingSplash from "./LoadingSplash.tsx";
import { makePersisted } from "@solid-primitives/storage";
import { RequestSummaryNode } from "./RequestSummaryTree.tsx";
import { RequestSummaryInfoDrawerWrapper } from "./RequestHistory.tsx";
import KeyValueCopier from "./KeyValueCopier.tsx";
import { numericKeySort } from "../util/numeric-sort.ts";
import { arrayIntoObject, mapObject, recv, ship } from "pardon/utils";
import { persistJson } from "../util/persistence.ts";

const [prompt, setPrompt] = makePersisted(createSignal(""), {
  name: "recall:prompt",
  ...persistJson,
});

const recallArgConfig = {
  options: {
    limit: {
      type: "string",
    },
  },
} as const;

function qt(s: string) {
  if (/[$\s'"]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export default function RecallSystem(props: {
  onRestore: (history: ExecutionHistory) => void;
  isCurrent: (trace: number) => boolean;
}) {
  const [values, setValues] = createSignal<Record<string, unknown>>();
  const [args, setArgs] = createSignal<string[]>();
  const [options, setOptions] = createSignal<{ limit: string }>();

  const [memory] = createResource(
    () => ({ values: values(), args: args(), options: options() }),
    async ({ values, args, options: { limit = "30" } = {} }) => {
      const limitn = Number(limit);
      return recv(
        await window.pardon.recall(
          args,
          ship(values),
          isNaN(limitn) ? 30 : limitn,
        ),
      ); // TODO: pagination
    },
  );
  return (
    <Resizable>
      <Resizable.Panel class="flex flex-1 flex-col gap-1 p-1">
        <ValuesInput
          class="min-h-8 flex-initial rounded-md bg-purple-200 dark:bg-black"
          value={prompt()}
          onValueChange={setPrompt}
          config={{ ...recallArgConfig, strict: true }}
          onDataChange={({ values, positionals, options }) => {
            setValues(values);
            setArgs(positionals);
            setOptions(options);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("text/value")) {
              event.preventDefault();
            }
          }}
          onDrop={(event) => {
            const value = event.dataTransfer.getData("text/value");
            if (value) {
              const dropped = mapObject(KV.parse(value, "object"), {
                filter: (_, v) =>
                  ["string", "number", "boolean"].includes(typeof v),
              });

              if (dropped.endpoint && !values().method) {
                delete dropped.method;
              }

              setPrompt(() => {
                return [
                  ...Object.entries({ ...values(), ...dropped }).map(
                    ([k, v]) => `${qt(k)}=${qt(String(v))}`,
                  ),
                  options().limit !== undefined &&
                    `--limit=${qt(options().limit as string)}`,
                ]
                  .filter(Boolean)
                  .join(" ");
              });
            }
          }}
        ></ValuesInput>
        <RequestSummaryInfoDrawerWrapper>
          <Suspense fallback={<LoadingSplash />}>
            <div class="flex-1 overflow-y-scroll text-nowrap text-xs">
              <For each={memory()}>
                {({ http, req, res, ask, values, inbound, created_at }) => {
                  const request = HTTP.parse(req);

                  const sortedValues =
                    Object.entries(values).sort(numericKeySort);
                  const shownValues = createMemo(() => {
                    return sortedValues.slice(0, 1);
                  });

                  const trace = -http;
                  const durations = {};
                  const timestamps = {};
                  let response: ResponseJSON;
                  try {
                    response = HTTP.responseObject.json(
                      HTTP.responseObject.parse(res),
                    );
                  } catch (error) {
                    console.warn("unparsable response", res, error);
                  }

                  return (
                    <>
                      <RequestSummaryNode
                        expandedSet={new Set()}
                        exapandable={sortedValues.length > 1}
                        current={props.isCurrent(trace)}
                        path={[-1]}
                        trace={{
                          trace,
                          start: {
                            trace,
                            context: {
                              ask,
                              endpoint: {
                                action: "",
                                configuration: {
                                  name: "",
                                  path: "",
                                  config: [],
                                },
                                layers: [],
                                service: "",
                              },
                            },
                            awaited: { requests: [], results: [] },
                          },
                          render: {
                            trace,
                            context: { durations, timestamps },
                            awaited: { requests: [], results: [] },
                            outbound: {
                              request: HTTP.requestObject.json(request),
                            },
                          },
                          result: {
                            trace,
                            context: { timestamps, durations },
                            awaited: { requests: [], results: [] },
                            inbound: {
                              response,
                              values: inbound,
                              outcome: undefined,
                            },
                          },
                        }}
                        onRestore={props.onRestore}
                        fallback={
                          <>
                            <For each={shownValues()}>
                              {([scope, data]) => (
                                <>
                                  {scope ? (
                                    <span class="block -skew-x-12 pt-1 text-xs">
                                      {scope}
                                    </span>
                                  ) : (
                                    <></>
                                  )}
                                  <KeyValueCopier
                                    data={data}
                                    classList={{
                                      "ml-2": Boolean(scope),
                                    }}
                                  />
                                </>
                              )}
                            </For>
                            {sortedValues.length > 1 ? <>...</> : <></>}
                          </>
                        }
                        note={
                          <span class="font-mono">
                            {formatTimestamp(created_at)}
                          </span>
                        }
                      >
                        <For each={sortedValues}>
                          {([scope, data]) => (
                            <>
                              {scope ? (
                                <span class="block -skew-x-12 pt-1 text-xs">
                                  {scope}
                                </span>
                              ) : (
                                <></>
                              )}
                              <KeyValueCopier
                                data={data}
                                classList={{
                                  "ml-2": Boolean(scope),
                                }}
                              />
                            </>
                          )}
                        </For>
                      </RequestSummaryNode>
                    </>
                  );
                }}
              </For>
            </div>
          </Suspense>
        </RequestSummaryInfoDrawerWrapper>
      </Resizable.Panel>
    </Resizable>
  );
}

const tsf = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  second: "2-digit",
  minute: "2-digit",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZoneName: "short",
});

function formatTimestamp(timestamp: string) {
  const { year, month, day, hour, minute, second, timeZoneName } =
    arrayIntoObject(
      tsf.formatToParts(new Date(`${timestamp}Z`)),
      ({ type, value }) => ({
        [type]: value,
      }),
    ) as Record<keyof Intl.DateTimeFormatPartTypesRegistry, string>;

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timeZoneName}`;
}
