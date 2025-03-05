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
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  on,
  Setter,
  Show,
  splitProps,
} from "solid-js";
import CodeMirror from "../codemirror/CodeMirror.tsx";
import { TbFile } from "solid-icons/tb";
import { twMerge } from "tailwind-merge";

type FileEditorAsset = {
  name: string;
  path: string;
  content: string;
  exists: boolean;
};

export default function FileListEditor(
  props: {
    assets: FileEditorAsset[];
    onSave?: (info: {
      path: string;
      content: string;
    }) => undefined | boolean | void;
  } & Omit<ComponentProps<"div">, "children">,
) {
  const [index, setIndex] = createSignal(0);

  const [, divProps] = splitProps(props, ["assets"]);

  const file = createMemo(() => props.assets[index()]);

  return (
    <div
      {...divProps}
      class={twMerge(
        "flex min-h-0 w-0 flex-1 flex-col gap-2 p-2",
        divProps.class,
      )}
    >
      <FileEditorSelector
        assets={props.assets}
        index={index()}
        setIndex={setIndex}
      />
      <FileEditor
        exists={file().exists}
        content={file().content}
        path={file().path}
        onSave={props.onSave}
      />
    </div>
  );
}

export function FileEditor(props: {
  path: string;
  content: string;
  exists: boolean;
  reveal?: boolean;
  onSave?: (info: {
    path: string;
    content: string;
  }) => boolean | undefined | void;
}) {
  const [saving, setSaving] = createSignal(false);
  const [content, setContent] = createSignal(props.content);

  createEffect(
    on(
      () => props.content,
      (content) => setContent(content),
      { defer: true },
    ),
  );

  return (
    <>
      <CodeMirror
        value={content()}
        readwrite
        onValueChange={setContent}
        tabbing
        nowrap
        class="grow overflow-auto rounded-md border-2 border-gray-300 bg-amber-200 dark:border-gray-800 dark:bg-amber-800"
      />
      <div class="flex flex-row gap-2">
        <button
          class="flex-1 bg-amber-400 py-0.5 disabled:text-opacity-50 dark:bg-amber-700"
          onClick={() => {
            const reload = (props.onSave ?? (() => true))({
              path: props.path,
              content: content(),
            });
            setSaving(true);

            window.pardon
              .saveFile(props.path, content(), reload || false)
              .finally(() => {
                setSaving(false);
              });
          }}
          disabled={saving()}
        >
          {saving() ? "Saving file" : props.exists ? "Save" : "Create"}
        </button>
      </div>
    </>
  );
}

export function RevealFileButton(props: { path: string; exists: boolean }) {
  return (
    <button
      class="flex-none p-1 disabled:text-gray-500"
      disabled={!props.exists}
      onClick={() => {
        window.pardon.shellShowFile(props.path);
      }}
    >
      <TbFile />
    </button>
  );
}

export function FileEditorSelector(props: {
  assets: FileEditorAsset[];
  index: number;
  setIndex: Setter<number>;
}) {
  const file = createMemo(() => props.assets[props.index]);

  const selected = createSelector(() => props.index);

  return (
    <div class="flex flex-row gap-2">
      <RevealFileButton exists={file()?.exists} path={file().path} />
      <Show
        when={props.assets?.length > 1}
        fallback={<>{props.assets[0].name}</>}
      >
        <select
          class="w-0 flex-1 rounded-md"
          onChange={(event) => props.setIndex(Number(event.target.value))}
        >
          <For each={props.assets}>
            {({ name }, index) => (
              <option value={index()} selected={selected(index())}>
                {name}
              </option>
            )}
          </For>
        </select>
      </Show>
    </div>
  );
}
