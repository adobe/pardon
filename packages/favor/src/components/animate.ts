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

import { Accessor, createEffect, JSX, on } from "solid-js";
import "./animations.pcss";

export function animation(
  el: HTMLElement,
  value: Accessor<JSX.Directives["animation"]>,
) {
  const [cls, cont] = value();

  createEffect(
    on(
      cont,
      (c) => {
        if (c) {
          el.classList.add(cls);
        }
      },
      { defer: true },
    ),
  );

  el.addEventListener("animationend", () => {
    el.classList.remove(cls);
    if (cont()) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => el.classList.add(cls)),
      );
    }
  });
}

declare module "solid-js" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface Directives {
      animation: [string, () => boolean];
    }
  }
}
