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

import { Accessor } from "solid-js";
import {
  ComponentProps,
  createContext,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  JSX,
  on,
  Signal,
  splitProps,
  useContext,
} from "solid-js";
import { twMerge } from "tailwind-merge";

const MultiviewContext = createContext<{
  controls: Record<any, JSX.Element>;
  controlProps?: Accessor<
    | Partial<Record<any, ComponentProps<"button">>>
    | {
        (
          viewSignal: Signal<any>,
        ): Partial<Record<any, ComponentProps<"button">>>;
      }
  >;
  disabled?: Accessor<boolean | Partial<Record<any, boolean>>>;
  viewSignal: Signal<any>;
  defaulting: Accessor<any[]>;
}>();

export default function MultiView<Value extends string>(
  props: {
    controls: Record<Value, JSX.Element>;
    controlProps?:
      | Partial<Record<NoInfer<Value>, ComponentProps<"button">>>
      | {
          (
            viewSignal: Signal<NoInfer<Value>>,
          ): Partial<Record<NoInfer<Value>, ComponentProps<"button">>>;
        };
    view: NoInfer<Value>;
    disabled?: boolean | Partial<Record<NoInfer<Value>, boolean>>;
    onChange?: (value: NoInfer<Value>) => void;
    children: (viewSignal: Signal<NoInfer<Value>>) => JSX.Element;
    defaulting?: Accessor<readonly NoInfer<Value>[]>;
  } & Omit<ComponentProps<"div">, "children">,
) {
  const [contextProps, , divProps] = splitProps(
    props,
    ["controls", "disabled"],
    ["view", "onChange", "children"],
  );
  const [view, setView] = createSignal<Value>(props.view);

  createEffect(
    on(
      () => props.view,
      (value) => setView(() => value),
    ),
  );

  createEffect(on(view, (view) => props.onChange?.(view), { defer: true }));

  return (
    <MultiviewContext.Provider
      value={{
        ...contextProps,
        controlProps: createMemo(() => props.controlProps) as Accessor<
          Record<any, ComponentProps<"button">>
        >,
        disabled: createMemo(() => contextProps.disabled),
        viewSignal: [view, setView],
        defaulting: createMemo(
          () => (props.defaulting?.() as any[]) ?? Object.keys(props.controls),
        ),
      }}
    >
      <div {...divProps} class={twMerge("multiview-root", divProps.class)}>
        {props.children([view, setView])}
      </div>
    </MultiviewContext.Provider>
  );
}

export function Controls<Value extends string>(
  props: ComponentProps<"button">,
) {
  const {
    viewSignal: [view, setView],
    controls,
    disabled,
    defaulting,
    controlProps,
  } = useContext(MultiviewContext);
  const selected = createSelector(view);

  // resets selection of current tab when disabled.
  createEffect(
    on(disabled, (disabled) => {
      if (disabled && typeof disabled === "object") {
        if (disabled[view()]) {
          const defaults = defaulting();

          for (const key of defaults) {
            if (!disabled[key]) {
              setView(() => key as Value);
              return;
            }
          }
        }
      }
    }),
  );

  const controlPropsObject = createMemo(() => {
    const cp = controlProps();
    if (!cp) return;
    if (typeof cp === "function") {
      return cp([view, setView]);
    }
    return cp;
  });

  return (
    <For each={Object.entries(controls)}>
      {([key, control]) => (
        <button
          {...props}
          {...controlPropsObject()?.[key]}
          class={twMerge(
            "multiview-button",
            props.class,
            controlPropsObject()?.[key]?.class,
          )}
          classList={{
            "multiview-selected": selected(key as Value),
            ...props.classList,
            ...controlPropsObject()?.[key]?.classList,
          }}
          value={key}
          onClick={(event) => {
            (controlPropsObject()?.[key]?.onClick as any)?.(event);

            if (!event.defaultPrevented) {
              setView(() => key as Value);
            }
          }}
          disabled={
            disabled() ? disabled() === true || disabled()[key] || false : false
          }
        >
          {control as JSX.Element}
        </button>
      )}
    </For>
  );
}

MultiView.Controls = Controls;
