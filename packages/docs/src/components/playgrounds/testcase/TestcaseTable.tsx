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
import { For, Show, createMemo } from "solid-js";
import { KV } from "pardon/playground";

import "./testcase-table.css";
import { color } from "@components/playgrounds/testcase/lcg.ts";

export function TestcaseTable(props: {
  rows: Record<string, unknown>[];
  error?: unknown;
}) {
  const columnKeys = createMemo(() =>
    Object.keys(Object.assign({}, ...props.rows)).sort(),
  );

  return (
    <Show
      when={columnKeys().length}
      fallback={<div>{props.rows.length} empty row(s).</div>}
    >
      <div
        class="relative mt-2 flex max-h-[50vh] overflow-y-hidden rounded-md border border-solid border-gray-500 px-2 shadow-md dark:shadow-gray-500"
        classList={{
          "opacity-50": Boolean(props.error),
        }}
      >
        <div class="absolute top-0 right-0 flex aspect-square min-h-fit min-w-fit place-items-center rounded-bl-md border-0 border-b border-l border-solid border-gray-500 bg-stone-300 p-1 opacity-75 dark:bg-lime-800">
          {props.rows.length}
        </div>
        <div class="grow overflow-y-scroll pr-4">
          <table
            class="testcase-table mt-3 mb-2"
            classList={{ error: Boolean(props.error) }}
          >
            <thead>
              <tr>
                <For each={columnKeys()}>
                  {(key) => {
                    return <th>{key}</th>;
                  }}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.rows}>
                {(row) => (
                  <tr>
                    <For each={columnKeys()}>
                      {(key) => (
                        <td style={{ "background-color": color(row[key]) }}>
                          {KV.stringify(row[key])}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
}
