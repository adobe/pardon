import { For, Show, type ParentProps } from "solid-js";
import { TbShredder } from "solid-icons/tb";
import { reset, todos, users } from "./todo-server-hook.ts";
import Accordion from "@corvu/accordion";

export default function TodoView(props: ParentProps<{}>) {
  return (
    <div class="flex h-full flex-1 flex-col gap-3 p-2">
      {props.children}
      <Show when={Object.keys(users()).length}>
        <div class="border-2 border-x-0 border-gray-500">TODO Server State</div>
        <div class="accordion-container no-scrollbar flex flex-col overflow-scroll">
          <Accordion
            collapseBehavior="hide"
            multiple
            collapsible={false}
            initialValue={Object.keys(users())[0] ?? ""}
          >
            <For each={Object.keys(users())}>
              {(user) => (
                <Accordion.Item value={user}>
                  <Accordion.Trigger class="grid grid-cols-2 px-10">
                    <span>{user}</span>
                    <Show
                      when={Object.keys(todos()[user] ?? {}).length}
                      fallback={<span class="col-span-3" />}
                    >
                      <span class="text-right font-mono">
                        {
                          Object.values(todos()[user]).filter(
                            ({ done }) => done,
                          ).length
                        }
                        /{Object.keys(todos()[user]).length}
                      </span>
                    </Show>
                  </Accordion.Trigger>
                  <Accordion.Content>
                    <ul class="grid grid-cols-[fit-content(100%)_fit-content(100%)_1fr] gap-2">
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
                              <span>{task}</span>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Accordion.Content>
                </Accordion.Item>
              )}
            </For>
          </Accordion>
        </div>
        <div class="flex flex-1 flex-col place-content-end">
          <button
            onClick={() => {
              reset();
            }}
            disabled={Object.keys(users()).length === 0}
            class="rounded-2xl bg-red-300 px-3 text-xl dark:bg-amber-800 dark:text-white disabled:dark:bg-amber-900 disabled:dark:text-gray-300"
          >
            <TbShredder class="relative inline" /> Reset todo server
          </button>
        </div>
      </Show>
    </div>
  );
}
