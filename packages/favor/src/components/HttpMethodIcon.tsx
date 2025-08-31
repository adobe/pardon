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
  type ComponentProps,
  type VoidProps,
  Match,
  splitProps,
  Switch,
} from "solid-js";
import { twMerge } from "tailwind-merge";

export default function HttpMethodIcon(
  props: VoidProps<{ method: "GET" | "POST" | "DELETE" | (string & {}) }> &
    ComponentProps<"svg">,
) {
  const [ourProps, iconProps] = splitProps(props, ["method"]);
  const iconClass = (colors) =>
    twMerge(
      "scale-[1.3] translate-y-[-1.5px] overflow-clip w-5 h-4 pr-1",
      colors,
      iconProps.class,
    );
  return (
    <span class="w-5">
      <Switch
        fallback={
          <IconTablerSend
            {...iconProps}
            class={iconClass("scale-[0.7] text-lime-700 dark:text-lime-500")}
          />
        }
      >
        <Match when={ourProps.method === "GET"}>
          <IconTablerHttpGet
            {...iconProps}
            class={iconClass("text-lime-700 dark:text-lime-500")}
          />
        </Match>
        <Match when={ourProps.method === "POST"}>
          <IconTablerHttpPost
            {...iconProps}
            class={iconClass("text-yellow-600 dark:text-yellow-500")}
          />
        </Match>
        <Match when={ourProps.method === "PUT"}>
          <IconTablerHttpPut
            {...iconProps}
            class={iconClass("text-yellow-600 dark:text-yellow-700")}
          />
        </Match>
        <Match when={ourProps.method === "HEAD"}>
          <IconTablerHttpHead
            {...iconProps}
            class={iconClass("text-lime-600 dark:text-lime-400")}
          />
        </Match>
        <Match when={ourProps.method === "DELETE"}>
          <IconTablerHttpDelete
            {...iconProps}
            class={iconClass("text-rose-700 dark:text-[#ff77e9]")}
          />
        </Match>
        <Match when={ourProps.method === "PATCH"}>
          <IconTablerHttpPatch
            {...iconProps}
            class={iconClass("text-amber-600 dark:text-orange-700")}
          />
        </Match>
        <Match when={ourProps.method === "FILE"}>
          <IconTablerFile {...iconProps} class={iconClass("")} />
        </Match>
      </Switch>
    </span>
  );
}
