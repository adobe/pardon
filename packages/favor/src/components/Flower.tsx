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

import { createResource, createSignal, Setter, Show } from "solid-js";
import { KV } from "pardon/formats";
import type { FlowName } from "pardon";

export default function Flower(props: {
  flow: FlowName;
  input: Record<string, unknown>;
  output: Setter<Record<string, unknown>>;
}) {
  const [flowPromise, setFlowPromise] =
    createSignal<Promise<Record<string, unknown>>>();

  const [flowResource] = createResource(flowPromise, async (promise) => {
    return await promise;
  });

  return (
    <>
      flow: {props.flow}
      <button
        onclick={() => {
          console.log("running flow: ", props.flow, props.input);
          setFlowPromise(
            (async () => {
              const result = await window.pardon.flow(props.flow, props.input);
              props.output(result);
              return result;
            })(),
          );
        }}
      ></button>
      <div>
        <Show when={flowResource.state === "ready"}>
          <pre>Done: {KV.stringify(flowResource(), "\n", 2)}</pre>
        </Show>
        <Show when={flowResource.state === "errored"}>
          <pre>Error: {flowResource.error}</pre>
        </Show>
      </div>
    </>
  );
}
