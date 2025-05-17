import { For, Show, type ParentProps } from "solid-js";
import { reset, todos, users } from "./todo-server-hook.ts";

export default function TodoView(props: ParentProps<{}>) {
  return (
    <div class="flex h-full flex-1 flex-col gap-3 p-2">
      {props.children}
      <Show when={Object.keys(users()).length}>
        <div class="border-2 border-x-0 border-gray-500">TODOs</div>
        <div class="accordion-container no-scrollbar flex flex-col gap-3 overflow-scroll">
          <For each={Object.keys(users())}>
            {(user) => (
              <div>
                <div
                  class="light:bg-blue-100 grid grid-cols-2 rounded-lg border-2 px-3 py-1 dark:border-white dark:bg-amber-800"
                  data-pardon-paste-target="todo-playground"
                  data-pardon-paste-to="playground"
                  data-pardon-paste-code={`username=${user}`}
                >
                  <span class="font-mono">username={user}</span>
                  <Show
                    when={Object.keys(todos()[user] ?? {}).length}
                    fallback={<span class="col-span-3" />}
                  >
                    <span class="text-right font-mono">
                      {
                        Object.values(todos()[user]).filter(({ done }) => done)
                          .length
                      }
                      /{Object.keys(todos()[user]).length}
                    </span>
                  </Show>
                </div>
                <div>
                  <ul class="grid grid-cols-[fit-content(100%)_fit-content(100%)_1fr] gap-1 overflow-hidden pt-1">
                    <For each={Object.entries(todos()[user] ?? {})}>
                      {([id, { task, done }]) => {
                        return (
                          <li
                            class="col-span-3 grid grid-cols-subgrid place-items-baseline"
                            data-pardon-paste-target="todo-playground"
                            data-pardon-paste-to="playground"
                            data-pardon-paste-code={`todo=${id}`}
                          >
                            <span class="font-mono text-sm">{id}</span>
                            <input
                              class="relative top-0.5"
                              type="checkbox"
                              checked={done}
                              disabled
                            ></input>
                            <span class="overflow-scroll whitespace-nowrap">
                              {task}
                            </span>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="flex flex-1 flex-col place-content-end">
          <button
            onClick={() => {
              reset();
            }}
            disabled={Object.keys(users()).length === 0}
            class="rounded-2xl bg-red-300 px-3 text-xl dark:bg-amber-800 dark:text-white disabled:dark:bg-amber-900 disabled:dark:text-gray-300"
          >
            <IconTablerShredder class="relative inline" /> Reset todo server
          </button>
        </div>
      </Show>
    </div>
  );
}
