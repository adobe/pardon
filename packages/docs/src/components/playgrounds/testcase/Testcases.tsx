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
import { For } from "solid-js";
import { KV } from "pardon/playground";
import { color } from "@components/playgrounds/testcase/lcg.ts";

export function Testcases(props: {
  rows: { testcase: string; [_: string]: unknown }[];
  error?: unknown;
}) {
  return (
    <div
      class="relative mt-2 max-h-[50vh] overflow-y-hidden rounded-md border border-solid border-gray-500 px-2 shadow-md dark:shadow-gray-500"
      classList={{
        "opacity-50": Boolean(props.error),
      }}
    >
      <div class="absolute top-0 right-0 flex aspect-square min-h-fit min-w-fit place-items-center rounded-bl-md border-0 border-b border-l border-solid border-gray-500 bg-gray-300 p-1 opacity-75 dark:bg-lime-800">
        {props.rows.length}
      </div>
      <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-scroll pr-4 pb-4 pl-2">
        <For each={props.rows}>
          {({ testcase, ...data }) => (
            <fieldset class="relative mt-2 -mb-1 rounded-bl-none border-none p-0 dark:border-gray-700">
              <legend class="m-0 flex w-full p-0">
                <span class="m-0 w-full rounded-md rounded-b-none border-0 bg-gray-300 p-1 px-2 font-mono text-sm font-medium tracking-wide outline-0 dark:bg-gray-700">
                  {testcase}
                </span>
              </legend>

              <div class="flex flex-row flex-wrap place-content-evenly overflow-hidden rounded-md rounded-t-none">
                <For each={Object.entries(data)}>
                  {([key, value]) => (
                    <span
                      class="min-w-28 flex-1 text-center"
                      style={{ "background-color": color(value) }}
                    >
                      {KV.stringify({ [key]: value })}
                    </span>
                  )}
                </For>
              </div>
            </fieldset>
          )}
        </For>
      </div>
    </div>
  );
}
