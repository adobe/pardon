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

import { CURL, HTTP, RequestJSON, type RequestObject } from "pardon/formats";
import CodeMirror, {
  CodeMirrorProps,
  EditorView,
} from "../../codemirror/CodeMirror.tsx";
import {
  TbCopy,
  TbCopyright,
  TbEye,
  TbEyeClosed,
  TbInfoCircle,
  TbInfoOctagon,
  TbInfoOctagonFilled,
  TbMinus,
  TbPlus,
  TbReload,
  TbSend,
} from "solid-icons/tb";
import { twMerge } from "tailwind-merge";
import { createMemo, createSignal, Resource, Setter, Show } from "solid-js";
import CornerControls from "../CornerControls.tsx";
import { animation } from "../../animate.ts";
import KeyValueCopier from "../../KeyValueCopier.tsx";
import { ExecutionOutboundResult } from "../../../signals/pardon-execution.ts";

void animation; // used with use:animation

export default function PreviewPanel(
  props: {
    showPreview: boolean;
    preview: Resource<PromiseSettledResult<unknown>>;
    outbound: Resource<PromiseSettledResult<ExecutionOutboundResult>>;
    previewText?: string;
    renderText?: string;
    httpInputEditorView?: EditorView;
    request?: RequestJSON;
    relock: boolean;
    redacted: boolean;
    setRedacted: Setter<boolean>;
    headers: boolean;
    setHeaders: Setter<boolean>;
    resetRequest: () => void;
  } & Omit<CodeMirrorProps, "value" | "readonly">,
) {
  const [curl, setCurl] = createSignal(false);
  const [values, setValues] = createSignal(false);

  const preview = createMemo<string>((previous) => {
    if (props.outbound.loading) {
      return previous ?? "loading";
    }

    const httpText = props.showPreview ? props.previewText : props.renderText;

    if (!curl()) {
      return httpText;
    }

    try {
      return CURL.stringify(HTTP.parse(httpText) as RequestObject, {
        include: props.headers,
      });
    } catch (_error) {
      void _error;
      return httpText;
    }
  });

  const data = createMemo<Record<string, unknown>>((previous) => {
    if (props.outbound.loading) {
      return previous ?? {};
    }

    if (props.outbound.latest.status === "fulfilled") {
      return props.outbound.latest.value.outbound.request.values;
    }
  });

  return (
    <CodeMirror
      {...props}
      readonly
      nowrap
      value={preview()}
      class={twMerge(
        "relative flex w-0 min-w-0 flex-1 bg-gray-200 dark:bg-stone-800 [&_.cm-line]:pr-8 [&_.cm-line]:text-sm",
        props.class,
      )}
      onDblClick={async () => {
        props.httpInputEditorView?.focus();
      }}
      icon={
        <>
          <Show when={values()}>
            <KeyValueCopier
              data={data() ?? {}}
              class="absolute inset-0 z-10 bg-inherit p-1.5 pt-1 text-sm"
            />
          </Show>
          <CornerControls
            class="z-10 gap-1 bg-gray-300 p-0.5 dark:bg-gray-600"
            placement="tr"
            flex="col"
            actions={{
              redacted: () => props?.setRedacted((value) => !value),
              copy() {
                navigator.clipboard.writeText(preview());
              },
              curl: () => setCurl((value) => !value),
              include: () => props.setHeaders((value) => !value),
              values: () => setValues((value) => !value),
            }}
            icons={{
              redacted: props.redacted ? <TbEyeClosed /> : <TbEye />,
              curl: curl() ? <TbCopyright /> : <TbSend />,
              values: values() ? <TbPlus /> : <TbMinus />,
              include: props.headers ? (
                <TbInfoCircle />
              ) : (
                <span class="relative flex">
                  <TbInfoOctagon class="z-10" />
                  <TbInfoOctagonFilled class="absolute text-red-300 dark:text-red-800" />
                </span>
              ),
              copy: <TbCopy />,
            }}
            disabled={{
              redacted: props.relock,
              copy: props.outbound()?.status !== "fulfilled",
              curl: values,
            }}
          />
          <CornerControls
            class="z-10"
            placement="br"
            actions={{
              reload() {
                props.resetRequest();
              },
            }}
            disabled={{
              reload: props.preview()?.status !== "fulfilled",
            }}
            icons={{
              reload: (
                <div class="flex text-xl">
                  <span
                    use:animation={[
                      "animate-cw-spin",
                      () => props.outbound?.loading,
                    ]}
                    class="smoothed-backdrop !bg-opacity-50 p-0.5 [&::after]:bg-[#cfd1d480] [&::after]:backdrop-blur-[0.7px] dark:[&::after]:bg-[#2e2d2d80]"
                  >
                    <TbReload />
                  </span>
                </div>
              ),
            }}
          />
        </>
      }
    />
  );
}
