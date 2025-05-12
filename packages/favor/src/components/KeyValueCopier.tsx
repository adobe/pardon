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

import { JSON, KV } from "pardon/formats";
import {
  ComponentProps,
  For,
  splitProps,
  JSX,
  createSignal,
  Accessor,
  untrack,
  createEffect,
  on,
  Show,
  Setter,
  createMemo,
} from "solid-js";
import { twMerge } from "tailwind-merge";
import CodeMirror, { EditorView } from "./codemirror/CodeMirror.tsx";
import { cursorDocEnd } from "@codemirror/commands";
import { arrayIntoObject } from "pardon/utils";

export type KvEntry = readonly [string, unknown, string?];

export type KvCopierControl = {
  data: Accessor<KvEntry[]>;
  setData: Setter<KvEntry[]>;
  addValues(kv: Record<string, unknown>): void;
  getValues(): Record<string, unknown>;
  containsDatum(transfer: DataTransfer): boolean;
  drag(transfer: DataTransfer): boolean;
  drop(transfer: DataTransfer): true | void;
  deleteDatum(transfer: DataTransfer): void;
  deleteAll(): void;
  flushEditor?(): void;
};

type KeyValueCopierContext = ReturnType<typeof makeKeyValueCopierContext>;

export function makeKeyValueCopierContext({
  initial = [],
  dedup = false,
}: { initial?: KvEntry[]; dedup?: boolean } = {}) {
  const source = crypto.randomUUID();
  const [data, setData] = createSignal<KvEntry[]>(initial);

  function addValues(kv: Record<string, unknown>) {
    setData((data) => {
      const updated = new Set<string>();

      data = data.map((entry) => {
        if (!dedup) {
          return entry;
        }
        const value = kv[entry[0]];
        if (value !== undefined) {
          updated.add(entry[0]);
          return [entry[0], value, entry[2]] as KvEntry;
        }
        return entry;
      });

      return [
        ...data,
        ...Object.entries(kv ?? {})
          .filter(([k]) => !updated.has(k))
          .map(([k, v]) => [k, v, crypto.randomUUID()] as KvEntry),
      ];
    });
  }

  function containsDatum(transfer: DataTransfer) {
    const info = parseId(transfer);

    return (
      source === info?.source &&
      Boolean(data().find(([, , id]) => id == info.id))
    );
  }

  const controls: KvCopierControl = {
    data,
    setData,
    addValues,
    getValues: createMemo(() =>
      arrayIntoObject(data(), ([k, v]) => ({ [k]: v })),
    ),
    deleteDatum(transfer: DataTransfer) {
      const info = parseId(transfer);
      if (info?.source !== source) {
        return;
      }

      setData((data) => data.filter(([, , id]) => id != info.id));
    },
    containsDatum,
    deleteAll() {
      setData([]);
    },
    drag(dataTransfer) {
      return dataTransfer.types.some((type) =>
        ["text/value", "text/plain"].includes(type),
      );
    },
    drop(dataTransfer) {
      const kvData = dataTransfer.getData("text/value");

      if (kvData) {
        if (containsDatum(dataTransfer)) {
          return;
        }

        const data = KV.parse(kvData, "object");

        addValues(data);
        return true;
      }

      const data = dataTransfer.getData("text/plain");
      try {
        addValues(KV.parse(data, "object"));
        return;
      } catch (error) {
        void error;
        // continue
      }

      try {
        const json = JSON.parse(data);
        if (typeof json === "object") {
          addValues(json);
        }
      } catch (error) {
        void error;
        // continue
      }
    },
  };

  return {
    addValues,
    data,
    setData,
    containsDatum,
    controls,
    source,
  };
}

export default function KeyValueCopier(
  props: Omit<ComponentProps<"div">, "children"> & {
    initialData?: KvEntry[];
    readonly?: boolean;
    noIcon?: boolean;
    editor?: boolean;
    values?: Record<string, unknown>;
    target?: boolean;
    dedup?: boolean;
    trash?: boolean;
    init?(
      copier: KvCopierControl,
    ): Omit<Partial<ComponentProps<"div">>, "children">;
    controls?(controls: KvCopierControl): void;
    children?: JSX.Element | { (copier: KvCopierControl): JSX.Element };
  },
) {
  const [, restProps] = splitProps(props, [
    "initialData",
    "readonly",
    "values",
    "controls",
  ]);

  const context = makeKeyValueCopierContext({
    initial: props.initialData,
    dedup: props.dedup,
  });

  const { setData, addValues, controls } = context;

  props.controls?.(controls);

  if (props.readonly) {
    createEffect(
      on(
        () => props.values,
        (values) => {
          if (values) {
            setData([]);
            addValues(values);
          }
        },
      ),
    );
  } else {
    addValues(props.values ?? {});
  }

  return <KeyValueCopierWidget {...restProps} context={context} />;
}

export function KeyValueCopierWidget(
  props: Omit<ComponentProps<"div">, "children"> & {
    context: KeyValueCopierContext;
    noIcon?: boolean;
    editor?: boolean;
    target?: boolean;
    dedup?: boolean;
    trash?: boolean;
    children?: JSX.Element | { (copier: KvCopierControl): JSX.Element };
  },
) {
  const [, divProps] = splitProps(props, ["context", "children"]);

  const { source, data, controls } = untrack(() => props.context);

  createEffect(
    on(
      () => props.editor,
      (editor) => {
        if (!editor) {
          delete controls.flushEditor;
        }
      },
    ),
  );

  const { setData, addValues, deleteDatum, deleteAll } = controls;

  return (
    <div
      {...divProps}
      class={twMerge(
        "relative flex flex-col [line-height:1.4] [&:has(.copyable-object>.key:hover,.copyable-value:hover,.variable>.key:hover)>.copy-icon]:opacity-50",
        props.class,
      )}
      classList={props.classList}
      onDragOver={(event) => {
        if (controls.drag(event.dataTransfer)) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        controls.drop(event.dataTransfer);
        event.preventDefault();
      }}
    >
      <div class="flex flex-1 flex-col overflow-auto whitespace-pre">
        <For each={data()}>
          {([key, value, id]) => (
            <div class="font-mono whitespace-pre" onClick={() => {}}>
              <KeyValueCopierNode
                id={id + "/" + source}
                tokens={KV.tokenize(
                  KV.stringify(
                    { [key]: value },
                    { indent: 2, trailer: "", limit: 50 },
                  ).trim(),
                )}
              />
            </div>
          )}
        </For>
        <Show when={props.editor}>
          {createMemo(() => {
            const [newData, setNewData] = createSignal("");

            const [editorView, setEditorView] = createSignal<EditorView>();

            function flushEditor() {
              const {
                [KV.eoi]: _eoi,
                [KV.unparsed]: remainder,
                [KV.upto]: _upto,
                ...data
              } = KV.parse(newData(), "stream");

              addValues(data);

              setNewData(remainder?.trimEnd() ?? "");
            }

            controls.flushEditor = flushEditor;

            return (
              <CodeMirror
                class="min-h-8 rounded-md bg-neutral-300/70 dark:bg-neutral-700/70"
                editorViewRef={setEditorView}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !newData().trim()) {
                    let lastEntry: KvEntry;
                    setData((data) => {
                      lastEntry = data.slice(-1)[0];
                      return data.slice(0, -1);
                    });

                    setNewData(
                      KV.stringify({
                        [lastEntry[0]]: lastEntry[1],
                      }),
                    );

                    cursorDocEnd(editorView());
                    event.preventDefault();

                    return;
                  }

                  if (event.key !== "Enter") {
                    return;
                  }

                  try {
                    flushEditor();
                    event.preventDefault();
                  } catch (ex) {
                    console.warn("error parsing kv scratch data", ex);
                    void ex;
                  }
                }}
                readwrite
                value={newData()}
                onValueChange={setNewData}
                onDragOver={(event) => {
                  if (newData().trim()) {
                    event.stopImmediatePropagation();
                    return;
                  }

                  if (event.dataTransfer.types.includes("text/value")) {
                    event.preventDefault();
                    event.target.classList.add("drop");
                  }
                }}
                onDrop={(event) => {
                  deleteDatum(event.dataTransfer);

                  setNewData((newData) =>
                    [
                      newData,
                      event.dataTransfer.getData("text/value") ??
                        event.dataTransfer.getData("text/plain") ??
                        "",
                    ]
                      .map((s) => s?.trim())
                      .filter(Boolean)
                      .join(" "),
                  );
                  event.stopPropagation();
                }}
              ></CodeMirror>
            );
          })()}
        </Show>
        {typeof props.children === "function"
          ? props.children?.(controls)
          : props.children}
      </div>

      <Show when={props.trash ?? props.editor}>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-1 flex place-content-center opacity-100 transition-opacity duration-700"
          classList={{
            "!opacity-0": data().length == 0,
          }}
        >
          <button
            class="pointer-events-auto flex-0 p-1 transition-colors duration-300 hover:bg-fuchsia-300 dark:hover:bg-pink-500 [&.drop]:!bg-fuchsia-300 [&.drop]:dark:!bg-pink-500"
            classList={{
              "!pointer-events-none": data().length == 0,
            }}
            onClick={() => deleteAll()}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("text/value")) {
                event.preventDefault();
                event.target.classList.add("drop");
              }
            }}
            onDragEnter={function (event) {
              event.target.classList.add("drop");
            }}
            onDragLeave={function (event) {
              event.target.classList.remove("drop");
            }}
            onDrop={(event) => {
              deleteDatum(event.dataTransfer);

              // eat the event to prevent reapplying the value.
              event.preventDefault();
              event.stopPropagation();
              event.target.classList.remove("drop");
            }}
          >
            <IconTablerTrash class="pointer-events-none" />
          </button>
        </div>
      </Show>
      <Show when={!props.noIcon}>
        <span class="copy-icon absolute top-[50%] right-1 flex translate-y-[-50%] rounded-lg border-1 p-1 text-xl opacity-0 transition-opacity duration-150 dark:bg-neutral-600">
          <IconTablerCopy />
        </span>
        <span class="value-icon absolute top-[50%] right-1 flex translate-y-[-50%] rounded-lg border-1 p-1 text-xl opacity-0 transition-opacity duration-150 dark:bg-neutral-600">
          <IconTablerPlus />
        </span>
      </Show>
    </div>
  );
}

function KeyValueCopierNode(props: {
  id?: string;
  tokens: { token: string; span?: number; key?: string; value?: unknown }[];
}) {
  const [key, ...eqvalue] = props.tokens;
  const nodes = [];
  for (let i = 0; i < eqvalue.length; i++) {
    const { span } = eqvalue[i];
    if (!span) {
      nodes.push(eqvalue[i]);
    } else {
      nodes.push(eqvalue.slice(i, i + span + 1));
      i += span;
    }
  }

  if (key.token === "[" || key.token === "{") {
    return (
      <span class="copyable-object [&>.key:hover]:cursor-crosshair [&>.key:hover]:text-green-500 [&>.key:hover+.value]:text-green-500">
        <span
          class="key"
          onClick={() => {
            window.navigator.clipboard.writeText(JSON.stringify(key.value));
          }}
        >
          {key.token}
        </span>
        <span class="value">
          <For each={nodes as (typeof key | (typeof key)[])[]}>
            {(node) =>
              Array.isArray(node) ? (
                <KeyValueCopierNode tokens={node} />
              ) : ["}", "]"].includes(node.token) ? (
                node.token
              ) : (
                <span
                  class="copyable-value hover:cursor-crosshair hover:text-green-500"
                  onClick={() => {
                    window.navigator.clipboard.writeText(node.token);
                  }}
                >
                  {node.token}
                </span>
              )
            }
          </For>
        </span>
      </span>
    );
  }

  return (
    <span class="variable [&>.key:hover]:cursor-pointer [&>.key:hover]:text-orange-300 [&>.key:hover+.value]:text-orange-300">
      <span
        class="key"
        role="button"
        draggable="true"
        data-corvu-no-drag
        onDragStart={(event) => {
          event.dataTransfer.setData(
            "text/value",
            KV.stringify({ [key.key]: key.value }),
          );

          if (props.id) {
            event.dataTransfer.setData("text/kv-id", props.id);
          }
        }}
        onClick={() => {
          window.navigator.clipboard.writeText(
            KV.stringify({ [key.key]: key.value }),
          );
        }}
      >
        {key.token}
      </span>
      <span class="value">
        <For each={nodes}>
          {(node) =>
            Array.isArray(node) ? (
              <KeyValueCopierNode tokens={node} />
            ) : node.token === "=" ? (
              <>{node.token}</>
            ) : (
              <span
                class="copyable-value cursor-crosshair hover:text-green-500"
                role="button"
                onClick={() => {
                  window.navigator.clipboard.writeText(node.value);
                }}
              >
                {node.token}
              </span>
            )
          }
        </For>
      </span>
    </span>
  );
}

function parseId(transfer: DataTransfer) {
  const idAndSource = transfer.getData("text/kv-id")?.split("/", 2);
  if (!idAndSource) return {};
  const [id, source] = idAndSource;
  return {
    id,
    source,
  };
}
