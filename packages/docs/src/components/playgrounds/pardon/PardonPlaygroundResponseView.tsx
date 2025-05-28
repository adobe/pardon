import { HTTP } from "pardon";
import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  untrack,
  type Accessor,
  type ParentProps,
} from "solid-js";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

import {
  deferred,
  type ExecutionHandle,
} from "@components/playgrounds/pardon/pardon-playground-shared";
import PardonPlaygroundRenderView from "@components/playgrounds/pardon/PardonPlaygroundRenderView";
import { useSecretsSignal } from "@components/playgrounds/pardon/PardonPlaygroundSecretsSignalContext";
import { useResponseSignal } from "@components/playgrounds/pardon/PardonPlaygroundResponseSignalContext";
import { intoURL } from "pardon/formats";
import { TbRefresh } from "solid-icons/tb";

export type FlightStatus = "pending" | "inflight" | "done";

export default function PardonPlaygroundResponseView(
  props: ParentProps<{
    executionHandle: ExecutionHandle;
    reset(): void;
    update(values: Record<string, any>): void;
  }>,
) {
  const { secrets, setSecrets, enabled: secretsEnabled } = useSecretsSignal();
  const [, setOutflight] = useResponseSignal();

  const [progressSignal, setProgressSignal] = createSignal<
    Accessor<{
      inflight: FlightStatus;
      gate: ReturnType<typeof deferred<void>> | undefined;
    }>
  >(() => ({
    inflight: "pending",
    gate: undefined,
  }));
  const inflight = createMemo(() => progressSignal()().inflight);
  const gate = createMemo(() => progressSignal()().gate);

  const [outbound] = createResource(
    () => ({ executionHandle: props.executionHandle() }),
    async ({ executionHandle: { execution, error } }) => {
      try {
        if (error) return { error } as unknown as Awaited<typeof outbound>;
        const outbound = await execution?.outbound;

        return outbound;
      } catch (error) {
        return { error } as any;
      }
    },
  );

  const [execution] = createResource(
    () => ({ executionHandle: props.executionHandle() }),
    async ({ executionHandle }) => {
      const [inflight, setInflight] = createSignal<FlightStatus>("pending");
      const [gate, setGate] = createSignal<ReturnType<typeof deferred<void>>>();

      setProgressSignal(() =>
        createMemo(() => ({
          inflight: inflight(),
          gate: gate(),
        })),
      );

      setInflight("pending");

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
      setInflight("inflight");

      try {
        const result = await execution.result;

        return {
          pardon: {
            result,
            execution,
          },
        };
      } catch (error) {
        return {
          error,
        };
      } finally {
        setInflight("done");
      }
    },
  );

  const [pardonResult, setPardonResult] =
    createSignal<Partial<ReturnType<typeof execution>>>();

  createEffect(
    on(
      () => execution.state,
      (state) => {
        setPardonResult((previous) => {
          if (state === "pending" || state === "refreshing") {
            return {} as { process?: undefined };
          }

          const error = execution.latest?.error;

          const pardon = execution.latest?.pardon ?? previous?.pardon;

          if (state === "ready" && execution.latest?.pardon) {
            const { output } = pardon!.result;
            props.update(output);
          }

          return {
            pardon,
            error,
          } as any;
        });
      },
    ),
  );

  function reset() {
    setPardonResult(() => ({}));
    props.reset?.();
  }

  const result = createMemo(() => {
    const result = pardonResult()?.pardon?.result;

    return (
      result &&
      (secretsEnabled && secrets()
        ? HTTP.responseObject.stringify(result.inbound.response)
        : HTTP.responseObject.stringify(result.inbound.redacted))
    );
  });

  createEffect(() => {
    setOutflight(pardonResult()?.pardon);
  });

  const currentMethod = createMemo(() =>
    outbound.latest?.error
      ? "error"
      : (outbound.latest?.redacted?.method ?? "GET"),
  );

  return (
    <>
      <PardonPlaygroundRenderView
        executionHandle={props.executionHandle}
        inflight={inflight()}
        class="mb-2"
        reset={reset}
      />
      <div class="flex flex-row gap-2">
        <button
          class="light:border-purple-800 flex-1 rounded-xl border-2 p-2 pl-4 text-left !font-mono text-xl !font-extrabold shadow-md active:shadow-sm enabled:cursor-pointer dark:border-white dark:shadow-amber-200/25"
          classList={{
            "light:bg-teal-400 dark:bg-teal-800": ![
              "POST",
              "PUT",
              "DELETE",
            ].includes(currentMethod()),
            "light:bg-amber-400 dark:bg-yellow-800": ["POST", "PUT"].includes(
              currentMethod(),
            ),
            "light:bg-red-400 dark:bg-red-800": ["DELETE"].includes(
              currentMethod(),
            ),
          }}
          on:click={() => untrack(gate)?.resolution.resolve()}
        >
          {outbound.latest?.error ? (
            <>...</>
          ) : (
            <>
              {outbound.latest?.redacted?.method}{" "}
              {String(intoURL(outbound.latest?.redacted ?? "none"))}
            </>
          )}
        </button>
        <button
          class="light:bg-gray-300 light:disabled:text-gray-400 aspect-square rounded-xl border-2 border-gray-600 p-2 shadow-md active:shadow-sm enabled:cursor-pointer dark:bg-gray-500 dark:disabled:bg-neutral-700 [:not(:disabled)]:active:bg-gray-500"
          on:click={reset}
          disabled={execution.loading}
        >
          <TbRefresh size={30} />
        </button>
      </div>
      <Show when={result()}>
        <CodeMirror
          icon={
            <div
              class="icon-grid"
              classList={{
                "icon-grid-col": (() => {
                  return (result()?.trim()?.split("\n").length ?? 0) < 3;
                })(),
              }}
            >
              <Show when={secretsEnabled}>
                <button
                  class="-m-1 rounded-md border-none bg-transparent p-1 leading-none hover:bg-emerald-100 dark:hover:bg-lime-900"
                  onMouseDown={() =>
                    secretsEnabled &&
                    setSecrets((value) => {
                      return !value;
                    })
                  }
                ></button>
              </Show>
            </div>
          }
          value={result()?.trim()}
          readonly
          class="h-full overflow-y-auto rounded-md bg-emerald-200 p-2 shadow outline-gray-500 dark:bg-lime-800"
        />
      </Show>
    </>
  );
}
