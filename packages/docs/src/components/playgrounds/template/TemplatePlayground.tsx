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

import {
  type ParentProps,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";

import {
  type Schema,
  createScriptEnvironment,
  body,
  merge,
  render,
  seed,
} from "pardon/templates";
import { KV } from "pardon/formats";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

export default function TemplatePlayground(props: ParentProps<{}>) {
  const [firstTemplate, ...otherTemplates] = [
    ...(props.children as HTMLElement).querySelectorAll(".ec-line"),
  ]
    .map((line) => line.textContent)
    .join("\n")
    .replace(/\n{3,}/gm, "\n\n")
    .split(/\n---\n/m)
    .map((s) => s.trim());

  const [template, setTemplate] = createSignal(firstTemplate.trim());
  const jsonSchema = merge(
    { mode: "merge", phase: "build" },
    seed(),
    body(),
  ).schema!;

  function parseAndMerge(
    template: string,
    schema: Schema<string>,
    phase: "validate" | "build" = "build",
  ) {
    if (!template.trim().startsWith("{"))
      try {
        const { [KV.unparsed]: rest, ...values } = KV.parse(template, "stream");

        if (rest?.trim()) {
          return {
            values,
            result: merge({ mode: "merge", phase }, schema, rest),
          };
        }
      } catch (error) {
        void error;
      }

    return {
      values: {},
      result: merge({ mode: "merge", phase: "build" }, schema, template),
    };
  }

  const templateSchema = createMemo(() => {
    return parseAndMerge(template(), jsonSchema!);
  });

  const nextTemplateSignals = otherTemplates.map((initial) =>
    createSignal(initial),
  );

  const mergedTemplate = createMemo(() => {
    const {
      values,
      result: { schema, ...info },
    } = templateSchema();

    if (!schema) {
      return { values, result: { ...info } };
    }

    return nextTemplateSignals.reduce<ReturnType<typeof parseAndMerge>>(
      ({ values, result: { schema, ...info } }, [input], index, list) => {
        if (!schema) {
          return { values, result: { ...info } };
        }

        const merged = parseAndMerge(
          input(),
          schema,
          index === list.length - 1 ? "validate" : "build",
        );

        return {
          values: { ...values, ...merged.values },
          result: merged.result,
        };
      },
      { values, result: { schema } },
    );
  });

  const [renderResource] = createResource(
    mergedTemplate,
    async ({
      values,
      result: { context, schema, error },
    }): Promise<{ output: string; values?: string }> => {
      if (!schema) {
        if (error) return { output: String(error) };
        const { loc, err } = context!.diagnostics[0] ?? {};
        return { output: `error: ${loc} ${err}` };
      }

      const result = await render(
        schema,
        createScriptEnvironment({
          values,
          options(key) {
            if (key === "pretty-print") {
              return {
                limit: 50,
                indent: 2,
                mode: "json",
              };
            }
          },
        }),
      );

      if (result.context?.diagnostics.length) {
        return { output: String(result.context.diagnostics[0]) };
      }

      return {
        output: result.output,
        values: KV.stringify(result.context.evaluationScope.resolvedValues(), {
          indent: 2,
          limit: 60,
          split: true,
          quote: "auto",
        }),
      };
    },
  );

  const renderResult = createMemo(() => {
    switch (true) {
      case renderResource.loading:
        return { output: "rendering..." };
      case renderResource.state === "errored":
        return { output: String(renderResource.error) };
      case renderResource.state === "ready":
        return renderResource();
    }
  });

  return (
    <div class="p-3">
      <CodeMirror
        value={template()}
        readwrite
        onValueChange={setTemplate}
        class="rounded-lg bg-white/75 dark:bg-neutral-500/20"
      />
      <For each={nextTemplateSignals}>
        {([input, setInput]) => (
          <>
            <div class="relative -my-2 grid w-full place-items-center overflow-hidden">
              <span class="relative -top-0.5">+</span>
            </div>
            <CodeMirror
              value={input()}
              readwrite
              onValueChange={setInput}
              class="rounded-lg bg-white/75 dark:bg-neutral-500/20"
            />
          </>
        )}
      </For>
      <div class="relative -my-10 grid w-full place-items-center overflow-hidden">
        <span class="relative -top-0.5">=</span>
      </div>
      <CodeMirror
        value={renderResult()?.output ?? "..."}
        readonly
        class="opacity-75"
      />
      <Show when={renderResult()?.values}>
        <div class="pt-2">
          <CodeMirror
            value={renderResult()?.values}
            readonly
            class="border-t-2 border-dashed border-neutral-500 pt-2 opacity-75"
          />
        </div>
      </Show>
    </div>
  );
}
