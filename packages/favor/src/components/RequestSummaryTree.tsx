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
  ComponentProps,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
  splitProps,
  useContext,
  JSX,
} from "solid-js";
import {
  TbChartArrows,
  TbChevronRight,
  TbCopy,
  TbPencil,
  TbTrash,
} from "solid-icons/tb";
import { twMerge } from "tailwind-merge";
import Toggle from "./Toggle.tsx";
import HttpMethodIcon from "./HttpMethodIcon.tsx";
import LoadingSplash from "./LoadingSplash.tsx";
import { Trace } from "./request-history.ts";
import { displayHttp } from "./display-util.ts";
import { RequestSummaryInfo } from "./RequestHistory.tsx";
import { HTTP } from "pardon/formats";
import { recv } from "../util/persistence.ts";

export type HistoryTree = { trace: number; deps: HistoryTree[] };

export function RequestSummaryTree(props: {
  traces: Record<number, Trace>;
  trace: number;
  isCurrent: (trace: number) => boolean;
  deps: HistoryTree[];
  onRestore: (history: ExecutionHistory) => void;
  path?: number[];
  expandedSet: Set<string>;
  clearTrace?: (trace: number) => void;
}) {
  const path = createMemo(() => [...(props.path ?? []), props.trace]);
  return (
    <RequestSummaryNode
      {...props}
      path={path()}
      trace={recv(props.traces[props.trace])}
      current={props.isCurrent(props.trace)}
      exapandable={props.deps.length > 0}
    >
      <For each={props.deps}>
        {({ trace, deps }) => (
          <RequestSummaryTree
            traces={props.traces}
            trace={trace}
            isCurrent={props.isCurrent}
            deps={deps}
            path={path()}
            expandedSet={props.expandedSet}
            onRestore={props.onRestore}
            clearTrace={props.clearTrace}
          />
        )}
      </For>
    </RequestSummaryNode>
  );
}

export function RequestSummaryNode(props: {
  trace: Trace;
  current?: boolean;
  onRestore(history: ExecutionHistory): void;
  clearTrace?(trace: number): void;
  path: number[];
  expandedSet: Set<string>;
  children?: JSX.Element;
  fallback?: JSX.Element;
  exapandable?: boolean;
  note?: JSX.Element;
}) {
  const depth = createMemo(() => props.path?.length ?? 0);
  const pathkey = createMemo(() => props.path.join(":"));
  const [expanded, setExpanded] = createSignal(
    props.expandedSet.has(pathkey()),
  );

  createEffect(
    on(
      expanded,
      (exp) => {
        if (exp) props.expandedSet.add(pathkey());
        else props.expandedSet.delete(pathkey());
      },
      { defer: true },
    ),
  );

  return (
    <li
      class="flex flex-1 flex-col"
      classList={{
        "opacity-75": depth() == 0 && !props.trace?.tlr,
      }}
    >
      <Show
        when={props.exapandable}
        fallback={
          <>
            <span
              class="flex flex-1 flex-row pl-1"
              classList={{
                "pl-4": depth() > 0,
              }}
            >
              <RequestSummary
                trace={props.trace}
                onRestore={props.onRestore}
                clearTrace={props.clearTrace}
                note={props.note}
                current={props.current}
              />
            </span>
            {props.fallback ? <ul class="pl-3">{props.fallback}</ul> : <></>}
          </>
        }
      >
        <div class="flex flex-row">
          <Toggle
            class="w-4 bg-transparent p-0 active:!bg-transparent"
            value={expanded()}
            onChange={setExpanded}
          >
            {(props) => (
              <TbChevronRight
                class="relative inline rotate-0 transition-transform duration-200"
                classList={{
                  "rotate-90": props.value,
                }}
              />
            )}
          </Toggle>
          <RequestSummary
            trace={props.trace}
            onRestore={props.onRestore}
            clearTrace={props.clearTrace}
            note={props.note}
            current={props.current}
          />
        </div>

        <Show
          when={expanded()}
          fallback={
            props.fallback ? <ul class="pl-3">{props.fallback}</ul> : <></>
          }
        >
          {props.children ? <ul class="pl-3">{props.children}</ul> : undefined}
        </Show>
      </Show>
    </li>
  );
}

export function RequestSummary(
  props: {
    trace: Trace;
    onRestore?(history: ExecutionHistory): void;
    clearTrace?(trace: number): void;
    note?: JSX.Element;
    current?: boolean;
  } & ComponentProps<"span">,
) {
  const [, spanProps] = splitProps(props, [
    "trace",
    "onRestore",
    "clearTrace",
    "note",
    "current",
  ]);
  const request = createMemo(() =>
    displayHttp(props.trace.render?.outbound?.request),
  );
  const response = createMemo(() => props.trace?.result?.inbound.response);
  const summaryInfo = useContext(RequestSummaryInfo);

  return (
    <div class="relative flex flex-1 flex-row gap-1 px-1 py-0.5 [&:hover>.faded]:opacity-75">
      <button
        class="rounded-sm p-0.5 text-xs"
        onClick={() => {
          summaryInfo?.outbound(props.trace);
        }}
      >
        <TbChartArrows class="pointer-events-none relative" />
      </button>
      <button
        class="rounded-sm p-0.5 text-xs"
        disabled={!props.trace?.result}
        onClick={() => {
          summaryInfo?.inbound(props.trace);
        }}
      >
        <TbChartArrows class="pointer-events-none rotate-90" />
      </button>
      <button
        class="flex w-0 flex-1 overflow-hidden rounded-none p-0 text-left align-middle active:!bg-slate-300 dark:active:!bg-slate-600"
        classList={{
          "bg-transparent": !props.current,
          "bg-gray-400 bg-opacity-25": props.current,
        }}
        onClick={() => {
          const {
            trace: {
              trace,
              render: { outbound },
              result,
              start: {
                context: { ask },
              },
            },
            onRestore,
          } = props;

          onRestore({
            context: {
              trace,
              ask,
            },
            outbound,
            inbound: result?.inbound,
          });
        }}
      >
        <span
          {...spanProps}
          class={twMerge(
            "inline-flex min-w-6 flex-initial font-mono",
            spanProps.class,
          )}
        >
          <Show
            when={props.trace?.result}
            fallback={
              <Show
                when={props.trace?.sent}
                fallback={
                  <>
                    <TbPencil class="inline-block flex-1 text-center" />
                  </>
                }
              >
                <LoadingSplash />
              </Show>
            }
          >
            {String(response()?.status)}
          </Show>
        </span>
        <HttpMethodIcon
          method={request()?.method}
          class="flex-initial translate-y-[7px] scale-[1.1] pr-0.5 text-2xl"
        />
        <code class="flex-1 overflow-hidden overflow-ellipsis">
          {request()?.url}
        </code>
        {props.note}
      </button>
      <div class="faded absolute inset-y-0 right-2 z-10 flex flex-row gap-2 opacity-0 transition-all duration-200 hover:!opacity-100">
        <button
          class="m-0 bg-neutral-300 p-1 dark:bg-neutral-400"
          onClick={() => {
            const outbound = props.trace?.render?.outbound?.request;
            const inbound = props.trace?.result?.inbound;
            navigator.clipboard.writeText(
              `
>>>
${HTTP.stringify(HTTP.requestObject.fromJSON(outbound))}
${
  !inbound
    ? ""
    : `
<<<
${HTTP.responseObject.stringify(HTTP.responseObject.fromJSON(inbound.response))}`
}`.trim(),
            );
          }}
        >
          <TbCopy />
        </button>
        <Show when={props.clearTrace}>
          <button
            class=":hover:bg-fuchsia-300 p-1 transition-colors duration-300 disabled:!bg-neutral-200 dark:bg-teal-600 dark:hover:bg-pink-500 dark:disabled:!bg-neutral-600"
            disabled={!props.trace?.sent}
            onClick={() => {
              props.clearTrace?.(props.trace.trace);
            }}
          >
            <TbTrash />
          </button>
        </Show>
      </div>
    </div>
  );
}
