import { Show, createSignal, untrack, type ParentProps } from "solid-js";
import CodeMirror, { EditorView } from "@components/codemirror/CodeMirror.tsx";

import { usePardonApplicationContext } from "@components/playgrounds/pardon/PardonApplication";
import { TbPencil } from "solid-icons/tb";
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

  const { server, secrets } = props.options;

  const [input, setInput] = createSignal(
    (initialContext.application.example?.request || "").trim(),
  );

  const [restart, setRestart] = createSignal<object>({});

  const executionHandle = createExecutionMemo({
    context,
    execution:
      server === "products" ? ProductsServerExecution : NullServerExecution,
    input,
    restart,
  });

  const [inputEditorView, setInputEditorView] = createSignal<EditorView>();

  return (
    <SecretsSignalContext secrets={secrets ? secrets === "shown" : undefined}>
      <ResponseSignalContext>
        <div
          class="not-content pp-app grid gap-2"
          data-pardon-playground
          ref={(element) => {
            (element as any).pardonPlayground = {
              update(value: string, mode?: string) {
                const view = inputEditorView()!;

                const doc = view.state.doc.toString();
                const {
                  [KV.unparsed]: rest,
                  [KV.eoi]: _eoi,
                  [KV.upto]: _upto,
                  ...kv
                } = KV.parse(doc, "stream");

                const {
                  [KV.unparsed]: http,
                  [KV.eoi]: _eoi_,
                  [KV.upto]: _upto_,
                  ...values
                } = KV.parse(value, "stream");

                const updatedHttp = http?.trim() || rest?.trim();
                const result =
                  KV.stringify(
                    { ...kv, ...values },
                    { indent: 2, trailer: updatedHttp ? "\n" : "" },
                  ) + (updatedHttp?.trim() ?? "");

                view.dispatch([
                  view.state.update({
                    changes: {
                      from: 0,
                      to: view.state.doc.length,
                      insert: result,
                    },
                  }),
                ]);
              },
            };
          }}
        >
          {props.children}
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
            class="rounded-md bg-yellow-100 p-2 shadow dark:bg-gray-700"
            value={untrack(input)}
            editorViewRef={setInputEditorView}
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
