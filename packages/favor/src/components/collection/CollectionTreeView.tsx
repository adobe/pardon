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
  ComponentProps,
  For,
  Match,
  Show,
  Switch,
  VoidProps,
  createEffect,
  createMemo,
  createSignal,
  splitProps,
} from "solid-js";

import { twMerge } from "tailwind-merge";
import { CollectionTreeItem, Filters } from "./collection-tree-types.ts";
import CollectionItemIcon from "./CollectionItemIcon.tsx";
import { KV } from "pardon/formats";

export function CollectionTreeView(
  props: VoidProps<{
    expanded: Set<string>;
    active: Set<string>;
    item: CollectionTreeItem;
    selection: string;
    selected: (key: string) => boolean;
    current: (key: string) => boolean;
    filters: Filters;
    depth?: number;
    onClick: (item: CollectionTreeItem, event: MouseEvent) => void;
    onDblClick: (item: CollectionTreeItem, event: MouseEvent) => void;
  }> &
    Omit<
      ComponentProps<"div"> & ComponentProps<"button">,
      "onClick" | "onDblClick"
    >,
) {
  const [, restprops] = splitProps(props, [
    "expanded",
    "active",
    "selected",
    "current",
    "selection",
    "item",
    "filters",
    "depth",
    "onClick",
    "onDblClick",
  ]);

  function forced(item: CollectionTreeItem) {
    return (
      item.info?.bad ||
      props.active.has(item.key) ||
      props.selected(item.key) ||
      props.current(item.key)
    );
  }

  function filterByType(type: CollectionTreeItem["type"], filter: Filters) {
    switch (type) {
      case "folder":
        return true;
      case "endpoint":
        return !filter.flow || filter.other;
      case "flow":
        return filter.flow || filter.other;
      default:
        return filter.other;
    }
  }

  const propped = createMemo(() => {
    return [props.item]?.flatMap((item) => {
      function activated(item: CollectionTreeItem) {
        return item.type === "folder"
          ? item.items.filter((item) => activated(item).length > 0)
          : [item].filter((item) => forced(item));
      }

      return activated(item);
    });
  });

  const items = createMemo(() => {
    return props.item.items?.filter?.((item) => {
      function unfiltered(item: CollectionTreeItem) {
        return (
          forced(item) ||
          propped().find(({ key }) => key == item.key) ||
          filterByType(item.type, props.filters) ||
          (item.type === "folder" && item?.items?.some(unfiltered))
        );
      }

      return unfiltered(item);
    });
  });

  const [expanded, setExpanded] = createSignal<boolean>(
    Boolean((props.depth ?? 0) === 0 || props.expanded.has(props.item.key)),
  );

  const isSelected = createMemo(() => props.selected(props.item.key));
  const isCurrent = createMemo(() => props.current(props.item.key));

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
              draggable={props.item.type === "endpoint" ? "true" : undefined}
              onDragStart={(event) => {
                if (props.item.type === "endpoint") {
                  event.dataTransfer.setData(
                    "text/http",
                    props.item.info.archetype,
                  );

                  const method =
                    props.item.info.archetype
                      ?.trim()
                      .split(" ")[0]
                      .toUpperCase() ?? "GET";

                  event.dataTransfer.setData(
                    "text/value",
                    KV.stringify({
                      method,
                      endpoint: props.item.info.id,
                    }),
                  );
                }
              }}
              onClick={(event) => {
                props.onClick?.(props.item, event);
              }}
              onDblClick={(event) => {
                props.onDblClick?.(props.item, event);
              }}
              class={twMerge(
                "top-0 flex place-items-center text-nowrap rounded-sm border-0 bg-inherit p-0 px-1.5 font-black active:dark:!bg-stone-600 active:dark:text-white",
                restprops.class,
              )}
              classList={{
                "outline outline-orange-300 dark:outline-orange-600 outline-2 z-10":
                  isSelected(),
                "!bg-violet-200 dark:!bg-violet-700 ":
                  !props.item.info?.bad &&
                  (props.active.has(props.item.key) || isCurrent()),
                "!bg-pink-300 dark:!bg-rose-800": props.item.info?.bad,
              }}
            >
              <CollectionItemIcon
                item={props.item}
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
                "z-auto flex place-items-center text-nowrap border-0 bg-inherit p-0 px-1 font-black active:dark:!bg-stone-600",
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
              classList={{
                "!bg-gray-200 dark:!bg-neutral-800": isSelected(),
              }}
            >
              <Show when={expanded()} fallback={<IconTablerFolder />}>
                <IconTablerFolderOpen />
              </Show>
              <span class="pl-1">{props.item.name}</span>
            </button>
          </Show>
        </Match>
      </Switch>
      <Show
        when={
          expanded() || isSelected() || forced(props.item) || propped()?.length
        }
      >
        <div {...restprops} class={twMerge("pl-2", restprops.class)}>
          <For each={items()}>
            {(item) => (
              <CollectionTreeView
                item={item}
                depth={(props.depth ?? 0) + 1}
                filters={props.filters}
                onClick={props.onClick}
                onDblClick={props.onDblClick}
                expanded={props.expanded}
                selection={props.selection}
                current={props.current}
                selected={props.selected}
                active={props.active}
              />
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
