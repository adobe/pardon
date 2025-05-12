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

    jsModules: (context) => [
      src(context)((context) => {
        window.addEventListener(
          "click",
          (event) => {
            const { target } = event;

            if (!(target instanceof HTMLButtonElement)) {
              return;
            }

            if (target.classList.contains("copypaste")) {
              event.stopImmediatePropagation();
              const code = target
                .getAttribute("data-code")
                ?.replace(/\u007f/g, "\n");

              const [copyFrom, ...args] = target
                .getAttribute("data-copy")
                ?.split() ?? [null];

              if (!copyFrom) {
                return;
              }

              const context = target.closest(`.copypaste-context`);
              const pasteTarget = context
                ?.querySelector(`[data-pardon-${copyFrom}]`)
                .pardonPlayground.update(code, ...args);
            }
          },
          { capture: true },
        );
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
        if (copy) {
          context.renderData.blockAst.children[0].children.push(
            <button
              class="copypaste p-1.5!"
              data-code={encode}
              data-copy={copy}
            >
              Try it!
            </button>,
          );
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
