import {
  createMemo,
  createResource,
  createSignal,
  For,
  type ParentProps,
} from "solid-js";

import {
  createScriptEnvironment,
  json,
  merge,
  render,
  seed,
  type Schema,
} from "pardon/templates";
import { JSON, KV } from "pardon/formats";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

export default function TemplatePlayground(props: ParentProps<{}>) {
  const [firstTemplate, ...otherTemplates] = [
    ...(props.children as HTMLElement).querySelectorAll(".ec-line"),
  ]
    .map((line) => line.textContent)
    .join("\n")
    .split(/\n---\n/m)
    .map((s) => s.trim());

  const [template, setTemplate] = createSignal(firstTemplate.trim());
  const jsonSchema = merge(
    { mode: "merge", phase: "build" },
    seed(),
    json(),
  ).schema!;

  function parseAndMerge(
    template: string,
    schema: Schema<string>,
    phase: "validate" | "build" = "build",
  ) {
    try {
      const {
        [KV.eoi]: _eoi,
        [KV.upto]: _upto,
        [KV.unparsed]: rest,
        ...values
      } = KV.parse(template, "stream");

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
    async ({ values, result: { context, schema, error } }) => {
      if (!schema) {
        if (error) return String(error);
        const { loc, err } = context!.diagnostics[0] ?? {};
        return `error: ${loc} ${err}`;
      }

      const result = await render(schema, createScriptEnvironment({ values }));

      if (result.context?.diagnostics.length) {
        return String(result.context.diagnostics[0]);
      }

      return KV.stringify(JSON.parse(result.output), {
        limit: 50,
        indent: 2,
        mode: "json",
      });
    },
  );

  const renderResult = createMemo(() => {
    switch (true) {
      case renderResource.loading:
        return "rendering...";
      case renderResource.state === "errored":
        return String(renderResource.error);
      case renderResource.state === "ready":
        return renderResource();
    }
  });

  return (
    <div>
      <CodeMirror value={template()} readwrite onValueChange={setTemplate} />
      <For each={nextTemplateSignals}>
        {([input, setInput]) => (
          <>
            <div class="relative -my-2 grid w-full place-items-center overflow-hidden">
              <span class="relative -top-0.5">+</span>
            </div>
            <CodeMirror value={input()} readwrite onValueChange={setInput} />
          </>
        )}
      </For>
      <div class="relative -my-10 grid w-full place-items-center overflow-hidden">
        <span class="relative -top-0.5">=</span>
      </div>
      <CodeMirror value={renderResult()} readonly />
    </div>
  );
}
