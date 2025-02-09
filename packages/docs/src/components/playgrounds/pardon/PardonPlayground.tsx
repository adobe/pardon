import { Show, createSignal, untrack, type ParentProps } from "solid-js";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

import { usePardonApplicationContext } from "@components/playgrounds/pardon/PardonApplication";
import { TbMoodConfuzed, TbPencil, TbSettings } from "solid-icons/tb";
import { iconSize } from "@components/pardon-shared.ts";
import { ProductsServerExecution } from "@components/products-server-hook.ts";
import {
  createExecutionMemo,
  type PlaygroundOptions,
} from "@components/playgrounds/pardon/pardon-playground-shared";
import PardonPlaygroundRenderView from "@components/playgrounds/pardon/PardonPlaygroundRenderView";
import PardonPlaygroundDataView from "@components/playgrounds/pardon/PardonPlaygroundDataView";
import PardonPlaygroundResponseView from "@components/playgrounds/pardon/PardonPlaygroundResponseView";
import PardonPlaygroundPreviewMood from "@components/playgrounds/pardon/PardonPlaygroundPreviewMood";
import SecretsSignalContext from "@components/playgrounds/pardon/PardonPlaygroundSecretsSignalContext";
import ResponseSignalContext from "@components/playgrounds/pardon/PardonPlaygroundResponseSignalContext";
import { NullServerExecution } from "@components/null-server-hook.ts";
import { KV } from "pardon/playground";

export default function PardonPlayground(
  props: ParentProps<{
    options: PlaygroundOptions;
  }>,
) {
  const context = usePardonApplicationContext()!;

  const initialContext = untrack(context);
  if ("error" in initialContext) {
    throw new Error("invalid initial application context", {
      cause: initialContext.error,
    });
  }

  const { values, server, secrets } = props.options;
  const initial = values === true ? "" : values || "";

  const [env, setEnv] = createSignal(KV.parse(initial, "object"));
  const [input, setInput] = createSignal(
    (initialContext.application.example?.request || "").trim(),
  );

  const [restart, setRestart] = createSignal<object>({});

  const executionHandle = createExecutionMemo({
    context,
    env,
    execution:
      server === "products" ? ProductsServerExecution : NullServerExecution,
    input,
    restart,
  });

  const [valuesError, setValuesError] = createSignal();

  return (
    <SecretsSignalContext secrets={secrets ? secrets === "shown" : undefined}>
      <ResponseSignalContext>
        <div class="not-content pp-app grid gap-2">
          {props.children}
          <Show when={props.options.values}>
            <CodeMirror
              icon={
                <div class="icon-grid icon-grid-col">
                  <TbSettings color="gray" size={iconSize} />
                  <Show when={valuesError()}>
                    <TbMoodConfuzed color="gray" size={iconSize} />
                  </Show>
                </div>
              }
              class="rounded-md bg-white p-2 shadow dark:bg-gray-700"
              value={initial}
              onValueChange={(value) => {
                try {
                  setEnv(KV.parse(value, "object"));
                  setValuesError(undefined);
                } catch (error) {
                  setValuesError(error);
                }
              }}
            />
          </Show>
          <CodeMirror
            icon={
              <div
                class="icon-grid"
                classList={{
                  "icon-grid-col": (input()?.split("\n").length ?? 0) < 4,
                }}
              >
                <TbPencil color="gray" size={iconSize} />
                <Show when={props.options.response}>
                  <PardonPlaygroundPreviewMood
                    executionHandle={executionHandle}
                  />
                </Show>
              </div>
            }
            class="rounded-md bg-white p-2 shadow dark:bg-gray-700"
            value={untrack(input)}
            onValueChange={setInput}
          />
          <Show
            when={props.options.response}
            fallback={
              <PardonPlaygroundRenderView executionHandle={executionHandle} />
            }
          >
            <PardonPlaygroundResponseView
              executionHandle={executionHandle}
              reset={() => setRestart({})}
            />
          </Show>
          <Show when={props.options.data}>
            <PardonPlaygroundDataView executionHandle={executionHandle} />
          </Show>
        </div>
      </ResponseSignalContext>
    </SecretsSignalContext>
  );
}
