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

import {
  ComponentProps,
  createMemo,
  Show,
  splitProps,
  JSX,
  Switch,
  Match,
} from "solid-js";
import { twMerge } from "tailwind-merge";
import HttpMethodIcon from "./HttpMethodIcon.tsx";
import LoadingSplash from "./LoadingSplash.tsx";
import { RelatedTraces, Trace } from "./request-history.ts";
import { displayHttp } from "./display-util.ts";
import { HTTP } from "pardon/formats";
import KeyValueCopier from "./KeyValueCopier.tsx";

export type HistoryTree = {
  trace: number;
  auto?: boolean;
  deps: HistoryTree[];
};

export function RequestSummaryTree(props: {
  traces: Record<number, Trace>;
  trace: number;
  path?: number[];
  expandedSet: Set<string>;
  related: RelatedTraces;
  onRestore(history: ExecutionHistory): void;
  clearTrace?(trace: number): void;
}) {
  const trace = createMemo(() => props.traces[props.trace]);
  const relation = createMemo(() =>
    props.related.current === props.trace
      ? "current"
      : props.related.direct.includes(props.trace)
        ? "direct"
        : props.related.indirect.includes(props.trace)
          ? "indirect"
          : undefined,
  );

  return (
    <RequestSummaryNode
      {...props}
      trace={trace()}
      relation={relation()}
      auto={!props.traces[props.trace]?.tlr}
    >
      <Show when={Object.keys(trace()?.result?.output ?? {}).length}>
        <KeyValueCopier
          values={trace()?.result?.output}
          readonly
          class="pl-4"
        />
      </Show>
    </RequestSummaryNode>
  );
}

export function RequestSummaryNode(props: {
  trace: Trace;
  relation?: "current" | "direct" | "indirect";
  auto?: boolean;
  children?: JSX.Element;
  note?: JSX.Element;
  onRestore(history: ExecutionHistory): void;
  clearTrace?(trace: number): void;
}) {
  return (
    <li
      class="flex flex-1 flex-col"
      classList={{
        "opacity-75": !props.trace?.tlr && !props.relation,
        "opacity-85": props.relation && props.relation !== "current",
      }}
    >
      <div class="flex w-full flex-1 flex-col pl-1">
        <RequestSummary
          trace={props.trace}
          onRestore={props.onRestore}
          clearTrace={props.clearTrace}
          auto={props.auto}
          note={props.note}
          relation={props.relation}
        />
        {props.children}
      </div>
    </li>
  );
}

export function RequestSummary(
  props: {
    trace: Trace;
    auto?: boolean;
    onRestore(history: ExecutionHistory): void;
    clearTrace?(trace: number): void;
    note?: JSX.Element;
    relation?: "current" | "direct" | "indirect";
  } & ComponentProps<"span">,
) {
  const [, spanProps] = splitProps(props, [
    "trace",
    "onRestore",
    "clearTrace",
    "note",
    "relation",
  ]);
  const request = createMemo(() =>
    displayHttp(props.trace?.render?.egress?.request),
  );

  const response = createMemo(() => props.trace?.result?.ingress?.response);

  return (
    <div class="relative flex flex-1 flex-row gap-1 px-1 py-0.5 [&:hover>.faded]:opacity-75">
      <button
        class="relative left-0 flex w-0 flex-1 overflow-hidden rounded-none p-0 pl-0 text-left align-middle transition-all duration-200 active:!bg-slate-300 dark:hover:!bg-slate-600/50 dark:active:!bg-slate-600"
        classList={{
          "bg-transparent": !props.relation,
          "bg-gray-500/40": props.relation === "current",
          "bg-gray-500/30 !left-2": props.relation === "direct",
          "bg-gray-500/15 !left-4": props.relation === "indirect",
          "opacity-75": props.auto && !props.relation,
        }}
        onClick={() => {
          const {
            trace: {
              trace,
              render: { egress },
              result,
              start: {
                context: { ask },
              },
              error,
            },
            onRestore,
          } = props;

          onRestore({
            context: {
              trace,
              ask,
            },
            egress,
            ingress: result?.ingress,
            error,
          });
        }}
      >
        <span
          {...spanProps}
          class={twMerge(
            "inline-flex w-7 flex-initial font-mono",
            spanProps.class,
          )}
        >
          <Switch
            fallback={
              <>
                <IconTablerPencil class="inline-block flex-1 text-center" />
              </>
            }
          >
            <Match when={props.trace?.result}>
              {String(response()?.status ?? "") || <IconTablerX />}
            </Match>
            <Match when={props.trace?.error}>
              <IconTablerX class="m-auto" />
            </Match>
            <Match when={props.trace?.sent}>
              <LoadingSplash />
            </Match>
          </Switch>
        </span>
        <HttpMethodIcon
          method={request()?.method}
          class="relative top-[0.1rem]"
        />
        <code class="flex-1 overflow-hidden overflow-ellipsis">
          {request()?.url}
        </code>
        {props.note}
      </button>
      <div class="faded absolute inset-y-0 right-2 z-10 flex flex-row gap-2 opacity-0 transition-all duration-200 hover:!opacity-100">
        <button
          class="m-0 bg-neutral-300 p-1 dark:bg-neutral-400"
          tabIndex={-1}
          onClick={() => {
            const egress = props.trace?.render?.egress;
            const ingress = props.trace?.result?.ingress;
            navigator.clipboard.writeText(
              `
>>>
${HTTP.stringify(HTTP.requestObject.fromJSON(egress.request))}
${
  !ingress
    ? ""
    : `
<<<
${HTTP.responseObject.stringify(HTTP.responseObject.fromJSON(ingress.response))}`
}`.trim(),
            );
          }}
        >
          <IconTablerCopy />
        </button>
        <Show when={props.clearTrace}>
          <button
            tabIndex={-1}
            class=":hover:bg-fuchsia-300 p-1 transition-colors duration-300 disabled:!bg-neutral-200 dark:bg-teal-600 dark:hover:bg-pink-500 dark:disabled:!bg-neutral-600"
            disabled={!props.trace?.sent}
            onClick={() => {
              props.clearTrace?.(props.trace.trace);
            }}
          >
            <IconTablerTrash />
          </button>
        </Show>
      </div>
    </div>
  );
}
