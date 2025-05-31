import {
  Show,
  batch,
  createEffect,
  createSignal,
  untrack,
  type ParentProps,
} from "solid-js";
import CodeMirror, { EditorView } from "@components/codemirror/CodeMirror.tsx";

import { usePardonApplicationContext } from "@components/playgrounds/pardon/PardonApplication";
import { TbPencil } from "solid-icons/tb";
import { iconSize } from "@components/pardon-shared.ts";
import { ProductsServerExecution } from "@components/products-server-hook";
import { TodoServerExecution } from "@components/todo-server-hook";
import {
  createExecutionMemo,
  type PlaygroundOptions,
} from "@components/playgrounds/pardon/pardon-playground-shared";
import PardonPlaygroundDataView from "@components/playgrounds/pardon/PardonPlaygroundDataView";
import PardonPlaygroundResponseView from "@components/playgrounds/pardon/PardonPlaygroundResponseView";
import PardonPlaygroundMood from "@components/playgrounds/pardon/PardonPlaygroundMood";
import SecretsSignalContext from "@components/playgrounds/pardon/PardonPlaygroundSecretsSignalContext";
import ResponseSignalContext from "@components/playgrounds/pardon/PardonPlaygroundResponseSignalContext";
import { NullServerExecution } from "@components/null-server-hook.ts";
import { KV } from "pardon/playground";
import { mapObject } from "pardon/utils";

export default function PardonPlayground(
  props: ParentProps<{
    options: PlaygroundOptions;
    id?: string;
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

  const [display, setDisplay] = createSignal(input());

  createEffect(() => setDisplay(input()));

  const [restart, setRestart] = createSignal<object>({});

  const executionHandle = createExecutionMemo({
    context,
    execution:
      {
        products: ProductsServerExecution,
        todo: TodoServerExecution,
        null: NullServerExecution,
      }[server ?? "null"] ?? NullServerExecution,
    input,
    restart,
  });

  const [inputEditorView, setInputEditorView] = createSignal<EditorView>();

  const [displayUpdate, setDisplayUpdate] = createSignal(false);

  function setDisplayOrInput(value: string) {
    if (displayUpdate()) {
      setDisplay(value);
      return;
    }

    setInput(value);
  }

  function update(
    value: string,
    { clear, display }: { clear: string[]; display?: boolean },
  ) {
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
        mapObject(
          { ...kv, ...values },
          { filter: (key) => !clear.includes(key) },
        ),
        { indent: 2, trailer: updatedHttp ? "\n" : "" },
      ) + (updatedHttp?.trim() ?? "");

    batch(() => {
      if (display) {
        setDisplayUpdate(true);
      }
      try {
        view.dispatch([
          view.state.update({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: result,
            },
          }),
        ]);
      } finally {
        if (display) {
          setDisplayUpdate(false);
        }
      }
    });
  }

  return (
    <SecretsSignalContext secrets={secrets ? secrets === "shown" : undefined}>
      <ResponseSignalContext>
        <div
          id={props.id}
          class="not-content pp-app grid gap-2"
          data-pardon-playground
          ref={(element) => {
            (element as any).pardonPlayground = {
              update,
            };
          }}
        >
          {props.children}
          <CodeMirror
            icon={
              <div
                class="icon-grid"
                classList={{
                  "icon-grid-col": (display()?.split("\n").length ?? 0) < 4,
                }}
              >
                <TbPencil color="gray" size={iconSize} />
                <Show when={props.options.response}>
                  <PardonPlaygroundMood executionHandle={executionHandle} />
                </Show>
              </div>
            }
            class="rounded-md bg-yellow-100 p-2 shadow dark:bg-gray-700"
            value={untrack(display)}
            editorViewRef={setInputEditorView}
            onValueChange={setDisplayOrInput}
          />
          <PardonPlaygroundResponseView
            executionHandle={executionHandle}
            reset={() => setRestart({})}
            update={(values) => {
              if (Object.keys(values).length > 0) {
                update(KV.stringify(values), { clear: [], display: true });
              }
            }}
          />
          <Show when={props.options.data}>
            <PardonPlaygroundDataView executionHandle={executionHandle} />
          </Show>
        </div>
      </ResponseSignalContext>
    </SecretsSignalContext>
  );
}
