import {
  createCodeMirror,
  createEditorControlledValue,
  createEditorReadonly,
  type CreateCodeMirrorProps,
} from "solid-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { twMerge } from "tailwind-merge";
import {
  createEffect,
  splitProps,
  Show,
  type Setter,
  type ComponentProps,
  type JSX,
  createMemo,
} from "solid-js";

export { EditorView, EditorState };

type CodeMirrorProps = CreateCodeMirrorProps & {
  readonly?: boolean;
  readwrite?: boolean;
  editorViewRef?: Setter<EditorView | undefined>;
  icon?: JSX.Element;
  javascript?: boolean;
  text?: string;
} & ComponentProps<"div">;

const EnterToBody = keymap.of([
  {
    key: "Enter",
    run(view) {
      const {
        selection: { ranges },
        doc,
      } = view.state;

      if (ranges.length !== 1) {
        return false;
      }

      const { from, to } = ranges[0];
      if (from !== to) {
        return false;
      }

      const currentLine = doc.lineAt(from);
      if (
        currentLine.from !== from ||
        doc.lines < 2 ||
        doc.line(doc.lines - 1).length
      ) {
        view.dispatch([
          view.state.update({
            changes: { from, insert: "\n" },
            selection: { anchor: from + 1 },
          }),
        ]);

        return true;
      }

      if (currentLine.number !== doc.lines) {
        return false;
      }

      return true;
    },
  },
]);

export default function CodeMirror(props: CodeMirrorProps) {
  const [codemirrorProps, otherprops, restprops] = splitProps(
    props,
    ["value", "onModelViewUpdate", "onTransactionDispatched", "onValueChange"],
    ["editorViewRef", "readonly", "icon", "text"],
  );

  const { editorView, ref, createExtension } =
    createCodeMirror(codemirrorProps);

  createExtension(EditorView.lineWrapping);

  createExtension(Prec.high(EnterToBody));

  createExtension([history(), keymap.of(historyKeymap)]);

  createExtension(
    EditorView.theme({
      "&.cm-editor.cm-focused": {
        outline: "none",
      },
      ".cm-content": {
        caretColor: "var(--text1)",
        fontSize: props.text ?? "12pt",
      },
    }),
  );

  createEditorControlledValue(
    createMemo(() => {
      if (props.readwrite || props.readonly) {
        return editorView();
      }
    }),
    createMemo(() => codemirrorProps.value ?? ""),
  );

  createEditorReadonly(
    editorView,
    createMemo(() => props.readonly ?? false),
  );

  createEffect(() => {
    otherprops.editorViewRef?.(editorView?.());
  });

  createExtension(
    createMemo(() => {
      if (props.javascript) {
        return [
          javascript(),
          syntaxHighlighting(
            HighlightStyle.define([
              {
                tag: tags.variableName,
                color: "light-dark(#479, #8AD)",
              },
              { tag: tags.keyword, color: "light-dark(#832, #fa3)" },
              { tag: tags.string, color: "light-dark(#954, #ec8)" },
              { tag: tags.number, color: "#dae" },
              { tag: tags.comment, color: "#f5d", fontStyle: "italic" },
            ]),
          ),
        ];
      }
    }),
  );

  return (
    <div
      ref={ref}
      {...restprops}
      class={twMerge("relative", restprops.class)}
      onClick={() => {
        editorView()?.focus();
      }}
    >
      <Show when={otherprops.icon}>
        <div class="absolute top-2 right-3 z-10">{otherprops.icon!}</div>
      </Show>
    </div>
  );
}
