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

import { createMemo, createSignal, on, type Accessor } from "solid-js";
import { Deferred, deferred, recv, ship } from "pardon/utils";
import { cancelTrace } from "../components/request-history.ts";

export type ExecutionResult = Awaited<
  ReturnType<typeof window.pardon.continue>
>;

export type ExecutionEgressResult = {
  context: { ask: string; trace: number };
} & Omit<Awaited<ReturnType<typeof window.pardon.render>>, "secure">;

export type ExecutionProgress =
  | "preview"
  | "rendering"
  | "pending"
  | "errored"
  | "inflight"
  | "complete"
  | "failed";

function makeDebouncer(defaultDelay?: number) {
  let debouncer: Deferred<void> | undefined;

  return async function debounce({
    delay = defaultDelay ?? 300,
    gate,
  }: {
    delay?: number;
    gate?: Promise<any>;
  }) {
    debouncer?.resolution.reject(undefined);
    debouncer = deferred();
    debouncer.promise.catch(() => {});

    const debouncer0 = debouncer;
    setTimeout(() => {
      debouncer0.resolution.resolve();
    }, delay);

    await gate;

    await debouncer.promise;
  };
}

const renderDebouncer = makeDebouncer(100);
const previewDebouncer = makeDebouncer(50);

export function executionMemo(source: Accessor<PardonExecutionSource>) {
  return createMemo(
    on<
      PardonExecutionSource,
      {
        abort(reason: any): void;
        progress: ExecutionProgress;
        context: Promise<
          Awaited<ReturnType<typeof window.pardon.context>>["context"]
        >;
        preview: ReturnType<typeof window.pardon.preview>;
        request: Promise<
          Awaited<ReturnType<typeof window.pardon.render>>["render"]
        >;
        response: ReturnType<typeof window.pardon.continue>;
        send(): void;
        render(): void;
      }
    >(source, (source, _previousSource, previous) => {
      const { http, values } = source;

      const gates = {
        preview: deferred<boolean>(),
        render: deferred<boolean>(),
        response: deferred<boolean>(),
      };

      const [progress, setProgress] =
        createSignal<ExecutionProgress>("preview");

      const abort = (reason: any) => {
        for (const gate of Object.values(gates)) {
          gate.resolution.reject(reason);
        }

        if (["pending", "rendering"].includes(progress())) {
          contextTask
            .then(({ context: { trace } }) => {
              cancelTrace(trace);
            })
            .catch(() => {});
        }
      };

      for (const [type, gate] of Object.entries(gates)) {
        gate.promise.catch((reason) => {
          if (reason) {
            console.log(`${type} aborted`, reason);
          }
        });
      }

      previous?.abort(undefined);

      const contextTask = (async () => {
        const context = await window.pardon.context(http, ship(values), {
          pretty: true,
        });

        return context;
      })();

      const previewTask = (async () => {
        const { handle } = await contextTask;

        await previewDebouncer({ gate: gates.preview.promise });

        return recv(await window.pardon.preview(handle));
      })();

      const renderTask = (async () => {
        const { handle } = await contextTask;
        await renderDebouncer({ gate: gates.render.promise });

        setProgress("rendering");

        try {
          const result = recv(await window.pardon.render(handle));

          setProgress("pending");

          return result;
        } catch (error) {
          setProgress("errored");

          throw error;
        }
      })();

      const responseTask = (async () => {
        await gates.response.promise;

        gates.render.resolution.resolve(true);

        const { handle } = await renderTask;

        setProgress("inflight");

        try {
          const result = recv(await window.pardon.continue(handle));
          setProgress("complete");

          return result;
        } catch (error) {
          setProgress("failed");

          throw error;
        }
      })();

      return {
        abort,
        get context() {
          return contextTask.then(({ context }) => context);
        },
        get progress() {
          return progress();
        },
        get preview() {
          gates.preview.resolution.resolve(true);

          return previewTask;
        },
        get request() {
          return renderTask.then(({ render }) => render);
        },
        render() {
          gates.render.resolution.resolve(true);
        },
        send() {
          gates.response.resolution.resolve(true);
        },
        get response() {
          return responseTask;
        },
      };
    }),
  );
}
