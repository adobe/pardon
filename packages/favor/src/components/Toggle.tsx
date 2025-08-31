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
  type Ref,
  type JSX,
  createEffect,
  createSignal,
  on,
  splitProps,
} from "solid-js";

export default function Toggle(
  props: Omit<ComponentProps<"button">, "children" | "onChange" | "value"> & {
    children: (props: { value: boolean }) => JSX.Element;
    value?: boolean;
    ref?: Ref<HTMLButtonElement>;
    disabled?: boolean;
    onChange?(value: boolean): void;
    onClick?(event: MouseEvent): void | boolean;
  },
) {
  const [toggleProps, restProps] = splitProps(props, [
    "children",
    "ref",
    "value",
    "onChange",
    "onClick",
  ]);
  const [value, setValue] = createSignal<boolean>(toggleProps.value ?? false);

  createEffect(
    on(
      () => props.value,
      (value) => setValue(value),
      { defer: true },
    ),
  );

  createEffect(
    on(value, (value) => toggleProps.onChange?.(value), { defer: true }),
  );

  return (
    <button
      ref={toggleProps.ref}
      {...restProps}
      on:click={(event) =>
        (
          toggleProps.onClick ??
          (((event) => {
            event.stopPropagation();
            setValue((value) => !value);
          }) as any)
        )(event)
      }
      classList={{
        ...props.classList,
      }}
    >
      {props.children?.({
        get value() {
          return value();
        },
      })}
    </button>
  );
}
