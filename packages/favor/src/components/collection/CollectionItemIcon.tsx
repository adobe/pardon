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

import { IconProps } from "solid-icons";
import { Match, splitProps, Switch } from "solid-js";
import { manifest } from "../../signals/pardon-config.ts";
import { CollectionTreeItem } from "./collection-tree-types.ts";
import {
  TbDatabase,
  TbFolder,
  TbMist,
  TbPolygon,
  TbSettings,
} from "solid-icons/tb";
import HttpMethodIcon from "../HttpMethodIcon.tsx";

export default function CollectionItemIcon(
  props: IconProps & { item: CollectionTreeItem },
) {
  const [, iconProps] = splitProps(props, ["item"]);
  const { endpoints } = manifest() || {};
  const endpoint = endpoints?.[props.item?.info?.id];
  const method = endpoint?.steps?.find(({ type }) => type === "request")?.[
    "request"
  ]?.["method"];

  return (
    <Switch fallback={<TbFolder {...iconProps} />}>
      <Match when={props.item.type === "config"}>
        <TbSettings {...iconProps} />
      </Match>
      <Match when={props.item.type === "data"}>
        <TbDatabase {...iconProps} />
      </Match>
      <Match when={props.item.type === "mixin"}>
        <TbPolygon {...iconProps} />
      </Match>
      <Match when={props.item.type === "endpoint"}>
        <HttpMethodIcon
          method={method}
          class="relative top-[1px] pr-1 text-2xl"
        />
      </Match>
      <Match when={props.item.type === "script"}>
        <TbMist {...iconProps} />
      </Match>
    </Switch>
  );
}
