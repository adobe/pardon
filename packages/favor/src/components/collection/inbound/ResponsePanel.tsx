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

import { createMemo, Setter } from "solid-js";
import {
  executionResource,
  ExecutionResult,
} from "../../../signals/pardon-execution.ts";
import MakeRequestButton from "./MakeRequestButton.tsx";
import { Show } from "solid-js";
import ResponseView from "./ResponseView.tsx";
import { setSecureData } from "../../secure-data.ts";

export default function ResponsePanel(props: {
  outbound: ReturnType<ReturnType<typeof executionResource>["outbound"]>;
  include: boolean;
  redacted: boolean;
  request: string;
  lastResult: ExecutionHistory;
  setLastResult?: Setter<ExecutionHistory>;
}) {
  const execution = createMemo(async () => {
    const execution = props.outbound;

    if (execution?.status === "rejected") {
      throw execution.reason;
    }

    if (execution?.status === "fulfilled") {
      if (execution.value.type === "history") {
        const { type, context, inbound, outbound } = execution.value;
        return {
          type,
          context,
          inbound,
          outbound,
        } satisfies ExecutionResult;
      }

      if (!(await execution.gate.promise)) {
        throw new Error("no request pending");
      }

      try {
        execution.setExecution("inflight");

        const { secure, ...result } = await window.pardon.continue(
          execution.value.handle,
        );

        setSecureData((data) => ({ ...data, [result.context.trace]: secure }));

        return {
          type: "response" as const,
          ...result,
        };
      } finally {
        execution.setExecution("complete");
      }
    }
  });

  return (
    <>
      <MakeRequestButton
        render={props.outbound}
        class="m-0 flex rounded-none p-3 shadow-sm disabled:bg-stone-400 dark:disabled:bg-[rgb(125,92,75)] dark:disabled:text-gray-300"
        iconClass="text-2xl order-1 pl-1"
      >
        <span class="w-0 flex-1 overflow-hidden overflow-ellipsis whitespace-nowrap text-start">
          {props.request}
        </span>
      </MakeRequestButton>
      <Show when={props.outbound}>
        <ResponseView
          redacted={props.redacted}
          execution={execution()}
          kv
          include={props.include}
          lastResult={props.lastResult}
          setLastResult={props.setLastResult}
        />
      </Show>
    </>
  );
}
