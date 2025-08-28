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
  type TransformTraversalControl,
  Project,
  ScriptTarget,
  ModuleKind,
  ts,
  IndentationText,
  SyntaxKind,
  Diagnostic,
  DiagnosticMessageChain,
  Node,
} from "ts-morph";
import { PardonError } from "../error.js";
import { arrayIntoObjectAsync } from "../../util/mapping.js";

export type TsMorphTransform = (control: TransformTraversalControl) => ts.Node;

// disable assertions in typescript.
(ts as any).Debug.setAssertionLevel(1);

const expressionProject = new Project({
  compilerOptions: {
    allowJs: true,
    noCheck: true,
    strict: true,
    target: ScriptTarget.ES2022,
    module: ModuleKind.ES2022,
    noEmitOnError: true,
    lib: ["lib.es2022.d.ts"],
  },
  useInMemoryFileSystem: true,
  manipulationSettings: {
    // hopefully this removes any unquoted "}}" values in expressions
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
    indentationText: IndentationText.TwoSpaces,
  },
});

export function getMessage(
  error: Diagnostic<ts.Diagnostic> | DiagnosticMessageChain,
) {
  if (error.getMessageText) {
    const message = error.getMessageText();
    if (typeof message === "string") {
      return message;
    }
    return getMessage(message);
  }

  return "unknown error: " + error;
}

export function applyTsMorph(
  expression: string,
  ...transforms: (TsMorphTransform | null | undefined)[]
): {
  morphed: string;
  unbound: {
    symbols: Set<string>;
    literals: Set<string>;
  };
} {
  const exprSourceFile = expressionProject.createSourceFile(
    `/__expr__.ts`,
    `export default (${expression})`,
    { overwrite: true, scriptKind: ts.ScriptKind.TS },
  );

  const errors = exprSourceFile
    .getPreEmitDiagnostics()
    .filter((diag) => diag.getCategory() === ts.DiagnosticCategory.Error);

  if (errors.length > 0) {
    throw new PardonError(getMessage(errors[0]));
  }

  const sourceExpression = exprSourceFile
    .getExportAssignment((assignment) => !assignment.isExportEquals())!
    .getExpressionIfKindOrThrow(ts.SyntaxKind.ParenthesizedExpression)
    .getExpression();

  transforms
    .filter(Boolean)
    .reduce<
      Node<ts.Node>
    >((expression, transform) => expression.transform(transform), sourceExpression);

  const result = expressionProject.emitToMemory({
    targetSourceFile: exprSourceFile,
  });

  if (!result.getFiles()[0] && result.getDiagnostics()?.length) {
    const [diagnostic] = result.getDiagnostics();

    const message = `${diagnostic.getSourceFile()?.getFilePath()}:${diagnostic.getLineNumber()}: ${diagnostic.getMessageText()}`;
    throw new PardonError("failed to transform script: " + message);
  }

  const compiledExpr = result
    .getFiles()[0]
    .text.replace(/^export default [(]/, "")
    .replace(/[)];\s+$/m, "");

  exprSourceFile.replaceWithText(`(${compiledExpr})`);

  const symbols = new Set<string>();
  const literals = new Set<string>();

  for (const ident of exprSourceFile.getDescendantsOfKind(
    SyntaxKind.Identifier,
  )) {
    // skip accessed properties (a.b and a?.b)
    if (
      ident
        .getParentIfKind(ts.SyntaxKind.PropertyAccessExpression)
        ?.getNameNode() === ident
    ) {
      continue;
    }

    // skip label "identifiers", x: ...
    if (
      ident.getParentIfKind(ts.SyntaxKind.LabeledStatement)?.getLabel() ===
      ident
    ) {
      continue;
    }

    const propertyAssignment = ident.getParentIfKind(
      ts.SyntaxKind.PropertyAssignment,
    );

    if (propertyAssignment && ident !== propertyAssignment.getInitializer()) {
      continue;
    }

    if (ident.getText() === "$") {
      const tpl = ident
        .getParentIfKind(ts.SyntaxKind.TaggedTemplateExpression)
        ?.getTemplate()
        .asKind(ts.SyntaxKind.NoSubstitutionTemplateLiteral);

      if (tpl) {
        literals.add(tpl.getLiteralValue());
      }

      continue;
    }

    if (!ident.getDefinitionNodes()?.length) {
      symbols.add(ident.getText());
    }
  }

  return {
    morphed: compiledExpr,
    unbound: {
      symbols,
      literals,
    },
  };
}

export function syncEvaluation(
  expression: string,
  {
    binding,
    $: $ref,
  }: {
    binding?: (identifier: string) => unknown;
    $?: any;
  },
  ...transforms: TsMorphTransform[]
): unknown {
  const {
    morphed,
    unbound: { symbols, literals },
  } = applyTsMorph(expression, ...transforms);

  const bound = [...symbols].map((name) => [name, binding?.(name)] as const);
  const refs = [...literals].reduce(
    ($, name) => Object.assign($, { [name]: binding?.(name) }),
    {} as Record<string, unknown>,
  );

  const fn = new Function("$", ...bound.map(([k]) => k), `return (${morphed})`);

  const args = bound.map(([, v]) => v);

  const $ = new Proxy(Function.prototype, {
    apply(_target, _thisArg, [name]) {
      return refs[name];
    },
    get(target, p) {
      if (typeof p === "symbol") return target[p];
      return $ref?.[p];
    },
  });

  try {
    return fn($, ...args);
  } catch (error) {
    console.warn(`error evaluating script: ${expression} as ${morphed}`, error);
    throw error;
  }
}

export async function evaluation(
  expression: string,
  {
    binding,
  }: {
    binding?: (identifier: string) => unknown | Promise<unknown>;
  },
  ...transforms: TsMorphTransform[]
): Promise<unknown> {
  const {
    morphed,
    unbound: { symbols, literals },
  } = applyTsMorph(expression, ...transforms);

  const bound = [...symbols].map((name) => [name, binding?.(name)] as const);

  const templated = arrayIntoObjectAsync([...literals], async (name) => ({
    [name]: await binding?.(name),
  }));

  const fn = new Function(
    "$",
    ...bound.map(([k]) => k),
    `return (async () => (${morphed}))()`,
  );

  const args = await Promise.all([
    templated.then(
      (refs) =>
        ([name]: TemplateStringsArray) =>
          refs[name],
    ),
    ...bound.map(([k, v]) =>
      Promise.resolve(v).catch((ex) => {
        throw new PardonError(`evaluating ${k}`, ex);
      }),
    ),
  ]);

  const result = await fn(...args);

  return result;
}

// helper for recompiling x.await to (await x).
// because: fetch().await.json().await.x
// is easier to read than: (await (await fetch()).json()).x
//
// note that this code requires the included ts-morph patch
// ( see https://github.com/dsherret/ts-morph/issues/1471 )
export const dotAwaitTransform: TsMorphTransform = ({
  factory,
  visitChildren,
}) => {
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
};
