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

import Drawer from "corvu/drawer";
import { type ComponentProps, type ParentProps, splitProps } from "solid-js";

import { executionMemo } from "../signals/pardon-execution-signal.ts";
import { InfoDrawer } from "./InfoDrawer.tsx";

export function ConfigurationDrawer(
  props: ParentProps<{
    preview: PromiseSettledResult<
      Awaited<ReturnType<ReturnType<typeof executionMemo>>["preview"]>
    >;
  }> &
    ComponentProps<"button">,
) {
  const [, triggerProps] = splitProps(props, ["preview"]);
  return (
    <InfoDrawer
      side="left"
      class="flex border-gray-500 bg-gray-200 pt-3 opacity-90 dark:border-gray-400 dark:bg-gray-700"
      content={
        <>
          <Drawer.Label class="mb-1 rounded-md bg-gray-300 p-2 text-center dark:bg-gray-600">
            Configuration
          </Drawer.Label>
          <Drawer.Description class="flex-1 overflow-auto">
            <pre class="pr-10">
              {props.preview.status === "fulfilled" && props.preview.value.yaml}
            </pre>
          </Drawer.Description>
        </>
      }
      close-button
    >
      <Drawer.Trigger {...triggerProps} disabled={!props.preview} />
    </InfoDrawer>
  );
}
