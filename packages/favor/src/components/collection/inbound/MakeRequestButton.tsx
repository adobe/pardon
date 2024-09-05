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

import { ComponentProps, splitProps } from "solid-js";
import { twMerge } from "tailwind-merge";
import { TbDownload, TbFileDownload } from "solid-icons/tb";
import { executionResource } from "../../../signals/pardon-execution.ts";

export default function MakeRequestButton(
  props: ComponentProps<"button"> & {
    render: ReturnType<ReturnType<typeof executionResource>["outbound"]>;
    iconClass?: string;
    onClick?: (event: MouseEvent) => void;
  },
) {
  const [, buttonprops] = splitProps(props, [
    "render",
    "children",
    "onClick",
    "iconClass",
  ]);
  return (
    <button
      {...buttonprops}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) {
          props.render.gate.resolution.resolve(true);
        }
      }}
      disabled={
        props.render?.status !== "fulfilled" ||
        props.render?.execution?.() !== "pending"
      }
      classList={{
        ...buttonprops.classList,
      }}
    >
      {["complete", "historical"].includes(props.render?.execution?.()) ||
      (props.render?.status === "fulfilled" &&
        props.render?.value.type === "history") ? (
        <>
          <TbFileDownload class={twMerge("flex-none", props.iconClass)} />
          {props.children}
        </>
      ) : (
        <>
          <TbDownload class={twMerge("flex-none", props.iconClass)} />
          {props.children}
        </>
      )}
    </button>
  );
}
