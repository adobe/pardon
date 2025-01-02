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
  createResource,
  createSignal,
  onCleanup,
  ResourceReturn,
  type Accessor,
} from "solid-js";
import settle from "../util/settle.ts";
import { manifest } from "./pardon-config.ts";
import { deferred } from "pardon/utils";
import { setSecureData } from "../components/secure-data.ts";
import { recv } from "../util/persistence.ts";

function postfilter(selected: string) {
  return selected?.startsWith("endpoint:")
    ? { endpoint: selected.slice("endpoint:".length) }
    : selected?.startsWith("config:")
      ? { service: selected.slice("config:".length) }
      : {};
}

export type ExecutionStatus =
  | "pending"
  | "inflight"
  | "complete"
  | "aborted"
  | "historical";

export type UnsettledResourceType<
  X extends (...args: any) => ResourceReturn<PromiseSettledResult<any>>,
> = ReturnType<ReturnType<X>[0]>;

export type SettledResourceType<
  X extends (...args: any) => ResourceReturn<PromiseSettledResult<any>>,
> =
  UnsettledResourceType<X> extends PromiseSettledResult<infer T>
    ? T | null
    : never;

export type ExecutionResult =
  | ({ type: "response" } & Awaited<ReturnType<typeof window.pardon.continue>>)
  | ({ type: "history" } & ExecutionHistory);

export type ExecutionOutboundResult =
  | ({ type: "request"; context: { ask: string; trace: number } } & Omit<
      Awaited<ReturnType<typeof window.pardon.render>>,
      "secure"
    >)
  | ({ type: "history" } & Omit<ExecutionHistory, "secure">);

export type ExecutionInboundResult =
  | ({ type: "response" } & Omit<
      Awaited<ReturnType<typeof window.pardon.continue>>,
      "secure"
    >)
  | ({ type: "history" } & Omit<ExecutionHistory, "secure">);

export function executionResource(source: Accessor<PardonExecutionSource>) {
  const [preview] = previewResource(source);
  const [outbound] = outboundResource(source);

  return { preview, outbound };
}

function previewResource(source: Accessor<PardonExecutionSource>) {
  return createResource(
    () => ({ manifest: manifest(), source: source() }),
    async ({ source: { http, values, hint } }) => {
      return recv(
        await settle(
          window.pardon.preview(http, values, {
            pretty: true,
            ...postfilter(hint),
          }),
        ),
      );
    },
  );
}

function outboundResource(source: Accessor<PardonExecutionSource>) {
  return createResource(
    () => ({ manifest: manifest(), source: source() }),
    async ({ source: { http, values, hint, history } }) => {
      const requestGate = deferred<boolean>();
      const [execution, setExecution] =
        createSignal<ExecutionStatus>("pending");

      const action: () => Promise<ExecutionOutboundResult> =
        history && history.inbound
          ? (): Promise<ExecutionOutboundResult> => {
              requestGate.resolution.resolve(true);
              setExecution("historical");

              return Promise.resolve({
                type: "history" as const,
                ...history,
              } as ExecutionOutboundResult);
            }
          : async (): Promise<ExecutionOutboundResult> => {
              try {
                const { secure, ...render } = recv(
                  await window.pardon.render(http, values, {
                    ...postfilter(hint),
                  }),
                );

                setSecureData((data) => ({
                  ...data,
                  [render.context.trace]: secure,
                }));

                return {
                  type: "request" as const,
                  ...render,
                };
              } catch (error) {
                requestGate.resolution.reject(error);
                throw error;
              }
            };

      requestGate.promise.catch((err) => {
        if (err) console.warn("request", err);
      });

      onCleanup(() => {
        requestGate.resolution.reject(undefined);
      });

      return Object.assign(await settle(action()), {
        gate: requestGate,
        execution,
        setExecution,
      });
    },
  );
}
