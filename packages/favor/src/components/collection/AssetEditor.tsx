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

import { createMemo, Show } from "solid-js";
import { fileManifest } from "../../signals/pardon-config.ts";
import FileListEditor from "./FileListEditor.tsx";

export default function AssetEditor(props: { id: string }) {
  const sources = createMemo(() => fileManifest()?.assets[props.id]?.sources);

  return (
    <Show when={sources()}>
      <FileListEditor
        assets={sources()?.map(({ content, exists, path }, index) => ({
          name: (!exists ? "+ " : "") + fileManifest().crootnames[index],
          content,
          exists,
          path,
        }))}
      ></FileListEditor>
    </Show>
  );
}
