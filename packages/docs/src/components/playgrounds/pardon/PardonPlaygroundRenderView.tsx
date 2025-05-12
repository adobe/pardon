import { HTTP } from "pardon";
import {
  Show,
  createMemo,
  createResource,
  createSignal,
  type ComponentProps,
  type ParentProps,
  type Setter,
} from "solid-js";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

import { TbLock, TbLockOpen, TbArrowBarRight } from "solid-icons/tb";
import { type Mood } from "@components/playgrounds/pardon/PardonPlaygroundMood";
import { iconSize } from "@components/pardon-shared.ts";
import { type ExecutionHandle } from "@components/playgrounds/pardon/pardon-playground-shared";
import PardonPlaygroundRenderMood from "@components/playgrounds/pardon/PardonPlaygroundRenderMood";
import { useSecretsSignal } from "@components/playgrounds/pardon/PardonPlaygroundSecretsSignalContext";

export default function PardonPlaygroundRenderView(
  props: ParentProps<{
    executionHandle: ExecutionHandle;
    onRequest?: () => void;
    inflight?: boolean;
    secretsRef?: Setter<boolean>;
  }> &
    ComponentProps<"div">,
) {
  const { secrets, setSecrets, enabled: secretsEnabled } = useSecretsSignal();
  const [mood, setMood] = createSignal<Mood>("confused");

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
          error,
        };
      }

      try {
        const render = await execution.outbound;

        return {
          render: {
            request: HTTP.stringify({ ...render.request, values: undefined }),
            redacted: HTTP.stringify({ ...render.redacted, values: undefined }),
          },
        };
      } catch (error) {
        return {
          render: undefined,
          error,
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

  return (
    <CodeMirror
      icon={
        <div
          class="icon-grid"
          classList={{
            "icon-grid-col": (output()?.split("\n").length ?? 0) < 3,
          }}
        >
          <Show when={props.onRequest}>
            <button
              class="-m-1 rounded-md border-none bg-transparent p-1 leading-none transition-transform hover:rotate-12 hover:bg-yellow-200 dark:hover:bg-fuchsia-900"
              onClick={() => {
                props.onRequest?.();
              }}
            >
              <span
                classList={{
                  pulse: props.inflight,
                }}
              >
                <TbArrowBarRight size={iconSize} />
              </span>
            </button>
          </Show>
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
                fallback={<TbLock color="gray" size={iconSize} />}
              >
                <TbLockOpen color="gray" size={iconSize} />
              </Show>
            </button>
          </Show>
          <PardonPlaygroundRenderMood
            executionHandle={props.executionHandle}
            moodRef={setMood}
          />
        </div>
      }
      value={output()}
      readonly={true}
      class={
        "rounded-md bg-neutral-200 p-2 shadow outline-gray-500 dark:bg-fuchsia-950"
      }
      classList={{
        [props.class ?? ""]: true,
        ...props.classList,
        "opacity-50": Boolean(pardon()?.error || mood() === "thinking"),
      }}
    />
  );
}
