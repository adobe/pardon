import { HTTP } from "pardon";
import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  untrack,
  type Accessor,
  type ParentProps,
} from "solid-js";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

import { TbLock, TbLockOpen, TbArrowBarDown } from "solid-icons/tb";
import { iconSize } from "@components/pardon-shared.ts";
import {
  deferred,
  type ExecutionHandle,
} from "@components/playgrounds/pardon/pardon-playground-shared";
import PardonPlaygroundRenderView from "@components/playgrounds/pardon/PardonPlaygroundRenderView";
import { useSecretsSignal } from "@components/playgrounds/pardon/PardonPlaygroundSecretsSignalContext";
import { useResponseSignal } from "@components/playgrounds/pardon/PardonPlaygroundResponseSignalContext";

export default function PardonPlaygroundResponseView(
  props: ParentProps<{
    executionHandle: ExecutionHandle;
    reset: () => void;
  }>,
) {
  const { secrets, setSecrets, enabled: secretsEnabled } = useSecretsSignal();
  const [, setOutflight] = useResponseSignal();

  const [progressSignal, setProgressSignal] = createSignal<
    Accessor<{
      inflight: boolean;
      gate: ReturnType<typeof deferred<void>> | undefined;
    }>
  >(() => ({
    inflight: false,
    gate: undefined,
  }));
  const inflight = createMemo(() => progressSignal()().inflight);
  const gate = createMemo(() => progressSignal()().gate);

  const [execution] = createResource(
    () => ({ executionHandle: props.executionHandle() }),
    async ({ executionHandle }) => {
      const [inflight, setInflight] = createSignal(false);
      const [gate, setGate] = createSignal<ReturnType<typeof deferred<void>>>();

      setProgressSignal(() =>
        createMemo(() => ({
          inflight: inflight(),
          gate: gate(),
        })),
      );

      setInflight(false);

      if ("error" in executionHandle) {
        return {
          error: new Error("invalid application context", {
            cause: executionHandle.error,
          }),
        };
      }

      const { execution } = executionHandle;
      try {
        await execution.outbound;
      } catch (error) {
        return { error };
      }

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const gateDeferred = deferred<void>();
      setGate(gateDeferred);

      await gateDeferred.promise;
      setInflight(true);

      try {
        return {
          pardon: {
            result: await execution.result,
            execution,
          },
        };
      } catch (error) {
        return {
          error,
        };
      }
    },
  );

  const [pardonResult, setPardonResult] =
    createSignal<Partial<ReturnType<typeof execution>>>();

  createEffect(() => {
    setPardonResult((previous) => {
      if (execution.state === "pending") {
        return {} as { process?: undefined };
      }

      const error = execution.latest?.error;

      const pardon = execution.latest?.pardon ?? previous?.pardon;

      return {
        pardon,
        error,
      } as any;
    });
  });

  function reset() {
    props.reset?.();
    setPardonResult({});
  }

  const output = createMemo(() => {
    const result = pardonResult()?.pardon?.result;
    return secretsEnabled && secrets()
      ? result && HTTP.responseObject.stringify(result.inbound.response)
      : result && HTTP.responseObject.stringify(result.inbound.redacted);
  });

  createEffect(() => setOutflight(pardonResult()?.pardon));

  return (
    <div>
      <Show
        when={output()}
        fallback={
          <PardonPlaygroundRenderView
            executionHandle={props.executionHandle}
            onRequest={() => {
              untrack(gate)?.resolution.resolve();
            }}
            inflight={inflight()}
          />
        }
      >
        <CodeMirror
          icon={
            <div
              class="icon-grid"
              classList={{
                "icon-grid-col": (() => {
                  return (output()?.trim()?.split("\n").length ?? 0) < 3;
                })(),
              }}
            >
              <button
                onclick={reset}
                class="-m-1 rounded-md border-none bg-transparent p-1 leading-none transition-transform rotate-0 hover:bg-emerald-100 hover:-rotate-12 dark:hover:bg-lime-900"
              >
                <TbArrowBarDown size={iconSize} />
              </button>
              <Show when={secretsEnabled}>
                <button
                  class="-m-1 rounded-md border-none bg-transparent p-1 leading-none hover:bg-emerald-100 dark:hover:bg-lime-900"
                  onmousedown={() =>
                    secretsEnabled &&
                    setSecrets((value) => {
                      return !value;
                    })
                  }
                >
                  <Show
                    when={secrets()}
                    fallback={<TbLock color="gray" size={iconSize} />}
                  >
                    <TbLockOpen color="gray" size={iconSize} />
                  </Show>
                </button>
              </Show>
            </div>
          }
          value={output()?.trim()}
          readonly
          class="h-full max-h-48 overflow-y-auto rounded-md bg-emerald-200 p-2 shadow outline-gray-500 dark:bg-lime-800"
        />
      </Show>
    </div>
  );
}
