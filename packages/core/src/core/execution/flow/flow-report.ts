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
import type { FlowReport, FlowStepReport } from "./https-flow-types.js";

export type FlowFrameInfo = Pick<FlowReport, "type" | "name" | "values">;

/**
 * A mutable node accumulating one flow invocation's steps and nested flows.
 * Threaded on FlowContext by reference (like `aborted`), so it survives the
 * context's copy-on-merge and stays explicit (no async-hooks dependency).
 */
export interface FlowFrame {
  readonly info: FlowFrameInfo;
  /** append a completed exchange step to this frame */
  step(report: FlowStepReport): void;
  /** open a nested flow, linked into this frame's deps */
  child(info: FlowFrameInfo): FlowFrame;
  /** close this frame with its result or error */
  finish(outcome: { result?: Record<string, any>; error?: unknown }): void;
  /** assemble recursively into the report shape the runner logs */
  toReport(): FlowReport;
}

export function makeFlowFrame(info: FlowFrameInfo): FlowFrame {
  const steps: FlowStepReport[] = [];
  const deps: FlowFrame[] = [];
  let result: Record<string, any> | undefined;
  let error: unknown;

  return {
    info,
    step(report) {
      steps.push(report);
    },
    child(childInfo) {
      const frame = makeFlowFrame(childInfo);
      deps.push(frame);
      return frame;
    },
    finish(outcome) {
      result = outcome.result;
      error = outcome.error;
    },
    toReport() {
      return {
        ...info,
        result,
        error,
        steps,
        deps: deps.map((dep) => dep.toReport()),
        // executions are still gathered via the ambient trace graph; reduce
        // them from per-step traces once FlowStepReport carries them.
        executions: [],
      };
    },
  };
}
