import { For, Show, createMemo } from "solid-js";
import { KV } from "pardon/playground";

import "./testcase-table.pcss";
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
        <div class="absolute right-0 top-0 flex aspect-square min-h-fit min-w-fit place-items-center rounded-bl-md border-0 border-b border-l border-solid border-gray-500 bg-stone-300 p-1 opacity-75 dark:bg-lime-800">
          {props.rows.length}
        </div>
        <div class="grow overflow-y-scroll pr-4">
          <table
            class="testcase-table mb-2 mt-3"
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
