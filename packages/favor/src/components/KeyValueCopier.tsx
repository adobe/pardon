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

import { cleanObject, KV } from "pardon/formats";
import { TbCopy, TbPlus } from "solid-icons/tb";
import { ComponentProps, For, JSX, splitProps } from "solid-js";
import { twMerge } from "tailwind-merge";

export default function KeyValueCopier(
  props: {
    data: Record<string, unknown>;
    icon?: JSX.Element;
  } & ComponentProps<"div">,
) {
  const [, divProps] = splitProps(props, ["data"]);

  return (
    <div
      {...divProps}
      class={twMerge(
        "relative flex flex-1 overflow-hidden [&:has(.copyable-object>.key:hover,.copyable-value:hover,.variable>.key:hover)>.copy-icon]:opacity-50",
        divProps.class,
      )}
      classList={{ ...props.classList }}
    >
      <div class="flex flex-1 flex-col overflow-auto whitespace-pre">
        <For each={Object.entries({ ...cleanObject(props.data) })}>
          {([key, value]) => (
            <div class="whitespace-pre font-mono" onClick={() => {}}>
              <KeyValueCopierNode
                tokens={KV.tokenize(KV.stringify({ [key]: value }, "\n", 2))}
              />
            </div>
          )}
        </For>
      </div>
      <span class="copy-icon absolute right-1 top-[50%] flex translate-y-[-50%] rounded-lg border-1 p-1 text-xl opacity-0 transition-opacity duration-150 dark:bg-neutral-600">
        <TbCopy />
      </span>
      <span class="value-icon absolute right-1 top-[50%] flex translate-y-[-50%] rounded-lg border-1 p-1 text-xl opacity-0 transition-opacity duration-150 dark:bg-neutral-600">
        <TbPlus />
      </span>
      {props.icon}
    </div>
  );
}

function KeyValueCopierNode(props: {
  tokens: { token: string; span?: number; key?: string; value?: unknown }[];
}) {
  const [key, ...eqvalue] = props.tokens;
  const nodes = [];
  for (let i = 0; i < eqvalue.length; i++) {
    const { span } = eqvalue[i];
    if (!span) {
      nodes.push(eqvalue[i]);
    } else {
      nodes.push(eqvalue.slice(i, i + span + 1));
      i += span;
    }
  }

  if (key.token === "[" || key.token === "{") {
    return (
      <span class="copyable-object [&>.key:hover+.value]:text-green-500 [&>.key:hover]:cursor-crosshair [&>.key:hover]:text-green-500">
        <span
          class="key"
          onClick={() => {
            window.navigator.clipboard.writeText(JSON.stringify(key.value));
          }}
        >
          {key.token}
        </span>
        <span class="value">
          <For each={nodes as (typeof key | (typeof key)[])[]}>
            {(node) =>
              Array.isArray(node) ? (
                <KeyValueCopierNode tokens={node} />
              ) : (
                <span
                  class="copyable-value hover:cursor-crosshair hover:text-green-500"
                  onClick={() => {
                    window.navigator.clipboard.writeText(node.token);
                  }}
                >
                  {node.token}
                </span>
              )
            }
          </For>
        </span>
      </span>
    );
  }

  const copyable = KV.isSimpleKey(key.key);

  return (
    <span
      classList={{
        "variable [&>.key:hover+.value]:text-orange-300 [&>.key:hover]:cursor-pointer [&>.key:hover]:text-orange-300":
          copyable,
      }}
    >
      <span
        class="key"
        {...(copyable && {
          role: "button",
          draggable: "true",
          "data-corvu-no-drag": true,
          onDragStart: (event) => {
            event.dataTransfer.setData(
              "text/value",
              KV.stringify({ [key.key]: key.value }),
            );
          },
          onClick: () => {
            window.navigator.clipboard.writeText(
              KV.stringify({ [key.key]: key.value }),
            );
          },
        })}
      >
        {key.token}
      </span>
      <span class="value">
        <For each={nodes}>
          {(node) =>
            Array.isArray(node) ? (
              <KeyValueCopierNode tokens={node} />
            ) : (
              <span
                classList={{
                  "copyable-value hover:text-green-500 cursor-crosshair":
                    node.token !== "=",
                }}
                role="button"
                onClick={() => {
                  window.navigator.clipboard.writeText(node.value);
                }}
              >
                {node.token}
              </span>
            )
          }
        </For>
      </span>
    </span>
  );
}
