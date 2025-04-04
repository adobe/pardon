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
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Setter,
  Show,
  Switch,
} from "solid-js";
import { KV } from "pardon/formats";
import type { FlowName } from "pardon";
import CornerControls from "./CornerControls.tsx";
import { manifest } from "../signals/pardon-config.ts";
import Accordion from "corvu/accordion";
import Resizable from "corvu/resizable";

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

  const currentFlow = createMemo(() => manifest()?.flows[props.flow]);

  return (
    <Resizable orientation="horizontal">
      <Resizable.Panel class="flex">
        <div class="w-full overflow-y-scroll">
          <div class="flex w-full flex-1 flex-col place-content-start">
            <Accordion multiple collapseBehavior="hide">
              <Switch fallback={<></>}>
                <Match when={currentFlow().interactions}>
                  <For each={currentFlow().interactions}>
                    {(interaction) => (
                      <Accordion.Item>
                        <Accordion.Trigger class="flex flex-1 flex-row place-content-between rounded-none bg-amber-300 p-1 text-left text-sm italic dark:bg-amber-900">
                          <div class="min-w-0 overflow-hidden overflow-ellipsis text-nowrap">
                            {interaction.type === "exchange"
                              ? interaction.request?.source.split("\n")[1]
                              : "script"}
                          </div>
                          <div class="text-yellow-700 dark:text-yellow-300">
                            {interaction.name}
                          </div>
                        </Accordion.Trigger>
                        <Accordion.Content class="[data-expanded]:animate-expand [data-collapsed]:animate-collapse flex-initial overflow-x-auto">
                          <pre class="px-3 py-1">
                            {(interaction.type === "exchange"
                              ? interaction.request
                              : interaction.type === "script"
                                ? interaction.script
                                : undefined
                            )?.source
                              ?.split("\n")
                              .slice(1)
                              .join("\n")}
                          </pre>
                        </Accordion.Content>
                      </Accordion.Item>
                    )}
                  </For>
                </Match>
              </Switch>
            </Accordion>
          </div>
        </div>
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel>
        <div class="absolute bottom-0 right-0">
          <Show when={flowResource.state === "ready"}>
            <pre>Done: {KV.stringify(flowResource(), "\n", 2)}</pre>
          </Show>
          <Show when={flowResource.state === "errored"}>
            <pre>Error: {flowResource.error}</pre>
          </Show>
        </div>
      </Resizable.Panel>
      <CornerControls
        class="bg-neutral-300 p-1 dark:bg-stone-700"
        placement="tr"
        icons={{
          play: <IconTablerPlayerPlayFilled />,
          pause: <IconTablerPlayerPauseFilled />,
          stop: <IconTablerPlayerStop />,
        }}
        actions={{
          play: () => {
            console.log("running flow: ", props.flow, props.input);
            setFlowPromise(
              (async () => {
                const result = await window.pardon.flow(
                  props.flow,
                  props.input,
                );
                props.output(result);
                return result;
              })(),
            );
          },
        }}
      />
    </Resizable>
  );
}
