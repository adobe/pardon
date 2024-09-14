/*
Copyright 2024 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

import {
  createCodeMirror,
  createEditorControlledValue,
  type CreateCodeMirrorProps,
} from "solid-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import {
  createEffect,
  splitProps,
  Show,
  type ComponentProps,
  type JSX,
  createMemo,
  Accessor,
} from "solid-js";

import { twMerge } from "tailwind-merge";

export { EditorView, EditorState };

export type CreateExtensionFn = ReturnType<
  typeof createCodeMirror
>["createExtension"];

export type CodeMirrorProps = CreateCodeMirrorProps & {
  readonly?: boolean;
  readwrite?: boolean;
  tabbing?: boolean | number | `${number}`;
  editorViewRef?: (view: EditorView) => void;
  setup?: (props: {
    createExtension: CreateExtensionFn;
    editorView: Accessor<EditorView>;
  }) => void;
  icon?: JSX.Element;
  text?: string;
  nowrap?: boolean;
} & ComponentProps<"div">;

const EnterNewlines = keymap.of([
  {
    key: "Enter",
    preventDefault: true,
    run({ state, dispatch }) {
      dispatch(state.update(state.replaceSelection("\n")));
      return true;
    },
  },
  {
    key: "Shift-Enter",
    preventDefault: true,
    run({ state, dispatch }) {
      dispatch(state.update(state.replaceSelection("\n")));
      return true;
    },
  },
]);

function EnterTabs(indent: number) {
  const tab = " ".repeat(indent);

  return keymap.of([
    {
      key: "Tab",
      preventDefault: true,
      run({ state, dispatch }) {
        dispatch(state.update(state.replaceSelection(tab)));
        return true;
      },
    },
  ]);
}

export default function CodeMirror(props: CodeMirrorProps) {
  const [codemirrorProps, , restprops] = splitProps(
    props,
    ["value", "onModelViewUpdate", "onTransactionDispatched", "onValueChange"],
    ["editorViewRef", "setup", "readonly", "icon"],
  );

  const { editorView, ref, createExtension } =
    createCodeMirror(codemirrorProps);

  createExtension(
    createMemo(() => (!props.nowrap ? EditorView.lineWrapping : undefined)),
  );

  createExtension(
    createMemo(() =>
      props.tabbing
        ? Prec.high(
            EnterTabs(props.tabbing === true ? 2 : Number(props.tabbing)),
          )
        : undefined,
    ),
  );

  createExtension(Prec.high(EnterNewlines));

  createExtension([history(), keymap.of(historyKeymap)]);
  createExtension([
    search(), // TODO: make search panel pretty ( https://github.com/solidjs/solid/discussions/1755 )
    keymap.of(searchKeymap),
  ]);

  createExtension(() =>
    EditorView.theme({
      "&.cm-editor.cm-focused": {
        outline: "none",
      },
      ".cm-content": {
        caretColor: "var(--text1)",
        fontSize: props.text ?? "12pt",
        fontFamily: '"Source Code Pro", "Consolas", monospace',
      },
    }),
  );

  createEditorControlledValue(
    createMemo(() => {
      if (props.readwrite || props.readonly) {
        return editorView();
      }
    }),
    createMemo(() => props.value ?? ""),
  );

  createExtension(() =>
    props.readonly ? EditorState.readOnly.of(true) : undefined,
  );

  createEffect(() => {
    props.editorViewRef?.(editorView?.());
  });

  props.setup?.({ createExtension, editorView });

  return (
    <div
      ref={ref}
      {...restprops}
      class={twMerge("overflow-hidden [&_.cm-editor]:size-full", props.class)}
    >
      <Show when={props.icon}>{props.icon!}</Show>
    </div>
  );
}
