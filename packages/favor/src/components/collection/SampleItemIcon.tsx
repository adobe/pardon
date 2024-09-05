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
import { createMemo, ErrorBoundary, Match, splitProps, Switch } from "solid-js";
import { TbFolder } from "solid-icons/tb";
import HttpMethodIcon from "../HttpMethodIcon.tsx";
import {
  HTTP,
  HTTPS,
  HttpsRequestStep,
  HttpsResponseStep,
} from "pardon/formats";
import { SampleTreeItem } from "./sample-tree-types.ts";

export default function SampleItemIcon(
  props: IconProps & { info?: SampleTreeItem["info"] },
) {
  const [, iconProps] = splitProps(props, ["info"]);

  const http = createMemo(() => {
    if (!props.info) {
      return;
    }

    if (props.info.path.endsWith(".log.https")) {
      const steps = HTTPS.parse(props.info.content, "log").steps as [
        HttpsRequestStep,
        HttpsResponseStep,
      ];

      return steps[0].request;
    }

    try {
      return HTTP.parse(props.info.content);
    } catch (error) {
      void error;
      return;
    }
  });

  return (
    <ErrorBoundary fallback={<HttpMethodIcon method="FILE" />}>
      <Switch fallback={<TbFolder {...iconProps} />}>
        <Match when={props.info}>
          <HttpMethodIcon
            method={http().method}
            class="relative top-[1px] pr-1 text-2xl"
          />
        </Match>
      </Switch>
    </ErrorBoundary>
  );
}
