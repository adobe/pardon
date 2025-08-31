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
  type Accessor,
  type ComponentProps,
  type JSX,
  For,
  splitProps,
} from "solid-js";

type CornerControlPlacement =
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | "r"
  | "rr"
  | "l"
  | "ll"
  | "t"
  | "tt"
  | "b"
  | "bb"
  | "none";

export type CornerControlProps<Actions extends string = string> = {
  flex?: "col" | "row" | "none";
  placement?: CornerControlPlacement;
  actions?: Partial<Record<NoInfer<Actions>, () => void>>;
  icons: Record<Actions, JSX.Element>;
  disabled?: Partial<Record<NoInfer<Actions>, boolean | Accessor<boolean>>>;
  unbuttoned?: NoInfer<Actions>[];
  buttonProps?: ComponentProps<"button">;
};

function defaultPlacementFlex(placement: CornerControlProps["placement"]) {
  return (
    {
      b: "row",
      bb: "row",
      t: "row",
      tt: "row",
      l: "col",
      ll: "col",
      r: "col",
      rr: "col",
    } satisfies Partial<Record<typeof placement, CornerControlProps["flex"]>>
  )[placement];
}

export default function CornerControls<Actions extends string>(
  props: ComponentProps<"div"> & CornerControlProps<Actions>,
) {
  const [ourProps, divProps] = splitProps(props, [
    "actions",
    "icons",
    "disabled",
    "buttonProps",
  ]);

  function isDisabled(action: Actions) {
    const disabled = ourProps.disabled?.[action];
    if (typeof disabled === "function") {
      return disabled();
    }
    return disabled as boolean;
  }

  return (
    <div
      {...divProps}
      classList={{
        flex: !props.flex,
        "flex flex-col":
          (props.flex ?? defaultPlacementFlex(props.placement)) === "col",
        "flex flex-row":
          (props.flex ?? defaultPlacementFlex(props.placement)) === "row",
        "absolute top-0 left-0 rounded-br-md": props.placement === "tl",
        "absolute top-0 right-0 rounded-bl-md": props.placement === "tr",
        "absolute bottom-0 left-0 rounded-tr-md": props.placement === "bl",
        "absolute bottom-0 right-0 rounded-tl-md": props.placement === "br",
        "absolute inset-y-0 right-0": props.placement === "r",
        "absolute inset-y-0 left-0": props.placement === "l",
        "absolute inset-x-0 top-0": props.placement === "t",
        "absolute inset-x-0 bottom-0": props.placement === "b",
        "absolute top-1/2 -translate-y-1/2 right-0 rounded-l-md":
          props.placement === "rr",
        "absolute top-1/2 -translate-y-1/2 left-0 rounded-r-md":
          props.placement === "ll",
        "absolute left-1/2 -translate-x-1/2 top-0 rounded-b-md":
          props.placement === "tt",
        "absolute left-1/2 -translate-x-1/2 bottom-0 rounded-t-md":
          props.placement === "bb",
      }}
    >
      <For each={Object.entries(ourProps.icons as Record<string, JSX.Element>)}>
        {([action, icon]) => {
          return props.unbuttoned?.includes(action as Actions) ? (
            icon
          ) : (
            <button
              title={action}
              {...ourProps.buttonProps}
              class="bg-inherit p-0"
              onClick={ourProps.actions?.[action]}
              disabled={isDisabled(action as Actions)}
            >
              {icon}
            </button>
          );
        }}
      </For>
    </div>
  );
}
