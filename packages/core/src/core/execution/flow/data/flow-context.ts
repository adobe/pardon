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

import { PardonRuntime } from "../../../pardon/types.js";

export interface FlowContext {
  runtime: PardonRuntime;
  mergeWithContext(other: FlowContext): FlowContext;
  mergeEnvironment(data?: Record<string, unknown>): FlowContext;
  overrideEnvironment(data?: Record<string, unknown>): FlowContext;
  readonly environment: Record<string, unknown>;
  /** abort in this context */
  abort(reason: unknown): void;
  /** never resolves, rejects if aborted */
  aborting(): Promise<unknown>;
  /** call this periodically to check if we should abort */
  checkAborted(): void;
  pending<T>(_: Promise<T>): Promise<T>;
}
