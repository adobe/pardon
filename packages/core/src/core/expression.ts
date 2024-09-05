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
import * as acorn from "acorn";
import * as walker from "acorn-walk";
import {
  Project,
  ScriptTarget,
  ModuleKind,
  ts,
  TransformTraversalControl,
} from "ts-morph";

export function unbound(
  expr: string,
  options: acorn.Options = { ecmaVersion: 2022 },
) {
  const unbound: string[] = [];

  try {
    walker.simple(
      acorn.parse(expr, { ...options, allowAwaitOutsideFunction: true }),
      {
        Expression(node) {
          if (node.type == "Identifier") {
            unbound.push(node["name"]);
          }
        },
      },
    );
  } catch (ex) {
    console.error(`error parsing: ${expr} for unbound values`);
    throw ex;
  }

  return new Set(unbound);
}

// helper for recompiling x.await to (await x).
// because: fetch().await.json().await.x
// is easier to read than: (await (await fetch()).json()).x
export function transformDotAwait({
  factory,
  visitChildren,
}: TransformTraversalControl): ts.Node {
  const result = visitChildren();

  if (
    ts.isPropertyAccessExpression(result) &&
    result.name.getText() === "await"
  ) {
    return factory.createParenthesizedExpression(
      factory.createAwaitExpression(result.expression),
    );
  }

  return result;
}

export function awaiting(expr: string) {
  const expressionProject = new Project({
    compilerOptions: {
      allowJs: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ES2022,
    },
    useInMemoryFileSystem: true,
  });

  const exprSourceFile = expressionProject.createSourceFile(
    `__expr__.ts`,
    `export default (${expr})`,
    { overwrite: true },
  );

  const awaitedExpr = exprSourceFile
    .getExportAssignment((assignment) => !assignment.isExportEquals())!
    .getExpression()!
    .transform(transformDotAwait)
    .getFullText();

  // exprSourceFile.deleteImmediatelySync();

  return awaitedExpr;
}

export function syncEvaluation(
  expr: string,
  {
    binding,
    options,
  }: {
    binding?: (identifier: string) => unknown;
    options?: acorn.Options;
  },
): unknown {
  const bound = [...unbound(`(${expr})`, options)].map(
    (ident) => [ident, binding?.(ident)] as const,
  );

  const fn = new Function(...bound.map(([k]) => k), `return (${expr})`);

  const args = bound.map(([, v]) => v);
  return fn(...args);
}

export async function evaluation(
  expr: string,
  {
    binding,
    options,
  }: {
    binding?: (identifier: string) => unknown | Promise<unknown>;
    options?: acorn.Options;
  },
): Promise<unknown> {
  const unboundIdentifiers = unbound(`(${expr})`, options);
  const bound = [...unboundIdentifiers].map(
    (ident) => [ident, binding?.(ident)] as const,
  );

  const fn = new Function(
    ...bound.map(([k]) => k),
    `return (async () => (${awaiting(expr)}))()`,
  );

  const args = await Promise.all(bound.map(([, v]) => v));
  return await fn(...args);
}
