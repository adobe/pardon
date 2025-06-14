import {
  createMemo,
  createResource,
  createSignal,
  type ParentProps,
} from "solid-js";
import CodeMirror from "@components/codemirror/CodeMirror.tsx";

import {
  createScriptEnvironment,
  json,
  merge,
  render,
  seed,
} from "pardon/templates";
import { KV } from "pardon/formats";

export default function TemplatePlayground(props: ParentProps<{}>) {
  const [firstTemplate = "{}", secondTemplate = "{}"] = [
    ...(props.children as HTMLElement).querySelectorAll(".ec-line"),
  ]
    .map((line) => line.textContent)
    .join("\n")
    .split(/\n---\n/m)
    .map((s) => s.trim());

  const [template, setTemplate] = createSignal(firstTemplate.trim());
  const jsonSchema = merge(
    { mode: "mix", phase: "build" },
    seed(),
    json(),
  ).schema!;

  const templateSchema = createMemo(() => {
    try {
      const {
        [KV.eoi]: _eoi,
        [KV.upto]: _upto,
        [KV.unparsed]: rest,
      } = KV.parse(template(), "stream");

      if (rest?.trim()) {
        return merge({ mode: "mix", phase: "build" }, jsonSchema!, rest);
      }
    } catch (error) {
      void error;
    }

    return merge({ mode: "mix", phase: "build" }, jsonSchema!, template());
  });

  const templateValues = createMemo(() => {
    try {
      const {
        [KV.eoi]: _eoi,
        [KV.upto]: _upto,
        [KV.unparsed]: rest,
        ...values
      } = KV.parse(template(), "stream");

      if (rest?.trim()) {
        return values;
      }
    } catch (error) {
      void error;
    }

    return {};
  });

  const [input, setInput] = createSignal(secondTemplate.trim());

  const mergedTemplate = createMemo(() => {
    const { schema, ...info } = templateSchema();

    if (!schema) {
      return info as ReturnType<typeof merge<string>>;
    }

    return merge({ mode: "mix", phase: "validate" }, schema, input());
  });

  const [renderResource] = createResource(
    mergedTemplate,
    async ({ context, schema, error }) => {
      if (!schema) {
        if (error) return String(error);
        const { loc, err } = context!.diagnostics[0] ?? {};
        return `error: ${loc} ${err}`;
      }

      return JSON.stringify(
        JSON.parse(
          (
            await render(
              schema,
              createScriptEnvironment({ values: templateValues() }),
            )
          ).output,
        ),
        null,
        2,
      );
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
      <div class="relative -my-2 grid w-full place-items-center overflow-hidden">
        <span class="relative -top-0.5">+</span>
      </div>
      <CodeMirror value={input()} readwrite onValueChange={setInput} />
      <div class="relative -my-10 grid w-full place-items-center overflow-hidden">
        <span class="relative -top-0.5">=</span>
      </div>
      <CodeMirror value={renderResult()} readonly />
    </div>
  );
}
