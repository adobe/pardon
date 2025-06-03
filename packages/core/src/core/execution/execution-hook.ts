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
import { PardonFetchExecution } from "../pardon/pardon.js";
import {
  PardonExecution,
  pardonExecution,
  PardonExecutionError,
} from "./pardon-execution.js";

type ExtendedExecution<ContextExtension, Execution> =
  Execution extends PardonExecution<
    infer Init,
    infer Context,
    infer Match,
    infer Request,
    infer Response,
    infer Result
  >
    ? PardonExecution<
        Init,
        Context & ContextExtension,
        Match,
        Request,
        Response,
        Result
      >
    : never;

type ExtendedContext<
  ContextExtension,
  Execution = typeof PardonFetchExecution,
> =
  Execution extends PardonExecution<any, infer Context, any, any, any, any>
    ? Context & ContextExtension
    : never;

type ExtendedExecutionHooks<
  ContextExtension,
  Execution = typeof PardonFetchExecution,
> =
  Execution extends PardonExecution<
    infer Init,
    infer Context,
    infer Match,
    infer Egress,
    infer Ingress,
    infer Result
  >
    ? {
        init?(
          init: Init,
          next: (init: Init) => Promise<Context>,
        ): Promise<Context & ContextExtension>;

        match?(
          info: { context: Context & ContextExtension },
          next: (info: { context: Context }) => Promise<Match>,
        ): Promise<Match>;

        preview?(
          info: { context: Context & ContextExtension; match: Match },
          next: (info: { context: Context; match: Match }) => Promise<Egress>,
        ): Promise<Egress>;

        render?(
          info: { context: Context & ContextExtension; match: Match },
          next: (info: { context: Context; match: Match }) => Promise<Egress>,
        ): Promise<Egress>;

        fetch?(
          info: {
            context: Context & ContextExtension;
            match: Match;
            egress: Egress;
          },
          next: (info: {
            context: Context;
            match: Match;
            egress: Egress;
          }) => Promise<Ingress>,
        ): Promise<Ingress>;

        process?(
          info: {
            context: Context & ContextExtension;
            match: Match;
            egress: Egress;
            ingress: Ingress;
          },
          next: (info: {
            context: Context;
            match: Match;
            egress: Egress;
            ingress: Ingress;
          }) => Promise<Result>,
        ): Promise<Result>;

        result?(info: {
          context: Context & ContextExtension;
          match: Match;
          egress: Egress;
          ingress: Ingress;
          result: Result;
        }): void | Promise<void>;

        error?(error: PardonExecutionError, info: any): void;
      }
    : never;

export function hookExecution<
  ContextExtension = unknown,
  Execution extends typeof PardonFetchExecution = typeof PardonFetchExecution,
>(
  { executor }: Execution,
  hooks: ExtendedExecutionHooks<ContextExtension, Execution>,
): ExtendedExecution<ContextExtension, Execution> {
  return pardonExecution({
    async init(init) {
      return (
        (await hooks.init?.(init, async (init) => executor.init(init))) ??
        (await (executor.init(init) as Promise<
          ExtendedContext<ContextExtension, Execution>
        >))
      );
    },
    async match(info) {
      return (
        (await hooks.match?.(info, async (info) => executor.match(info))) ??
        (await executor.match(info))
      );
    },
    async preview(info) {
      return (
        (await hooks.preview?.(info, async (info) => executor.preview(info))) ??
        (await executor.preview(info))
      );
    },
    async render(info) {
      return (
        (await hooks.render?.(info, async (info) => executor.render(info))) ??
        (await executor.render(info))
      );
    },
    async fetch(info) {
      return (
        (await hooks.fetch?.(info, async (info) => executor.fetch(info))) ??
        (await executor.fetch(info))
      );
    },
    async process(info) {
      const result =
        (await hooks.process?.(info, async (info) => executor.process(info))) ??
        (await executor.process(info));

      await hooks.result?.({ ...info, result });
      return result;
    },
    error(error, info) {
      hooks.error?.(error, info);
      executor.error(error, info);
    },
  } satisfies ExtendedExecution<
    ContextExtension,
    Execution
  >["executor"]) as ExtendedExecution<ContextExtension, Execution>;
}
