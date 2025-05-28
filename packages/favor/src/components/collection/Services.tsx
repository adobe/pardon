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

import { createMemo, createSelector, createSignal, For } from "solid-js";
import { fileManifest, manifest } from "../../signals/pardon-config.ts";
import { CollectionTreeView } from "./CollectionTreeView.tsx";
import type { AssetSource, AssetType, AssetInfo } from "pardon/runtime";
import { CollectionTreeItem, Filters } from "./collection-tree-types.ts";
import CornerControls from "../CornerControls.tsx";
import { animation } from "../animate.ts";
import Dialog from "corvu/dialog";
import FileListEditor from "../editor/FileListEditor.tsx";

void animation; // used via use:animation

export type Endpoint = ReturnType<typeof manifest>["endpoints"][string];

type CollectionItemType = AssetType | "asset" | "root";

export type CollectionItemInfo = {
  id: string;
  type?: CollectionItemType;
  subtype?: "flow";
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

export default function Services(props: {
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
  const services = createMemo(() => {
    const {
      endpoints = {},
      assets = {},
      errors = [],
      flows,
    } = manifest() || {};

    const badPaths = new Set(errors.map(({ path }) => path));

    function archetype(id: string, { type }: AssetInfo) {
      switch (type) {
        case "endpoint":
          return endpoints[id].archetype;
      }
    }

    return [
      ...Object.entries(assets).filter(
        ([, { subtype, type }]) => (subtype ?? type) !== "flow",
      ),
      ...Object.keys(flows).map(
        (key) =>
          [
            key,
            {
              sources: [] as (typeof assets)[string]["sources"],
              type: "flow",
              name: key,
            },
          ] as const,
      ),
    ]
      .map(([id, asset]) => {
        return {
          ...asset,
          id,
          key: `asset:${id}`,
          archetype: archetype(id, asset),
        };
      })
      .filter(({ sources }) =>
        sources.some(({ path }) => !path.startsWith("//")),
      )
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

  const collection = createMemo(() => {
    return process(services()) as CollectionTreeItem[];

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

  props.children?.({
    findItem(key: string) {
      function find(item: CollectionTreeItem): CollectionTreeItem[] {
        if (item.key === key) return [item];
        return item.type === "folder" ? item.items.flatMap(find) : [];
      }
      return collection().flatMap(find)[0];
    },
  });

  return (
    <div class="flex size-full min-h-0 flex-1 flex-col font-mono">
      <div class="fade-to-clear flex flex-col overflow-x-hidden overflow-y-auto [--clear-end-opacity:0.8] [--clear-start-opacity:0.5]">
        <For each={collection()}>
          {(item) => {
            return (
              <>
                <div class="smb-1 relative border-t-[0.125rem] px-1 pb-1 text-sm font-bold dark:border-slate-400 dark:bg-slate-600 [&:not(:first-child)]:mt-3">
                  {item.name}
                </div>
                <CollectionTreeView
                  class="text-sm"
                  onClick={(item, event) =>
                    props.onClick?.(item.key, item.info, event)
                  }
                  onDblClick={(item, event) =>
                    props.onDblClick?.(item.key, item.info, event)
                  }
                  filters={props.filters}
                  selection={props.selection}
                  selected={createSelector(() => props.selection)}
                  current={createSelector(() => props.endpoint)}
                  item={{
                    name: "collection",
                    type: "folder",
                    key: "folder:collection",
                    items: item.items,
                    info: {
                      id: "collection",
                      archetype: "",
                    },
                  }}
                  expanded={props.expanded}
                  active={props.active}
                />
              </>
            );
          }}
        </For>
      </div>

      <CornerControls
        class="z-20 pr-1 pb-1"
        placement="br"
        flex="col"
        actions={{
          reload() {
            window.pardon.reload();
          },
        }}
        unbuttoned={["reload", "add"]}
        icons={{
          add: (
            <Dialog>
              {(context) => {
                const [subPath, setSubPath] = createSignal("");
                const typeOfFile = createMemo(() => {
                  switch (true) {
                    case subPath().endsWith(".https"):
                      return "Create an https template";
                    case subPath().endsWith(".mix.https"):
                      return "Create an https template mixin";
                    case subPath().endsWith(".flow.https"):
                      return "Create an https flow";
                    case subPath().endsWith(".http"):
                      return "Create an sample http file";
                    case subPath().endsWith("/defaults.yaml"):
                      return "Organize defaults";
                    case subPath().endsWith("/service.yaml"):
                      return "Define configuration for a service";
                    case subPath().endsWith("/config.yaml"):
                      return "Refine configuration for a subdirectory of requests";
                    case subPath().endsWith(".js"):
                    case subPath().endsWith(".ts"):
                      return "Create a helper script";
                    default:
                      return "Create an arbitrary file";
                  }
                });
                return (
                  <>
                    <Dialog.Trigger class="smoothed-backdrop grid aspect-square place-content-center bg-inherit p-0 align-middle active:!bg-inherit">
                      <IconTablerPlus />
                    </Dialog.Trigger>
                    <Dialog.Portal>
                      <Dialog.Overlay class="absolute inset-0 z-30 bg-neutral-800 transition-opacity duration-1000 [&[data-closed]]:opacity-0 [&[data-open]]:opacity-25" />
                      <Dialog.Content class="absolute inset-0 grid place-content-center">
                        <div class="absolute inset-10 z-30 flex-col gap-2 rounded-lg border-2 bg-neutral-200 p-10 dark:border-neutral-400 dark:bg-neutral-600">
                          <div class="flex size-full flex-col">
                            <div>Create a new asset</div>
                            <input
                              class="font-weird w-full px-2"
                              value={subPath()}
                              onInput={(event) =>
                                setSubPath(event.target.value)
                              }
                            />
                            <span>{typeOfFile()}</span>
                            <div class="flex flex-1">
                              <FileListEditor
                                assets={fileManifest().crootnames.map(
                                  (rootname, index) => ({
                                    name: rootname,
                                    path: fileManifest().croots[index] + "/",
                                    content: "",
                                    exists: false,
                                  }),
                                )}
                                onSave={({ path, content }) => {
                                  context.setOpen(false);
                                  return { path: path + subPath(), content };
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </>
                );
              }}
            </Dialog>
          ),
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
                <IconTablerRefresh />
              </span>
            </button>
          ),
        }}
      ></CornerControls>
    </div>
  );
}
