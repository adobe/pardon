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

import deferred, { type Deferred } from "../../../util/deferred.js";
import type { PardonRuntime } from "../../pardon/types.js";
import { type FlowFrame, type FlowFrameInfo, makeFlowFrame } from "./flow-report.js";

export interface FlowContext {
  runtime: PardonRuntime;
  relative?: string;
  mergeWithContext(other: FlowContext): FlowContext;
  mergeEnvironment(
    context?: Record<string, unknown>,
    stream?: Record<string, string>,
  ): FlowContext;
  overrideEnvironment(
    context?: Record<string, unknown>,
    stream?: Record<string, string>,
  ): FlowContext;
  readonly context: Record<string, unknown>;
  readonly flow: Record<string, unknown>;
  /** report frame for the currently-executing flow (undefined = not collecting) */
  readonly report?: FlowFrame;
  /** derive a context whose report frame is a new child flow (or a fresh root) */
  enterFlow(info: FlowFrameInfo): FlowContext;
  /** abort in this context */
  abort(reason: unknown): void;
  /** never resolves, rejects if aborted */
  aborting(): Promise<unknown>;
  /** call this periodically to check if we should abort */
  checkAborted(): void;
  pending<T>(_: Promise<T>): Promise<T>;
}

export function createFlowContext(
  runtime: PardonRuntime,
  context: Record<string, unknown> = {},
  flow: Record<string, unknown> = {},
  aborted: Deferred<unknown> & { reason?: unknown } = deferred(),
  report?: FlowFrame,
): FlowContext {
  return {
    runtime,
    report,
    mergeWithContext(other) {
      return createFlowContext(
        runtime,
        { ...context, ...other.context },
        { ...flow, ...other.flow },
        aborted,
        report,
      );
    },
    mergeEnvironment(newcontext, newflow) {
      return createFlowContext(
        runtime,
        { ...context, ...newcontext },
        { ...flow, ...newflow },
        aborted,
        report,
      );
    },
    overrideEnvironment(context, stream) {
      return createFlowContext(
        runtime,
        { ...context },
        { ...stream },
        aborted,
        report,
      );
    },
    enterFlow(info) {
      const frame = report ? report.child(info) : makeFlowFrame(info);
      return createFlowContext(
        runtime,
        { ...context },
        { ...flow },
        aborted,
        frame,
      );
    },
    get context() {
      return context;
    },
    get flow() {
      return flow;
    },
    abort(reason) {
      if (aborted.reason === undefined) {
        aborted.reason = reason;
        aborted.resolution.reject(reason);
      }
    },
    checkAborted() {
      if (aborted.reason !== undefined) {
        throw aborted.reason;
      }
    },
    aborting() {
      return aborted.promise;
    },
    pending: (p) => p,
  };
}
