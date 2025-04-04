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

import { makePersisted } from "@solid-primitives/storage";
import {
  Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
} from "solid-js";
import { persistJson } from "../util/persistence.ts";
import localforage from "localforage";
import { setSecureData } from "./secure-data.ts";

export type Trace = {
  trace: number;
  tlr?: boolean; // top-level-request
  sent?: number;
  cancelled?: true;
  start: TracingHookPayloads["onRenderStart"];
  render?: TracingHookPayloads["onRenderComplete"];
  error?: TracingHookPayloads["onError"];
  result?: TracingHookPayloads["onResult"];
};

const [, setHistory, initHistory] = makePersisted(
  createSignal<{
    traces: Record<number, Trace>;
  }>({ traces: {} }),
  {
    name: "history",
    storage: localforage,
    ...persistJson,
  },
);

export const [traces, setTraces] = createSignal<Record<number, Trace>>({});
export const [activeTrace, updateActiveTrace] = createSignal<number>();

Promise.resolve(initHistory).then((historyJson) => {
  const history = historyJson ? JSON.parse(historyJson) : { traces: {} };

  setTraces({ ...history.traces, ...traces });
});

// create global effects inside a createRoot to avoid a warning.
createRoot(() => {
  createEffect(() => {
    window.pardon.registerHistoryForwarder({
      onRenderStart(trace, start) {
        setTraces((traces) => {
          const thisTrace = traces?.[trace];

          return {
            ...traces,
            [trace]: {
              ...thisTrace,
              trace,
              start,
              tlr: thisTrace?.tlr || Number(activeTrace()) == Number(trace),
            },
          };
        });
      },
      onRenderComplete(trace, { secure, ...render }) {
        setSecureData((data) => ({
          ...data,
          [trace]: { ...data[trace], ...secure },
        }));

        setTraces((traces) => {
          const thisTrace = traces[trace];
          return {
            ...traces,
            [trace]: {
              ...thisTrace,
              render,
              tlr: thisTrace?.tlr || Number(activeTrace()) == Number(trace),
            },
          };
        });
      },
      onSend(trace) {
        setTraces((traces) => ({
          ...traces,
          [trace]: { ...traces[trace], sent: Date.now() },
        }));
      },
      onResult(trace, { secure, ...result }) {
        setSecureData((data) => ({
          ...data,
          [trace]: { ...data[trace], ...secure },
        }));

        setTraces((traces) => {
          const combinedTraces = {
            ...traces,
            [trace]: { ...traces[trace], result },
          };

          setHistory(() => ({
            traces: combinedTraces,
          }));

          return combinedTraces;
        });
      },
      onError(trace, { error }) {
        setTraces(({ [trace]: record, ...traces }) => {
          if (record?.render) {
            const combinedTraces = {
              ...traces,
              [trace]: { ...record, error },
            };

            setHistory(() => ({
              traces: combinedTraces,
            }));

            return combinedTraces;
          }

          return traces;
        });
      },
    });
  });

  createEffect((previousTraceId: number) => {
    const currentTraceId = activeTrace();
    const currentTrace = traces()?.[currentTraceId];
    if (!currentTrace?.render) {
      return previousTraceId;
    }

    if (
      currentTraceId !== previousTraceId &&
      traces()?.[previousTraceId]?.cancelled
    ) {
      setTraces(({ [previousTraceId]: previous, ...traces }) => traces);

      return currentTraceId;
    }

    return currentTraceId;
  });
});

export function clearAllTraces() {
  setTraces({});

  setHistory({
    traces: {},
  });
}

export function clearTrace(trace: number) {
  setTraces(({ [trace]: _, ...traces }) => {
    return traces;
  });

  setHistory(({ traces: { [trace]: _, ...traces } }) => {
    return { traces };
  });
}

export function cancelTrace(trace: number) {
  setTraces(({ [trace]: cancelled, ...traces }) => {
    if (trace !== activeTrace()) {
      return {
        traces,
      };
    }

    return {
      ...traces,
      [trace]: {
        ...cancelled,
        cancelled: true,
      },
    };
  });
}

export function requestHistory() {
  return createMemo(() =>
    Object.values(traces())
      .filter(
        ({ start, render, sent, tlr, cancelled }) =>
          !cancelled && (tlr || start || render) && sent,
      )
      .sort(({ sent: a }, { sent: b }) => b - a)
      .map(({ trace }) => Number(trace)),
  );
}

export type RelatedTraces = {
  current: number;
  direct: number[];
  indirect: number[];
};

export function relatedTraces(
  currentTrace: Accessor<number>,
): Accessor<RelatedTraces> {
  return createMemo(
    on([traces, currentTrace], ([traces, current]) => {
      const direct = (traces[current]?.render?.awaited.results ?? []).filter(
        (dep, _, results) =>
          !results.some((t) =>
            traces[t]?.render?.awaited.results.includes(dep),
          ),
      );
      const indirect = [];
      const seen = new Set();

      visit(current);

      function visit(dep: number) {
        if (seen.has(dep)) {
          return;
        }

        seen.add(dep);

        if (dep !== current && !direct.includes(dep)) {
          indirect.push(dep);
        }

        for (const trace of traces[dep]?.render?.awaited.results ?? []) {
          visit(trace);
        }
      }

      return { current, direct, indirect };
    }),
  );
}
