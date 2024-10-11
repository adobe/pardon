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

import { makePersisted } from "@solid-primitives/storage";
import {
  Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
} from "solid-js";
import { ExecutionOutboundResult } from "../signals/pardon-execution.ts";
import { HistoryTree } from "./RequestSummaryTree.tsx";
import { mapObject } from "pardon/utils";
import { persistJson } from "../util/persistence.ts";

export type Trace = {
  trace: number;
  tlr?: true;
  sent?: true;
  start: TracingHookPayloads["onRenderStart"]["trace"];
  render?: TracingHookPayloads["onRenderComplete"]["trace"];
  error?: TracingHookPayloads["onError"]["trace"];
  result?: TracingHookPayloads["onResult"]["trace"];
};

const [history, setHistory] = makePersisted(
  createSignal<{
    traces: Record<number, Trace>;
  }>({ traces: {} }),
  {
    name: "history",
    ...persistJson,
  },
);

export function clearAllTraces() {
  setHistory(({ traces }) => ({
    traces: mapObject(traces, {
      filter(_, value) {
        return value.render && value.start && !value.sent;
      },
    }),
  }));
}

export function clearTrace(trace: number) {
  setHistory(({ traces: { [trace]: _, ...traces } }) => ({ traces }));
}

export const { traces } = createRoot(() => {
  createEffect(() => {
    window.pardon.registerHistoryForwarder({
      onRenderStart(trace, start) {
        setHistory(({ traces }) => ({
          traces: { ...traces, [trace]: { trace, start } },
        }));
      },
      onRenderComplete(trace, { secure: _, ...render }) {
        setHistory(({ traces }) => ({
          traces: { ...traces, [trace]: { ...traces[trace], render } },
        }));
      },
      onSend(trace) {
        setHistory(({ traces }) => ({
          traces: { ...traces, [trace]: { ...traces[trace], sent: true } },
        }));
      },
      onResult(trace, { secure: _, ...result }) {
        setHistory(({ traces }) => ({
          traces: { ...traces, [trace]: { ...traces[trace], result } },
        }));
      },
      onError(trace, error) {
        setHistory(({ traces }) => ({
          traces: { ...traces, [trace]: { ...traces[trace], error } },
        }));
      },
    });
  });

  const traces = createMemo(() => history()?.traces ?? {});

  return { traces };
});

const [activeTrace, updateActiveTrace] = createSignal<number>();
export { activeTrace };

export function traceCurrentRequest(
  currentRequest: Accessor<ExecutionOutboundResult & { type: "request" }>,
) {
  createEffect(
    on(
      currentRequest,
      (request) => {
        const trace = request?.context.trace;

        updateActiveTrace((previous) => {
          setHistory((prev) => {
            const { traces = {} } = prev || {};

            if (
              typeof previous !== "undefined" &&
              traces[previous] &&
              !traces[previous].sent
            ) {
              return {
                traces: {
                  ...traces,
                  [previous]: { ...traces[previous] },
                },
              };
            }

            return { traces };
          });

          return trace;
        });

        if (typeof trace !== "undefined") {
          setHistory(({ traces }) => ({
            traces: { ...traces, [trace]: { ...traces[trace], tlr: true } },
          }));
        }
      },
      { defer: true },
    ),
  );
}

export function requestHistoryForest(list: number[]) {
  const toplevel = list.filter((id) => traces()[id].tlr && traces()[id].render);
  const seen = new Set<number>();
  function visit(
    trace: number,
    perRequest: Set<number> = new Set(),
  ): HistoryTree {
    if (perRequest.has(trace)) {
      return;
    }
    perRequest.add(trace);
    seen.add(trace);
    return {
      trace,
      deps: [...(traces()[trace]?.render?.awaited.results || [])]
        .reverse()
        .filter((trace) => traces()[trace])
        .map((trace) => visit(trace, perRequest))
        .filter(Boolean),
    };
  }

  const known = toplevel.map((trace) => visit(trace));

  const sharedPerRequest = new Set<number>();
  const unknown = list
    .map(
      (trace) =>
        !seen.has(trace) &&
        !sharedPerRequest.has(trace) &&
        visit(trace, sharedPerRequest),
    )
    .filter(Boolean);

  return [...known, ...unknown].sort(({ trace: a }, { trace: b }) => b - a);
}

export function requestHistory(currentRequest: Accessor<number>) {
  return createMemo(() => {
    const list = Object.entries(traces())
      .filter(
        ([key, { trace, error, render, sent, tlr }]) =>
          trace == Number(key) &&
          !error &&
          (tlr || render) &&
          (currentRequest() === trace || sent),
      )
      .map(([, { trace }]) => trace)
      .sort((a, b) => b - a);

    return requestHistoryForest(list);
  });
}
