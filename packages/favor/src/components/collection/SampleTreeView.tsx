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

import { TbChevronRight } from "solid-icons/tb";

import {
  ComponentProps,
  For,
  Match,
  Show,
  Switch,
  VoidProps,
  createEffect,
  createSignal,
  splitProps,
} from "solid-js";

import { twMerge } from "tailwind-merge";
import { SampleTreeItem } from "./sample-tree-types.ts";
import SampleItemIcon from "./SampleItemIcon.tsx";

export function SampleTreeView(
  allProps: VoidProps<{
    expanded: Set<string>;
    item: SampleTreeItem;
    depth?: number;
    onClick?: (item: SampleTreeItem, event: MouseEvent) => void;
    onDblClick?: (item: SampleTreeItem, event: MouseEvent) => void;
    selection?: string;
  }> &
    Omit<
      ComponentProps<"div"> & ComponentProps<"button">,
      "onClick" | "onDblClick"
    >,
) {
  const [props, restprops] = splitProps(allProps, [
    "expanded",
    "item",
    "depth",
    "onClick",
    "onDblClick",
    "selection",
  ]);

  const [expanded, setExpanded] = createSignal<boolean>(
    Boolean((props.depth ?? 0) === 0 || props.expanded.has(props.item.key)),
  );

  if (props.depth > 0 && props.item) {
    createEffect(() => {
      if (expanded()) {
        props.expanded.add(props.item.key);
      } else {
        props.expanded.delete(props.item.key);
      }
    });
  }

  return (
    <>
      <Switch
        fallback={
          <span class="flex flex-row">
            <button
              {...restprops}
              draggable="true"
              onClick={(event) => {
                props.onClick?.(props.item, event);
              }}
              onDblClick={(event) => {
                props.onDblClick?.(props.item, event);
              }}
              onDragStart={(event) => {
                if (props.item.info.path.endsWith(".log.https")) {
                  event.dataTransfer.setData(
                    "text/log",
                    props.item.info.content,
                  );
                } else {
                  event.dataTransfer.setData(
                    "text/http",
                    props.item.info.content,
                  );
                }
              }}
              class={twMerge(
                "top-0 flex place-items-center text-nowrap rounded-sm border-0 bg-inherit p-0 px-1.5 active:dark:!bg-stone-600 active:dark:text-white",
                restprops.class,
              )}
              classList={{
                "outline outline-orange-300 dark:outline-orange-600 outline-2 z-10":
                  props.selection === props.item.info.path,
              }}
            >
              <SampleItemIcon
                info={props.item.info}
                class="borders-solid pr-1 text-xl"
              />
              {props.item.name}
            </button>
          </span>
        }
      >
        <Match when={props.item.type === "folder"}>
          <Show when={props.depth > 0}>
            <button
              {...restprops}
              class={twMerge(
                "z-auto flex place-items-center text-nowrap border-0 bg-inherit p-0 px-1 active:dark:!bg-stone-600",
                restprops.class,
              )}
              onClick={(event) =>
                props.item.type === "folder"
                  ? setExpanded((value) => !value)
                  : props.onClick?.(props.item, event)
              }
              style={{
                top: `${((props.depth ?? 0) - 1) * 25}px`,
              }}
            >
              <SampleItemIcon
                info={props.item.info}
                class="borders-solid pr-1 text-xl"
              />
              <span>{props.item.name}</span>
              <Show when={props.item.type === "folder"}>
                <span class="relative aspect-square w-4">
                  <TbChevronRight
                    class="absolute rotate-0 transition-transform"
                    classList={{
                      "rotate-90": expanded(),
                    }}
                  />
                </span>
              </Show>
            </button>
          </Show>
        </Match>
      </Switch>
      <Show when={expanded()}>
        <div {...restprops} class={twMerge("pl-2", restprops.class)}>
          <For each={props.item.items}>
            {(item) => (
              <SampleTreeView
                item={item}
                depth={(props.depth ?? 0) + 1}
                onClick={props.onClick}
                onDblClick={props.onDblClick}
                expanded={props.expanded}
                selection={props.selection}
              />
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
