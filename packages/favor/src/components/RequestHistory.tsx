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

import {
  createMemo,
  createSignal,
  For,
  JSX,
  createContext,
  Show,
} from "solid-js";
import { TbTrash } from "solid-icons/tb";
import { executionResource } from "../signals/pardon-execution.ts";
import { RequestSummaryTree } from "./RequestSummaryTree.tsx";
import { InfoDrawer } from "./InfoDrawer.tsx";
import KeyValueCopier from "./KeyValueCopier.tsx";
import {
  activeTrace,
  clearAllTraces,
  clearTrace,
  requestHistory,
  Trace,
  traceCurrentRequest,
  traces,
} from "./request-history.ts";
import { HTTP } from "pardon/formats";
import CodeMirror from "./codemirror/CodeMirror.tsx";

export const RequestSummaryInfo = createContext<{
  outbound(trace: Trace): void;
  inbound(trace: Trace): void;
}>();

export function RequestSummaryInfoDrawerWrapper(props: {
  children: JSX.Element;
  faded?: boolean;
}) {
  const [displayedHttp, setDisplayedHttp] = createSignal<string>();

  const [displayedValues, setDisplayedValues] =
    createSignal<Record<string, unknown>>();

  return (
    <InfoDrawer
      class="bg-lime-200 dark:bg-lime-800"
      content={
        <div class="flex max-h-[calc(100dvh-50px)] min-w-full flex-1 flex-col">
          <CodeMirror
            readonly
            data-corvu-no-drag
            value={displayedHttp()}
            nowrap
            class="mr-8 max-h-96 max-w-full select-auto overflow-auto bg-lime-400 dark:bg-lime-900"
            text="12px"
          />
          <div class="mt-2 flex w-full flex-1 overflow-hidden">
            <KeyValueCopier data={displayedValues() ?? {}} />
          </div>
        </div>
      }
    >
      {(drawerProps) => {
        return (
          <RequestSummaryInfo.Provider
            value={{
              inbound(trace) {
                setDisplayedHttp(
                  HTTP.responseObject.stringify(
                    HTTP.responseObject.fromJSON(
                      trace.result?.inbound.response,
                    ),
                  ),
                );
                setDisplayedValues(trace.result?.inbound.values);
                drawerProps.setOpen(true);
              },
              outbound(trace) {
                setDisplayedHttp(
                  HTTP.stringify({
                    ...HTTP.requestObject.fromJSON(
                      trace.render?.outbound.request,
                    ),
                    values: {},
                  }),
                );
                setDisplayedValues({
                  ...trace.render?.outbound.request.values,
                  origin: undefined,
                  method: undefined,
                  pathname: undefined,
                });
                drawerProps.setOpen(true);
              },
            }}
          >
            <div
              class="flex flex-1 flex-col overflow-auto"
              classList={{
                "fade-to-clear": props.faded,
              }}
            >
              <ul class="flex flex-initial flex-col text-nowrap px-0 py-2 text-xs">
                {props.children}
              </ul>
            </div>
          </RequestSummaryInfo.Provider>
        );
      }}
    </InfoDrawer>
  );
}

export default function RequestHistory(props: {
  render: ReturnType<ReturnType<typeof executionResource>["outbound"]>;
  onRestore: (history: ExecutionHistory) => void;
  isCurrent(trace: number): boolean;
}) {
  const currentRequest = createMemo(() => {
    if (props.render?.status !== "fulfilled") {
      return;
    }

    const request = props.render?.value;
    if (
      request.type !== "history" &&
      typeof request?.context.trace !== "undefined"
    ) {
      return request;
    }
  });

  traceCurrentRequest(currentRequest);

  const tree = requestHistory(activeTrace);

  const expandedSet = new Set<string>();

  const unsentTrace = createMemo(() => {
    return Object.values(traces()).every((trace) => !trace.sent);
  });

  const cutoff = 50;

  const historyLength = createMemo(() => tree().length);

  return (
    <div class="flex size-full flex-col bg-slate-200 dark:bg-slate-800">
      <RequestSummaryInfoDrawerWrapper faded>
        <For each={tree().slice(0, cutoff)}>
          {({ trace, deps }) => (
            <RequestSummaryTree
              traces={traces()}
              isCurrent={props.isCurrent}
              trace={trace}
              deps={deps}
              onRestore={props.onRestore}
              expandedSet={expandedSet}
              clearTrace={clearTrace}
            />
          )}
        </For>
        <Show when={historyLength() > cutoff}>
          <span class="flex-1 place-self-start px-2 font-mono">
            . . . and {historyLength() - cutoff} more request
            {historyLength() - cutoff > 1 ? "s" : ""} hidden . . .
          </span>
        </Show>
      </RequestSummaryInfoDrawerWrapper>
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
          <TbTrash />
        </button>
      </div>
    </div>
  );
}
