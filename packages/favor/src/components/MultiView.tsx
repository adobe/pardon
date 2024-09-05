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

import {
  ComponentProps,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  JSX,
  on,
  Signal,
  splitProps,
} from "solid-js";
import { twMerge } from "tailwind-merge";

export default function MultiView<Value extends string>(
  props: {
    side?: "top" | "left" | "right" | "bottom";
    value: Value;
    onChange?: (value: Value) => void;
    controls: (value: Signal<NoInfer<Value>>) => JSX.Element;
    children: (props: { value: NoInfer<Value> }) => JSX.Element;
  } & Omit<ComponentProps<"div">, "children">,
) {
  const [, divProps] = splitProps(props, [
    "side",
    "value",
    "onChange",
    "controls",
    "children",
  ]);
  const [view, setView] = createSignal<Value>(props.value);
  const side = createMemo(() => props.side ?? "left");
  createEffect(
    on(
      () => props.value,
      (value) => setView(() => value),
    ),
  );

  createEffect(on(view, (view) => props.onChange?.(view), { defer: true }));

  return (
    <div
      {...divProps}
      class={twMerge("multiview-root", divProps.class)}
      classList={{
        "multiview-left": side() === "left",
        "multiview-right": side() === "right",
        "multiview-top": side() === "top",
        "multiview-bottom": side() === "bottom",
        ...divProps.classList,
      }}
    >
      <div class="multiview-controls">{props.controls([view, setView])}</div>
      <div class="multiview-content">
        {props.children({
          get value() {
            return view();
          },
        })}
      </div>
    </div>
  );
}

export function Controls<Value extends string>(
  props: {
    view: Signal<Value>;
    controls: Record<Value, JSX.Element>;
    disabled: boolean | Partial<Record<Value, boolean>>;
  } & Omit<ComponentProps<"button">, "view" | "disabled">,
) {
  const selected = createSelector(props.view[0]);
  const [, buttonProps] = splitProps(props, ["view", "controls"]);

  // resets selection of current tab when disabled.
  createEffect(
    on(
      () => props.disabled,
      (disabled) => {
        if (disabled && typeof disabled === "object") {
          if (disabled[props.view[0]()]) {
            for (const key of Object.keys(props.controls)) {
              if (!disabled[key]) {
                props.view[1](() => key as Value);
                return;
              }
            }
          }
        }
      },
    ),
  );

  return (
    <For each={Object.entries(props.controls)}>
      {([key, control]) => (
        <button
          {...buttonProps}
          class={twMerge("multiview-button", buttonProps.class)}
          classList={{
            "multiview-selected": selected(key as Value),
            ...buttonProps.classList,
          }}
          value={key}
          onClick={() => props.view[1](() => key as Value)}
          disabled={
            props.disabled
              ? props.disabled === true || props.disabled?.[key] || false
              : false
          }
        >
          {control as JSX.Element}
        </button>
      )}
    </For>
  );
}

MultiView.Controls = Controls;
