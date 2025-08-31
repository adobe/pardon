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
import { HTTP } from "pardon";
import {
  Show,
  createEffect,
  createMemo,
  createResource,
  on,
  type ComponentProps,
  type ParentProps,
  type Setter,
} from "solid-js";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

import type { ExecutionHandle } from "@components/playgrounds/pardon/pardon-playground-shared";
import { useSecretsSignal } from "@components/playgrounds/pardon/PardonPlaygroundSecretsSignalContext";
import type { FlightStatus } from "./PardonPlaygroundResponseView.tsx";

export default function PardonPlaygroundRenderView(
  props: ParentProps<{
    executionHandle: ExecutionHandle;
    onRequest?: () => void;
    inflight?: FlightStatus;
    secretsRef?: Setter<boolean>;
    reset: () => void;
  }> &
    ComponentProps<"div">,
) {
  const { secrets, setSecrets, enabled: secretsEnabled } = useSecretsSignal();

  const [execution] = createResource(
    () => ({ executionHandle: props.executionHandle() }),
    async ({ executionHandle }) => {
      if ("error" in executionHandle) {
        return {
          error: new Error("invalid application context", {
            cause: executionHandle.error,
          }),
        };
      }

      const { execution } = executionHandle;

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const previewing = execution.preview;

      try {
        await previewing;
      } catch (error) {
        return {
          render: undefined,
          error: displayError(error),
        };
      }

      try {
        const render = await execution.egress;

        return {
          render: {
            request: HTTP.stringify({ ...render.request, values: undefined }),
            redacted: HTTP.stringify({ ...render.redacted, values: undefined }),
          },
        };
      } catch (error) {
        return {
          render: undefined,
          error: displayError(error),
        };
      }
    },
  );

  const pardon = createMemo<{
    error?: any;
    render?: {
      request: string;
      redacted: string;
    };
  }>((previous) => {
    if (execution.state === "pending") {
      return {};
    }
    const error = execution.latest?.error;
    const latestRender = execution.latest?.render ?? previous?.render;

    return {
      error,
      render: latestRender,
    };
  });

  const output = createMemo(() => {
    if (pardon()?.error) {
      return String(pardon()?.error);
    }

    return secretsEnabled && secrets()
      ? pardon()?.render?.request
      : pardon()?.render?.redacted;
  });

  createEffect(
    on(
      () => props.inflight,
      (inflight) => {
        if (inflight === "pending") {
          props.reset();
        }
      },
    ),
  );

  return (
    <CodeMirror
      value={output()}
      readonly={true}
      class={
        "rounded-md bg-neutral-200 p-2 shadow outline-gray-500 dark:bg-fuchsia-950"
      }
      classList={{
        [props.class ?? ""]: true,
        ...props.classList,
        "opacity-50": Boolean(pardon()?.error || execution.loading),
      }}
      icon={
        <div
          class="icon-grid"
          classList={{
            "icon-grid-col": (output()?.split("\n").length ?? 0) < 4,
          }}
        >
          <Show when={secretsEnabled}>
            <button
              class="-m-1 rounded-md border-none bg-transparent p-1 leading-none hover:bg-yellow-200 dark:hover:bg-fuchsia-900"
              onMouseDown={() =>
                secretsEnabled &&
                setSecrets((value) => {
                  return !value;
                })
              }
            >
              <Show
                when={secretsEnabled && secrets()}
                fallback={<IconTablerLock color="gray" class="text-2xl" />}
              >
                <IconTablerLockOpen color="gray" class="text-2xl" />
              </Show>
            </button>
          </Show>
        </div>
      }
    />
  );
}

function displayError(error: any) {
  const stack: string[] = [];

  stack.unshift(String(error?.message ?? error));

  while (error.cause) {
    error = error.cause;

    stack.unshift(String(error?.message ?? error));
  }

  return stack.join("\n");
}
