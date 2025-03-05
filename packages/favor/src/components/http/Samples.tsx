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

import { createMemo, createSignal, mergeProps, Show } from "solid-js";
import { manifest, samples } from "../../signals/pardon-config.ts";
import { animation } from "../animate.ts";
import { SampleTreeItem } from "./sample-tree-types.ts";
import { SampleTreeView } from "./SampleTreeView.tsx";
import Resizable from "corvu/resizable";
import { numericKeySort } from "../../util/numeric-sort.ts";
import FileListEditor from "./FileListEditor.tsx";

void animation; // used via use:animation

export type Endpoint = ReturnType<typeof manifest>["endpoints"][string];

type SampleAssetTree = Record<
  string,
  { id: string; folder: SampleAssetTree } | SampleTreeItem["info"]
>;

export default function Samples(props: {
  onDblClick?: (
    key: string,
    info: SampleTreeItem["info"],
    event: MouseEvent,
  ) => void;
  expanded: Set<string>;
}) {
  const sampleAssets = createMemo(() => {
    return Object.entries(samples() ?? [])
      .map(([id, info]) => {
        return {
          id,
          key: `${id}`,
          info,
        };
      })
      .reduce<SampleAssetTree>((tree, { id, info }) => {
        info.name.split("/").reduce(
          (node, part, i, parts) =>
            i === parts.length - 1
              ? (node[part] = mergeProps(info, { id }))
              : (
                  (node[part] ??= {
                    id: parts.slice(0, i + 1).join("/"),
                    folder: {},
                  }) as {
                    id: string;
                    folder: SampleAssetTree;
                  }
                ).folder,
          tree,
        );

        return tree;
      }, {});
  });

  const sampleFiles = createMemo(() => {
    return process(sampleAssets()) as SampleTreeItem[];

    function process(tree: SampleAssetTree) {
      return Object.entries(tree)
        .sort(numericKeySort)
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
            info,
            type: info.path.endsWith(".log.https") ? "log" : "http",
            key: info.path,
          };
        });
    }
  });

  const [selection, setSelection] = createSignal<{
    content: string;
    path: string;
    name: string;
  }>();

  return (
    <Resizable>
      <Resizable.Panel initialSize={0.3}>
        <div class="relative flex size-full max-h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div class="min-h-0 flex-1 overflow-auto">
            <SampleTreeView
              class="p-1 text-sm"
              onClick={(item) => {
                setSelection(item.info);
              }}
              onDblClick={(item, event) => {
                try {
                  props.onDblClick?.(item.key, item.info, event);
                } catch (error) {
                  console.warn("error setting sample:", error);
                }
              }}
              item={{
                name: "samples",
                type: "folder",
                key: "folder:samples",
                items: sampleFiles(),
              }}
              expanded={props.expanded}
              selection={selection()?.path}
            />
          </div>
        </div>
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel class="flex" initialSize={0.7}>
        <Show when={selection()}>
          <FileListEditor
            assets={[{ ...selection(), exists: true }]}
            onSave={({ content }) => {
              selection().content = content;
            }}
          />
        </Show>
      </Resizable.Panel>
    </Resizable>
  );
}
