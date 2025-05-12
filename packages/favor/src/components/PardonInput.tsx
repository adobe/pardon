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

import { KV, valueId } from "pardon/formats";
import {
  Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  Setter,
  splitProps,
} from "solid-js";
import CodeMirror, { type CodeMirrorProps } from "./codemirror/CodeMirror.tsx";

type Values = Record<string, unknown>;

export default function PardonInput(
  props: CodeMirrorProps & {
    value?: string;
    defaultValue?: string;
    data?: { values: Accessor<Values>; doc: Accessor<string> };
    onValueChange?(text: string): void;
    onDataChange?(data: { values: Values; doc: string }): void;
    onDataValidChange?(valid: boolean): void;
    setTextRef?(setText: Setter<string>): void;
    dragDrop?: {
      onDragOver(event: DragEvent): boolean | undefined | void;
      onDrop(event: DragEvent): void;
    };
    acceptDataTypes?: string[];
  },
) {
  const [, codemirrorProps] = splitProps(props, [
    "value",
    "defaultValue",
    "onValueChange",
    "data",
    "onDataChange",
    "setTextRef",
  ]);
  const [doc, setDoc] = createSignal(props.data.doc());
  const [values, setValues] = createSignal(props.data.values());

  const formatted = createMemo(() =>
    `${KV.stringify(values() ?? {}, { indent: 2, trailer: "\n" })}${doc() ?? ""}`.trim(),
  );

  const [text, setText] = createSignal(props.value ?? formatted());

  createEffect(
    on(
      () => ({ defaultValue: props.defaultValue }),
      ({ defaultValue }) => {
        if (!text()?.trim()) {
          setText(defaultValue);
        }
      },
    ),
  );

  createEffect(() => {
    props.setTextRef?.(setText);
  });

  function updateData({
    ...data
  }: {
    values: Record<string, unknown>;
    doc: string;
  }) {
    return batch(() => {
      if (
        data.doc?.trim() !== doc()?.trim() ||
        valueId(data.values) !== valueId(values())
      ) {
        setValues(data.values);
        setDoc(data.doc);
        props?.onDataChange(data);
        return true;
      }
    });
  }

  createEffect(
    on(
      createMemo(() => ({
        values: { ...props.data.values() },
        doc: props.data.doc(),
      })),
      ({ values, doc }) => {
        try {
          if (updateData({ values, doc })) {
            setText(formatted());
          }
        } catch (error) {
          console.warn("error updating values", error);
          // ignore
        }
      },
      { defer: true },
    ),
  );

  createEffect(
    on(text, (text) => {
      try {
        const {
          [KV.unparsed]: unparsed = "",
          [KV.eoi]: _eoi,
          [KV.upto]: _upto,
          ...values
        } = KV.parse(text ?? "", "stream");

        updateData({ values, doc: unparsed });
        props.onDataValidChange?.(true);
      } catch (error) {
        void error; // TODO: expose location and highlight error location
        props.onDataValidChange?.(false);
      }
    }),
  );

  return (
    <CodeMirror
      {...codemirrorProps}
      tabbing
      readwrite
      value={text()}
      onValueChange={setText}
      onDragOver={(event) => {
        if (props.dragDrop) {
          const result = props.dragDrop.onDragOver(event);
          if (result === false) {
            return;
          }
          if (result) {
            event.preventDefault();
          }
        }

        if (event.dataTransfer.types.includes("text/value")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        props.dragDrop?.onDrop(event);
        if (event.defaultPrevented) {
          setText(formatted());
          return;
        }

        const textValue = event.dataTransfer.getData("text/value");
        if (textValue) {
          const value = KV.parse(textValue, "object");
          if (updateData({ values: { ...values(), ...value }, doc: doc() })) {
            setText(formatted());
          }
          event.preventDefault();
          return;
        }
      }}
    />
  );
}
