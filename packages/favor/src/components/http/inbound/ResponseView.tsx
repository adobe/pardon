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

import { HTTP } from "pardon/formats";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Setter,
  Show,
  Suspense,
  VoidProps,
} from "solid-js";
import settle from "../../../util/settle.ts";
import LoadingSplash from "../../LoadingSplash.tsx";
import CodeMirror from "../../codemirror/CodeMirror.tsx";
import { ExecutionResult } from "../../../signals/pardon-execution.ts";
import CornerControls from "../CornerControls.tsx";
import { TbMinus, TbPlus } from "solid-icons/tb";
import KeyValueCopier from "../../KeyValueCopier.tsx";
import { secureData } from "../../secure-data.ts";

export default function ResponseView(
  props: VoidProps<{
    execution: Promise<ExecutionResult>;
    redacted: boolean;
    include?: boolean;
    kv?: boolean;
    lastResult: ExecutionHistory;
    setLastResult?: Setter<ExecutionHistory | undefined>;
  }>,
) {
  const [execution] = createResource(
    () => props.execution,
    async (execution) => await settle(execution),
  );

  createEffect(() => {
    if (
      execution.state === "ready" &&
      execution.latest.status === "fulfilled" &&
      execution.latest.value.type === "response"
    ) {
      setValues(false);

      const {
        inbound,
        outbound,
        context: { ask, trace },
      } = execution.latest.value;

      const result: ExecutionHistory = {
        context: { ask, trace },
        inbound,
        outbound: {
          request: outbound.request,
        },
      };

      props.setLastResult?.(() => result);
    }
  });

  function displayInbound(result: ExecutionResult | ExecutionHistory) {
    const {
      context: { trace },
      inbound: { response },
    } = result;

    return HTTP.responseObject.stringify({
      ...HTTP.responseObject.fromJSON({
        ...(props.redacted
          ? response
          : (secureData()?.[trace]?.inbound.response ?? response)),
      }),
      ...(!props.include && {
        headers: new Headers(),
      }),
    });
  }

  function show(
    execution: PromiseSettledResult<ExecutionResult | ExecutionHistory>,
  ) {
    switch (true) {
      case execution?.status === "rejected":
        return String(execution?.reason ?? "").replace(
          /^Error: Error invoking remote method '\w+': Error:\s*/,
          "",
        );
      default:
        return displayInbound(execution.value);
    }
  }

  const [values, setValues] = createSignal(false);
  const data = createMemo(() => {
    if (execution.loading) {
      return {};
    }
    const result = execution();

    if (result.status !== "fulfilled") {
      return {};
    }

    return result.value.inbound.values;
  });

  return (
    <Suspense fallback={<LoadingSplash />}>
      <div class="flex h-0 flex-1">
        <CodeMirror
          readonly
          nowrap
          value={show(
            execution.loading
              ? { status: "rejected", reason: undefined }
              : execution(),
          )}
          class="relative flex w-0 flex-1 overflow-auto [&_.cm-content]:pb-5 [&_.cm-line]:pr-2"
          text="10pt"
          icon={
            <>
              <Show when={values()}>
                <KeyValueCopier
                  data={data() ?? {}}
                  class="root-color absolute inset-0 z-10 p-1 text-sm"
                />
              </Show>
              <CornerControls
                class="z-10 bg-neutral-300 dark:bg-stone-700"
                placement="bl"
                actions={{
                  values() {
                    setValues((value) => !value);
                  },
                }}
                icons={{
                  values: values() ? <TbPlus /> : <TbMinus />,
                }}
              />
            </>
          }
        />
      </div>
    </Suspense>
  );
}
