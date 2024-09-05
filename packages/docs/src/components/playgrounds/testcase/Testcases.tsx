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
      <div class="absolute right-0 top-0 flex aspect-square min-h-fit min-w-fit place-items-center rounded-bl-md border-0 border-b border-l border-solid border-gray-500 bg-gray-300 p-1 opacity-75 dark:bg-lime-800">
        {props.rows.length}
      </div>
      <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-scroll pb-4 pl-2 pr-4">
        <For each={props.rows}>
          {({ testcase, ...data }) => (
            <fieldset class="relative -mb-1 mt-2 rounded-bl-none border-none p-0 dark:border-gray-700">
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
