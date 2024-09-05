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

import { createEffect, createSignal, on, splitProps } from "solid-js";
import CodeMirror, { type CodeMirrorProps } from "./codemirror/CodeMirror.tsx";
import { extractKVs, intoArgs } from "pardon/formats";

import * as ArgumentParsing from "@pkgjs/parseargs";
const { parseArgs } = ArgumentParsing;

type Values = Record<string, unknown>;

type ValuesSignals = {
  error?: unknown;
};

export type ParseArgsConfig = Omit<
  Parameters<typeof parseArgs>[0],
  "args" | "allowPositionals"
>;

export default function ValuesInput<
  T extends Omit<Parameters<typeof parseArgs>[0], "args">,
>(
  mixedProps: CodeMirrorProps & {
    value?: string;
    signals?: (signals: ValuesSignals) => void;
    config?: T;
    onDataChange?(data: {
      values: Values;
      positionals: string[];
      options?: ReturnType<typeof parseArgs<T>>["values"];
    }): void;
  },
) {
  const [props, codemirrorProps] = splitProps(mixedProps, [
    "value",
    "onDataChange",
    "signals",
    "config",
  ]);

  const [value, setValue] = createSignal(props.value || "");
  const [error, setError] = createSignal<unknown>();

  createEffect(
    on(
      () => props.value,
      (value) => setValue(value),
      { defer: true },
    ),
  );

  createEffect(
    on(value, (value) => {
      try {
        const args = intoArgs(value);
        const data = extractKVs(args, true);

        if (props.config) {
          const result = parseArgs({
            ...props.config,
            allowPositionals: true,
            args,
          });

          props.onDataChange?.({
            positionals: result.positionals,
            options: result.values,
            values: data,
          });
        } else {
          props.onDataChange?.({ positionals: args, values: data });
        }
        setError();
      } catch (error) {
        console.warn(`error parsing: ${value}`, String(error));
        setError(error);
        // ignore
      }
    }),
  );

  props.signals?.({
    get error() {
      return error();
    },
  });

  return (
    <CodeMirror
      {...codemirrorProps}
      readwrite
      value={value()}
      onValueChange={(value) => {
        setValue(value);
        codemirrorProps.onValueChange?.(value);
      }}
    />
  );
}
