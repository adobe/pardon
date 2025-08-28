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
  PardonAppContext,
  PardonFetchExecution,
} from "../core/pardon/pardon.js";
import { disconnected, tracking } from "../core/tracking.js";
import { hookExecution } from "../core/execution/execution-hook.js";
import { withoutEvaluationScope } from "../core/schema/core/context-util.js";
import { PardonExecutionError } from "../core/execution/pardon-execution.js";
import { LayeredEndpoint } from "../config/collection-types.js";

let notifier:
  | {
      onRenderStart(traced: TracedRenderStart): void;
      onRenderComplete(rendered: TracedRenderComplete): void;
      onSend(rendered: TracedRenderComplete): void;
      onResult(traced: TracedResult): void;
      onError(traced: TracedError): void;
    }
  | undefined
  | null = undefined;

export type TracedRenderStart = TracedRequest<{
  ask?: string;
}> & { endpoint: LayeredEndpoint };

export type TracedRenderComplete = TracedRequest<{
  awaited: { requests: TracedRequest[]; results: TracedResult[] };
}> & {
  egress: Omit<ProcessedHookInput["egress"], "evaluationScope">;
};

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

type Optional<T, Keys extends keyof T> = Omit<T, Keys> & Partial<Pick<T, Keys>>;

function traceResult({
  context,
  match: { endpoint },
  result: { egress, ingress, output },
  error,
}: Pick<ProcessedHookInput, "context" | "match" | "error"> & {
  result: Optional<ProcessedHookInput["result"], "ingress">;
}) {
  return {
    context,
    endpoint,
    egress: withoutEvaluationScope(egress),
    ingress: ingress && withoutEvaluationScope(ingress),
    output,
    error,
  };
}

export type TracedRequest<Ext = unknown> = ReturnType<typeof traceRequest> & {
  context: Ext;
};
export type TracedResult<Ext = unknown> = ReturnType<typeof traceResult> & {
  context: Ext;
};

export type TracedError = {
  trace: number;
  error: PardonExecutionError;
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

export default function trace<Execution extends typeof PardonFetchExecution>(
  execution: Execution,
) {
  return hookExecution<PardonTraceExtension>(execution, {
    async init(init, next) {
      const context = await next(init);
      const trace = nextTraceId++;

      Object.assign(context, {
        trace,
      } satisfies Pick<PardonTraceExtension, "trace">);

      return context as typeof context & PardonTraceExtension;
    },
    match(info, next) {
      return disconnected(() => next(info));
    },
    async render(info, next) {
      Object.assign(info.context, {
        awaited: { requests: awaitedRequests() },
      } satisfies {
        awaited: Pick<PardonTraceExtension["awaited"], "requests">;
      });

      const traced = traceRequest(info);

      await disconnected(() => notifier?.onRenderStart(traced));
      trackRequest(traced);

      const egress = await next(info);

      info.context.awaited.results = awaitedResults();
      await disconnected(() =>
        notifier?.onRenderComplete({ ...traced, egress }),
      );

      return egress;
    },
    async fetch(info) {
      notifier?.onSend({
        ...traceRequest(info),
        egress: withoutEvaluationScope(info.egress),
      });

      return undefined!;
    },
    async result({ context, match, result }) {
      const traced = traceResult({ context, match, result });
      trackResult(traced);
      notifier?.onResult(traced);
    },
    error(error, info) {
      const trace = info?.context?.trace;

      if (trace) {
        if (info.egress) {
          const traced = traceResult({
            ...info,
            result: {
              endpoint: info.match.endpoint.configuration.path,
              egress: info.egress,
            },
            error,
          });
          trackResult(traced);
        }

        notifier?.onError?.({
          trace,
          error,
        });
      }
    },
  });
}
