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

import ValuesInput from "./ValuesInput.tsx";
import { createResource, createSignal, For, Show, Suspense } from "solid-js";
import { type ResponseJSON, HTTP, JSON, KV } from "pardon/formats";
import LoadingSplash from "./LoadingSplash.tsx";
import { makePersisted } from "@solid-primitives/storage";
import { RequestSummaryNode } from "./RequestSummaryTree.tsx";
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
  onRestore(history: ExecutionHistory): void;
  isCurrent(trace: number): boolean;
}) {
  const [values, setValues] = createSignal<Record<string, unknown>>();
  const [args, setArgs] = createSignal<string[]>();
  const [options, setOptions] = createSignal<{ limit: string }>();

  const [memory] = createResource(
    () => ({ values: values(), args: args(), options: options() }),
    async ({ values, args, options: { limit = "30" } = {} }) => {
      const limitn = Number(limit);
      const memory = recv(
        await window.pardon.recall(
          args,
          ship(values),
          isNaN(limitn) ? 30 : limitn,
        ),
      );

      return memory;
    },
  );

  return (
    <div class="flex w-0 flex-1 flex-col bg-zinc-100 p-1 dark:bg-slate-800">
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
      <Suspense fallback={<LoadingSplash />}>
        <div class="fade-to-clear flex flex-col overflow-auto pb-2 text-xs text-nowrap [--clear-start-opacity:0]">
          <For each={memory()}>
            {({
              http,
              req,
              res,
              ask,
              relations,
              values,
              output,
              created_at,
            }) => {
              const request = HTTP.parse(req);

              const sortedValues =
                Object.entries(relations).sort(numericKeySort);

              const selectedValues = sortedValues
                .slice(0, 3)
                .flatMap(([, keyvalue]) => Object.entries(keyvalue));

              const displayedValues = selectedValues.length
                ? selectedValues
                : Object.entries(output);

              console.log({ sortedValues, output });

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
                    relation={props.isCurrent(trace) ? "current" : undefined}
                    trace={{
                      trace,
                      tlr: true,
                      start: {
                        trace,
                        context: {
                          ask,
                          endpoint: "::recalled",
                        },
                        awaited: { requests: [] },
                      },
                      render: {
                        trace,
                        context: { durations, timestamps },
                        awaited: { requests: [], results: [] },
                        egress: {
                          request: HTTP.requestObject.json(request),
                          values: {},
                        },
                      },
                      result: {
                        trace,
                        context: { timestamps, durations },
                        awaited: { requests: [], results: [] },
                        ingress: {
                          response,
                          values,
                          outcome: undefined,
                        },
                        output,
                      },
                    }}
                    onRestore={props.onRestore}
                    note={
                      <span class="font-mono">
                        {formatTimestamp(created_at)}
                      </span>
                    }
                  >
                    <div class="pl-3">
                      <KeyValueCopier
                        readonly
                        noIcon
                        initialData={displayedValues}
                      />
                      <Show when={sortedValues.length > 3}>...</Show>
                    </div>
                  </RequestSummaryNode>
                </>
              );
            }}
          </For>
        </div>
      </Suspense>
    </div>
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
