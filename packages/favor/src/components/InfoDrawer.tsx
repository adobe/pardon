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

import Drawer from "corvu/drawer";
import { TbX } from "solid-icons/tb";
import { createMemo, createSignal, splitProps, type JSX } from "solid-js";

import "./InfoDrawer.pcss";
import { twMerge } from "tailwind-merge";

export function InfoDrawer(
  props: Parameters<typeof Drawer.Content>[0] & {
    children: Parameters<typeof Drawer>[0]["children"];
    content: JSX.Element;
    side?: Parameters<typeof Drawer>[0]["side"];
    "no-close-button"?: boolean;
  },
) {
  const [ourProps, contentProps] = splitProps(props, [
    "side",
    "children",
    "content",
    "no-close-button",
  ]);
  const side = createMemo(() => ourProps.side || "bottom");
  const [dragging, setDragging] = createSignal(false);
  return (
    <Drawer side={side()} modal={false}>
      {(drawerProps) => (
        <>
          {typeof ourProps.children === "function"
            ? ourProps.children(drawerProps)
            : ourProps.children}
          <Drawer.Portal>
            <Drawer.Overlay
              class="info-drawer-overlay !pointer-events-none transition-colors duration-200"
              classList={{
                "!pointer-events-none": dragging(),
              }}
              style={{
                "background-color": `rgb(0 0 0 / ${
                  0.25 * drawerProps.openPercentage * (dragging() ? 0.25 : 1)
                })`,
              }}
            />
            <Drawer.Content
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
              class={twMerge(
                "info-drawer-content flex flex-col",
                contentProps.class,
              )}
              classList={{
                "corvu-drawer-top": side() === "top",
                "corvu-drawer-right": side() === "right",
                "corvu-drawer-left": side() === "left",
                "corvu-drawer-bottom": side() === "bottom",
                ...contentProps.classList,
              }}
            >
              {ourProps.content}
              {ourProps["no-close-button"] ? undefined : (
                <Drawer.Close class="corvu-drawer-close-button">
                  <TbX />
                </Drawer.Close>
              )}
            </Drawer.Content>
          </Drawer.Portal>
        </>
      )}
    </Drawer>
  );
}
