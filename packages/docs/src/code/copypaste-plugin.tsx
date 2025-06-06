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

// @ts-nocheck -- hast JSX typing is rough.

import type { EditorViewConfig } from "@codemirror/view";
import type { EditorView } from "@components/codemirror/CodeMirror.tsx";
import { definePlugin } from "@expressive-code/core";
import * as acorn from "acorn";
import * as walker from "acorn-walk";
import { generate } from "astring";
import { h } from "@expressive-code/core/hast";

export function copypastePlugin() {
  return definePlugin({
    name: "copypaste-plugin",

    jsModules: () => [
      src()(() => {
        window.addEventListener(
          "click",
          (event) => {
            const { target } = event;

            if (!(target instanceof HTMLButtonElement)) {
              return;
            }

            copypaste(target);
          },
          { capture: true },
        );

        window.addEventListener("click", (event) => {
          const { target } = event;
          let element = target as HTMLElement;

          console.log("click");

          element = element.closest?.("[data-pardon-paste-target]");

          if (element?.hasAttribute?.("data-pardon-paste-target")) {
            const targetid = element.getAttribute("data-pardon-paste-target");
            const into = element.getAttribute("data-pardon-paste-to");
            const code = element.getAttribute("data-pardon-paste-code");
            const clear =
              element.getAttribute("data-pardon-paste-clear")?.split(",") ?? [];
            pasteinto(document.getElementById(targetid), into, code, {
              clear,
            });
          }

          copypaste(target);
        });

        document.addEventListener("DOMContentLoaded", () => {
          const StarlightTabsPrototype =
            customElements.get("starlight-tabs")?.prototype;

          if (StarlightTabsPrototype) {
            StarlightTabsPrototype.switchTab = ((original) =>
              function (...args) {
                const { id } = args[0] as HTMLElement;
                const panelId = id.replace(/^tab-/, "tab-panel-");
                const panel = document.getElementById(panelId);

                const autocopy = panel?.querySelector("[data-autocopy]");
                if (autocopy instanceof HTMLButtonElement) {
                  copypaste(autocopy);
                }

                return original.apply(this, args);
              })(StarlightTabsPrototype.switchTab);
          }
        });

        function pasteinto(
          context: Element,
          copyTo: string,
          code: string,
          options: { clear: string[] },
        ) {
          const pasteTarget =
            (context?.matches(`[data-pardon-${copyTo}]`)
              ? context
              : undefined) ?? context?.querySelector(`[data-pardon-${copyTo}]`);

          pasteTarget?.pardonPlayground?.update(code, options);
        }

        function copypaste(target: Element) {
          if (target.classList.contains("copypaste")) {
            event.stopImmediatePropagation();
            const code = target
              .getAttribute("data-code")
              ?.replace(/\u007f/g, "\n");

            const clear = (target.getAttribute("data-clear") ?? "")
              .split(",")
              .filter(Boolean);

            const copyTo = target.getAttribute("data-copy");
            if (copyTo) {
              pasteinto(target.closest(`.copypaste-context`), copyTo, code, {
                clear,
              });
            }
          }
        }
      }),
    ],
    baseStyles: (context) => `
.copypaste {
  position: absolute;
  bottom: 0.5rem;
  right: 1rem;
}
`,
    hooks: {
      postprocessRenderedBlock(context) {
        const { code } = context.codeBlock;
        // borrowing from @expressive-code/plugin-frames here
        const encode = (code ?? "").replace(/\n/g, "\u007f");

        const copy = context.codeBlock.metaOptions.getString("copy");
        const clear = context.codeBlock.metaOptions.getString("clear");
        const autocopy =
          context.codeBlock.metaOptions.getBoolean("autocopy") ?? false;
        if (copy) {
          context.renderData.blockAst.children[0].children.push(
            <button
              class="copypaste p-1.5!"
              data-code={encode}
              data-copy={copy}
              data-clear={clear}
              data-autocopy={autocopy}
            >
              Try it!
            </button>,
          );

          if (autocopy) {
            context.renderData.blockAst.properties.class = "!hidden";
          }
        }
      },
    },
  });
}

function $$ssr<T>(x: T): T {
  throw new Error("virtual");
}

function src<T extends unknown[]>(
  ...args: T
): (f: (...args: T) => unknown) => string {
  return (f) => {
    const match =
      /(?:function\s+[^(]*)?[(]([^)]*)[)]\s*(?:=>\s*)?([{][\s\S]*[}]$)/m.exec(
        String(f).trim(),
      );

    const [, parameters, code] = match;

    const options = { ecmaVersion: 2020, sourceType: "script" };
    const params = parameters
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const ast = acorn.parse(code.trim().slice(1, -1), options);
    walker.simple(ast, {
      Expression(node, state) {
        if (
          node.type == "CallExpression" &&
          node.callee.type === "Identifier" &&
          node.callee.name === $$ssr.name
        ) {
          const result = new Function(
            ...params,
            `return (${generate(node.arguments[0])})`,
          )(...args);

          if (result === void 0) {
            Object.assign(node, acorn.parse("(void 0)").body[0].expression);
          } else {
            Object.assign(
              node,
              acorn.parse(JSON.stringify(result), options).body[0].expression,
            );
          }
        }
      },
    });

    return generate(ast);
  };
}
