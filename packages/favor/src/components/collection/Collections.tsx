/*
Copyright 2024 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

import { createMemo, createSelector, createSignal } from "solid-js";
import { manifest } from "../../signals/pardon-config.ts";
import { CollectionTreeView } from "./CollectionTreeView.tsx";
import type { AssetSource, AssetType, AssetInfo } from "pardon/runtime";
import { CollectionTreeItem, Filters } from "./collection-tree-types.ts";
import { TbRefresh, TbX } from "solid-icons/tb";
import CornerControls from "./CornerControls.tsx";
import { animation } from "../animate.ts";

void animation; // used via use:animation

export type Endpoint = ReturnType<typeof manifest>["endpoints"][string];

type CollectionItemType = AssetType | "asset" | "root";

export type CollectionItemInfo = {
  id: string;
  type?: CollectionItemType;
  archetype: string;
  bad?: boolean;
  sources?: AssetSource[];
  present?: boolean;
};

type AssetTree = Record<
  string,
  { id: string; folder: AssetTree } | CollectionItemInfo
>;

type CollectionsAPI = {
  findItem(key: string): CollectionTreeItem;
};

export default function Collections(props: {
  children?: (collections: CollectionsAPI) => void;
  onClick?: (key: string, info: CollectionItemInfo, event: MouseEvent) => void;
  onDblClick?: (
    key: string,
    info: CollectionItemInfo,
    event: MouseEvent,
  ) => void;
  expanded: Set<string>;
  active: Set<string>;
  selection?: string;
  endpoint?: string;
  filters: Filters;
}) {
  const collection = createMemo(() => {
    const { endpoints = {}, assets = {}, errors = [] } = manifest() || {};

    const badPaths = new Set(errors.map(({ path }) => path));

    function archetype(id: string, { type }: AssetInfo) {
      switch (type) {
        case "endpoint":
          return endpoints[id].archetype;
      }
    }

    return Object.entries(assets)
      .map(([id, asset]) => {
        return {
          ...asset,
          id,
          key: `asset:${id}`,
          archetype: archetype(id, asset),
        };
      })
      .reduce<AssetTree>((tree, { name, id, type, sources, archetype }) => {
        const path = name.split("/");

        path.reduce(
          (node, part, i) =>
            i === path.length - 1
              ? (node[part] = {
                  type,
                  id,
                  sources,
                  archetype,
                  bad: Boolean(sources.find(({ path }) => badPaths.has(path))),
                })
              : (
                  (node[part] ??= {
                    id: path.slice(0, i + 1).join("/"),
                    folder: {},
                  }) as {
                    id: string;
                    folder: AssetTree;
                  }
                ).folder,
          tree,
        );

        return tree;
      }, {});
  });

  const collectionFiles = createMemo(() => {
    return process(collection()) as CollectionTreeItem[];

    function process(tree: AssetTree) {
      return Object.entries(tree)
        .sort(([k1, v1], [k2, v2]) => {
          return (
            (k2.endsWith(".yaml") ? 1 : 0) - (k1.endsWith(".yaml") ? 1 : 0) ||
            ("folder" in v1 ? 1 : 0) - ("folder" in v2 ? 1 : 0) ||
            k1.localeCompare(k2)
          );
        })
        .map(([name, info]) => {
          if ("folder" in info) {
            return {
              name,
              type: "folder",
              key: `folder:${info.id}`,
              items: process(info.folder),
              info: undefined,
            };
          }

          return {
            name,
            type: info.type,
            info,
            key: `${info.type}:${info.id}`,
          };
        });
    }
  });

  const [filter, setFilter] = createSignal("");

  props.children?.({
    findItem(key: string) {
      function find(item: CollectionTreeItem): CollectionTreeItem[] {
        if (item.key === key) return [item];
        return item.type === "folder" ? item.items.flatMap(find) : [];
      }
      return collectionFiles().flatMap(find)[0];
    },
  });

  return (
    <div class="relative flex size-full max-h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div class="m-1 flex flex-initial flex-row overflow-hidden rounded-lg">
        <input
          type="text"
          class="min-w-0 flex-1 rounded-lg rounded-e-none bg-stone-300 p-1 pl-2 font-mono text-xs dark:bg-stone-600"
          value={filter()}
          onInput={({ target: { value } }) => setFilter(value ?? "")}
        />
        <button
          class="flex-initial rounded-none bg-stone-400 p-1 text-sm active:!bg-stone-500 dark:bg-stone-500 dark:active:!bg-stone-400"
          onClick={() => setFilter("")}
        >
          <TbX />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <CollectionTreeView
          class="p-1 text-sm"
          onClick={(item, event) => props.onClick?.(item.key, item.info, event)}
          onDblClick={(item, event) =>
            props.onDblClick?.(item.key, item.info, event)
          }
          filters={props.filters}
          filter={filter()}
          selection={props.selection}
          selected={createSelector(() => props.selection)}
          current={createSelector(() => props.endpoint)}
          item={{
            name: "collection",
            type: "folder",
            key: "folder:collection",
            items: collectionFiles(),
            info: {
              id: "collection",
              archetype: "",
            },
          }}
          expanded={props.expanded}
          active={props.active}
        />
      </div>

      <CornerControls
        class="z-50 pb-1 pr-1"
        placement="br"
        actions={{
          reload() {
            window.pardon.reload();
          },
        }}
        unbuttoned={["reload"]}
        icons={{
          reload: (
            <button
              class="flex bg-inherit p-0 text-xl active:!bg-inherit"
              onClick={() => {
                window.pardon.reload();
              }}
              disabled={manifest.loading}
            >
              <span
                use:animation={["animate-ccw-spin", () => manifest.loading]}
                class="smoothed-backdrop transition-colors duration-300 [&::after]:backdrop-blur-[0.7px]"
              >
                <TbRefresh />
              </span>
            </button>
          ),
        }}
      ></CornerControls>
    </div>
  );
}
