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

import { createMemo, For, createContext, Show } from "solid-js";
import { RequestSummaryTree } from "./RequestSummaryTree.tsx";
import {
  type Trace,
  clearAllTraces,
  clearTrace,
  relatedTraces,
  requestHistory,
  traces,
} from "./request-history.ts";

export const RequestSummaryInfo = createContext<{
  egress(trace: Trace): void;
  ingress(trace: Trace): void;
}>();

export default function RequestHistory(props: {
  onRestore(history: ExecutionHistory): void;
  currentTrace: number;
}) {
  const tree = requestHistory();
  const related = relatedTraces(createMemo(() => props.currentTrace));

  const expandedSet = new Set<string>();

  const unsentTrace = createMemo(() => {
    return Object.values(traces()).every((trace) => !trace.sent);
  });

  const cutoff = 50;

  const historyLength = createMemo(() => tree().length);

  return (
    <div class="flex size-full flex-col bg-zinc-100 dark:bg-slate-800">
      <div class="fade-to-clear flex flex-1 flex-col overflow-auto [--clear-start-opacity:0]">
        <ul class="flex flex-initial flex-col px-0 py-2 text-xs text-nowrap">
          <For each={tree().slice(0, cutoff)}>
            {(trace) => (
              <RequestSummaryTree
                traces={traces()}
                related={related()}
                trace={trace}
                onRestore={props.onRestore}
                expandedSet={expandedSet}
                clearTrace={clearTrace}
              />
            )}
          </For>
          <Show when={historyLength() > cutoff}>
            <li class="pl-5 font-mono">
              . . . and {historyLength() - cutoff} more request
              {historyLength() - cutoff > 1 ? "s" : ""} hidden . . .
            </li>
          </Show>
        </ul>
      </div>
      <div
        class="pointer-events-none absolute inset-x-0 bottom-1 flex place-content-center opacity-100 transition-opacity duration-700"
        classList={{
          "!opacity-0": tree().length === 0,
        }}
      >
        <button
          class="p-1 transition-colors duration-300 hover:bg-fuchsia-300 disabled:!bg-neutral-200 dark:hover:bg-pink-500 dark:disabled:!bg-neutral-600"
          classList={{
            "pointer-events-auto": tree().length > 0,
          }}
          onClick={() => clearAllTraces()}
          disabled={unsentTrace()}
        >
          <IconTablerTrash />
        </button>
      </div>
    </div>
  );
}
