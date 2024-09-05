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

import { IconProps } from "solid-icons";
import {
  TbFile,
  TbHttpDelete,
  TbHttpGet,
  TbHttpHead,
  TbHttpPatch,
  TbHttpPost,
  TbHttpPut,
  TbSend,
} from "solid-icons/tb";
import { Match, splitProps, Switch, VoidProps } from "solid-js";
import { twMerge } from "tailwind-merge";

export default function HttpMethodIcon(
  props: VoidProps<{ method: "GET" | "POST" | "DELETE" | (string & {}) }> &
    IconProps,
) {
  const [ourProps, iconProps] = splitProps(props, ["method"]);
  const iconClass = (colors) =>
    twMerge(
      "absolute top-[-190%] h-[18px] scale-[1.2]",
      colors,
      iconProps.class,
    );
  return (
    <span class="relative inline-flex min-h-1 min-w-6">
      <Switch
        fallback={
          <TbSend
            {...iconProps}
            class={iconClass("scale-[0.7] text-lime-700 dark:text-lime-500")}
          />
        }
      >
        <Match when={ourProps.method === "GET"}>
          <TbHttpGet
            {...iconProps}
            class={iconClass("text-lime-700 dark:text-lime-500")}
          />
        </Match>
        <Match when={ourProps.method === "POST"}>
          <TbHttpPost
            {...iconProps}
            class={iconClass("text-yellow-600 dark:text-yellow-500")}
          />
        </Match>
        <Match when={ourProps.method === "PUT"}>
          <TbHttpPut
            {...iconProps}
            class={iconClass("text-yellow-600 dark:text-yellow-700")}
          />
        </Match>
        <Match when={ourProps.method === "HEAD"}>
          <TbHttpHead
            {...iconProps}
            class={iconClass("text-lime-600 dark:text-lime-400")}
          />
        </Match>
        <Match when={ourProps.method === "DELETE"}>
          <TbHttpDelete
            {...iconProps}
            class={iconClass("text-rose-700 dark:text-[#ff77e9]")}
          />
        </Match>
        <Match when={ourProps.method === "PATCH"}>
          <TbHttpPatch
            {...iconProps}
            class={iconClass("text-amber-600 dark:text-orange-700")}
          />
        </Match>
        <Match when={ourProps.method === "FILE"}>
          <TbFile {...iconProps} class={iconClass("")} />
        </Match>
      </Switch>
    </span>
  );
}
