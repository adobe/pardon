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
import { PardonAppContext, PardonFetchExecution } from "../core/pardon.js";
import { disconnected, tracking } from "../core/tracking.js";
import { hookExecution } from "../core/execution/execution-hook.js";

let notifier:
  | {
      onRenderStart(traced: TracedRequest): void;
      onRenderComplete(
        rendered: TracedRequest & {
          outbound: Omit<ProcessedHookInput["outbound"], "scope">;
        },
      ): void;
      onSend(
        rendered: TracedRequest & {
          outbound: Omit<ProcessedHookInput["outbound"], "scope">;
        },
      ): void;
      onResult(traced: TracedResult): void;
      onError(error: unknown, stage: string, trace: number): void;
    }
  | undefined
  | null = undefined;

export type PardonTraceExtension<Ext = unknown> = {
  awaited: {
    requests: TracedRequest<Ext>[];
    results: TracedResult<Ext>[];
  };
  trace: number;
};

type ProcessedHook = Parameters<typeof hookExecution>[1]["result"];
type ProcessedHookInput = Parameters<Exclude<ProcessedHook, undefined>>[0] & {
  context: { app: () => PardonAppContext } & PardonTraceExtension;
};

function traceRequest({
  context,
  match: { endpoint, values },
}: Pick<ProcessedHookInput, "context" | "match">) {
  return { context, endpoint, values };
}

function traceResult({
  context,
  match: { endpoint },
  result: { outbound, inbound },
}: Pick<ProcessedHookInput, "context" | "match" | "result">) {
  return {
    context,
    endpoint,
    outbound: withoutScope(outbound),
    inbound: withoutScope(inbound),
  };
}

export type TracedRequest<Ext = unknown> = ReturnType<typeof traceRequest> & {
  context: Ext;
};
export type TracedResult<Ext = unknown> = ReturnType<typeof traceResult> & {
  context: Ext;
};

const { awaited: awaitedResults, track: trackResult } =
  tracking<TracedResult>();
const { awaited: awaitedRequests, track: trackRequest } =
  tracking<TracedRequest>();

export { awaitedResults, awaitedRequests };

let nextTraceId = 1;

export function traced(
  notificationHandler: typeof notifier,
  startTraceId?: number,
) {
  if (notifier !== undefined) {
    throw new Error("traced cannot be called more than once");
  }

  nextTraceId = startTraceId ?? nextTraceId;

  notifier = notificationHandler ?? null;
  return trace;
}

export function withoutScope<T extends { scope?: any }>({
  scope: _,
  ...thing
}: T): Omit<T, "scope"> {
  return thing;
}

export default function trace<Execution extends typeof PardonFetchExecution>(
  execution: Execution,
) {
  return hookExecution<PardonTraceExtension>(execution, {
    match(info, next) {
      return disconnected(() => next(info));
    },
    async render(info, next) {
      const trace = nextTraceId++;
      Object.assign(info.context, {
        trace,
        awaited: { requests: awaitedRequests(), results: awaitedResults() },
      } satisfies PardonTraceExtension);

      const traced = traceRequest({ ...info });

      await disconnected(() => notifier?.onRenderStart(traced));
      trackRequest(traced);

      const outbound = await next(info);

      info.context.awaited.results = awaitedResults();
      await disconnected(() =>
        notifier?.onRenderComplete({ ...traced, outbound }),
      );

      return outbound;
    },
    async fetch(info) {
      notifier?.onSend({
        ...traceRequest(info),
        outbound: withoutScope(info.outbound),
      });

      return undefined!;
    },
    async result({ context, match, result }) {
      const traced = traceResult({ context, match, result });
      trackResult(traced);
      notifier?.onResult(traced);
    },
    onerror(error, stage, info) {
      const trace = info.context?.trace;
      if (trace) {
        notifier?.onError(error, stage, trace);
      }
    },
  });
}
