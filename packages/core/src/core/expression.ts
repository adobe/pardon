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
  IndentationText,
  SyntaxKind,
} from "ts-morph";

export type TsMorphTransform = (control: TransformTraversalControl) => ts.Node;

export function applyTsMorph(
  expression: string,
  transform?: TsMorphTransform,
): string {
  if (!transform) {
    return expression;
  }

  const expressionProject = new Project({
    compilerOptions: {
      allowJs: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ES2022,
    },
    useInMemoryFileSystem: true,
    manipulationSettings: {
      // hopefully this removes any unquoted "}}" values in expressions
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
      indentationText: IndentationText.TwoSpaces,
    },
  });

  const exprSourceFile = expressionProject.createSourceFile(
    `__expr__.ts`,
    `export default ${expression}`,
    { overwrite: true },
  );

  const awaitedExpr = exprSourceFile
    .getExportAssignment((assignment) => !assignment.isExportEquals())!
    .getExpression()!
    .transform(transform)
    .getText();

  //   this would actually leave more state around from
  //   the expression evaulation than not doing it.
  // exprSourceFile.deleteImmediatelySync();

  return awaitedExpr;
}

export function unbound(
  expression: string,
  options: acorn.Options = { ecmaVersion: 2022 },
) {
  const unbound: string[] = [];

  try {
    walker.simple(
      acorn.parse(expression, { ...options, allowAwaitOutsideFunction: true }),
      {
        Expression(node) {
          if (node.type == "Identifier") {
            unbound.push(node["name"]);
          }
        },
      },
    );
  } catch (ex) {
    console.error(`error parsing: ${expression} for unbound values`);
    throw ex;
  }

  return new Set(unbound);
}

// helper for recompiling x.await to (await x).
// because: fetch().await.json().await.x
// is easier to read than: (await (await fetch()).json()).x
export const expressionTransform: TsMorphTransform = ({
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

export function syncEvaluation(
  expression: string,
  {
    binding,
    options,
    transform,
  }: {
    binding?: (identifier: string) => unknown;
    options?: acorn.Options;
    transform?: TsMorphTransform;
  },
): unknown {
  expression = applyTsMorph(expression, transform);

  const bound = [...unbound(`(${expression})`, options)].map(
    (name) => [name, binding?.(name)] as const,
  );

  const fn = new Function(...bound.map(([k]) => k), `return (${expression})`);

  const args = bound.map(([, v]) => v);

  try {
    return fn(...args);
  } catch (error) {
    console.warn(`error evaluating script: ${expression}`, error);
    throw error;
  }
}

export async function evaluation(
  expression: string,
  {
    binding,
    options,
  }: {
    binding?: (identifier: string) => unknown | Promise<unknown>;
    options?: acorn.Options;
  },
): Promise<unknown> {
  const unboundIdentifiers = unbound(`(${expression})`, options);
  const bound = [...unboundIdentifiers].map(
    (name) => [name, binding?.(name)] as const,
  );

  const compiled = applyTsMorph(expression, expressionTransform);

  const fn = new Function(
    ...bound.map(([k]) => k),
    `return (async () => (${compiled}))()`,
  );
  try {
    const args = await Promise.all(bound.map(([, v]) => v));
    const result = await fn(...args);

    return result;
  } catch (error) {
    console.warn(`error evaluating expression: ${compiled}`, error);
    throw error;
  }
}

// operator overloading - JSON edition.
//   - (...) -> don't transform the contents, this expression is to be evaluated by the pardon render engine
//   - /.../ -> anonymous regex match /.../ :: "{{ % /.../ }}"
//   - $x = (...) -> bind $x to the variable :: $x.of("{{ = (...) }}")
//   - $x %= /.../ -> bind $x to the variable with regex /.../ :: $x.of("{{ % /.../ }}")
//   - $x = (...) % /.../ -> bind $x to the variable with regex /.../ :: $x.of("{{ = (...) % /.../ }}")
//   - $x = ... -> bind $x to the structure :: $x.of(...)
//   - $x! -> mark $x required for match :: $x.required
//   - void $x -> mark $x optional for match :: $x.optional
//   - $x?.$y -> mark $y optional for match :: $x.$y.optional
export const jsonSchemaTransform: TsMorphTransform = ({
  currentNode,
  visitChildren,
  factory,
}) => {
  if (ts.isTemplateExpression(currentNode)) {
    const head = currentNode.head.text;
    const spans = currentNode.templateSpans;

    const parts: string[] = [head];

    for (const { expression, literal } of spans) {
      if (ts.isBinaryExpression(expression)) {
        const parsed = binaryExpression(expression, factory, true);
        if (!parsed || !ts.isStringLiteral(parsed)) {
          throw new Error(
            "illegal template literal expression: " + expression.getText(),
          );
        }
        parts.push(parsed.text);
      } else {
        parts.push(`{{ ${identifierOf(expression)} }}`);
      }

      parts.push(literal.text);
    }

    return factory.createStringLiteral(parts.join(""));
  }

  if (ts.isCallExpression(currentNode)) {
    return visitChildren();
  }

  if (ts.isNumericLiteral(currentNode)) {
    return factory.createCallExpression(
      factory.createIdentifier("$$number"),
      undefined,
      [factory.createStringLiteral(currentNode.getText())],
    );
  }

  if (
    ts.isBinaryExpression(currentNode) &&
    (ts.isParenthesizedExpression(currentNode.right) ||
      ts.isRegularExpressionLiteral(currentNode.right) ||
      (ts.isBinaryExpression(currentNode.right) &&
        ts.isRegularExpressionLiteral(currentNode.right.right)))
  ) {
    const expression = binaryExpression(currentNode, factory);
    if (expression) {
      return expression;
    }
  }

  if (ts.isParenthesizedExpression(currentNode)) {
    const text = currentNode.expression.getText();
    const pattern = `{{ = $$expr(${JSON.stringify(text)}) }}`;
    return factory.createStringLiteral(pattern);
  }

  currentNode = visitChildren();

  if (ts.isBinaryExpression(currentNode)) {
    const expression = binaryExpression(currentNode, factory);
    if (expression) {
      return expression;
    }
  }

  if (ts.isRegularExpressionLiteral(currentNode)) {
    const text = currentNode.getText();
    const pattern = `{{ % ${text} }}`;
    return factory.createStringLiteral(pattern);
  }

  if (
    ts.isPropertyAccessChain(currentNode) &&
    ts.isOptionalChain(currentNode)
  ) {
    currentNode = factory.createPropertyAccessExpression(
      factory.createPropertyAccessExpression(
        currentNode.expression,
        currentNode.name,
      ),
      "optional",
    );
  }

  if (ts.isPrefixUnaryExpression(currentNode)) {
    switch (currentNode.operator) {
      case SyntaxKind.PlusToken:
        return factory.createCallExpression(
          factory.createIdentifier("mux"),
          undefined,
          [currentNode.operand],
        );
      case SyntaxKind.MinusToken:
        return factory.createCallExpression(
          factory.createIdentifier("mix"),
          undefined,
          [currentNode.operand],
        );
    }
  }

  if (ts.isRegularExpressionLiteral(currentNode)) {
    const pattern = `{{ % ${currentNode.text} }}`;
    return factory.createStringLiteral(pattern);
  }

  if (ts.isNonNullExpression(currentNode)) {
    return factory.createPropertyAccessExpression(
      currentNode.expression,
      "required",
    );
  }

  return currentNode;
};

const referenceHints = {
  noexport: ":",
  optional: "?",
  required: "!",
  redact: "@",
  meld: "~",
};

const referenceSpecials = {
  key: "@key",
  value: "@value",
};

function identifierOf(node: ts.Expression) {
  const parts: string[] = [];
  const hints = new Set<string>();

  while (ts.isPropertyAccessExpression(node)) {
    const name = node.name.text;

    const hint = referenceHints[name];
    const special = referenceSpecials[name];

    if (hint) {
      hints.add(hint);
    } else if (special) {
      parts.unshift(special);
    } else if (name.startsWith("$")) {
      parts.unshift(name.slice(1));
    } else {
      throw new Error(
        "illegal reference node name: " +
          name +
          " (references must start with $)",
      );
    }

    node = node.expression;
  }

  if (!ts.isIdentifier(node)) {
    throw new Error(
      "illegal reference node: " + node.getText() + "(expected identifier)",
    );
  }

  const name = node.text;

  if (!name.startsWith("$")) {
    throw new Error(
      "illegal reference node name: " +
        name +
        " (references must start with $)",
    );
  }
  parts.unshift(name.slice(1));

  return `${[...hints].join("")}${parts.join(".")}`;
}

function binaryExpression(
  currentNode: ts.BinaryExpression,
  factory: ts.NodeFactory,
  scalar?: boolean,
) {
  switch (currentNode.operatorToken.kind) {
    case SyntaxKind.EqualsToken: {
      const lhs = currentNode.left;
      let rhs = currentNode.right;
      if (scalar || ts.isParenthesizedExpression(rhs)) {
        const text = (
          ts.isParenthesizedExpression(rhs) ? rhs.expression : rhs
        ).getText();

        const pattern = `{{ ${identifierOf(lhs)} = $$expr(${JSON.stringify(text)}) }}`;
        return factory.createStringLiteral(pattern);
      } else if (
        ts.isBinaryExpression(rhs) &&
        (scalar || ts.isParenthesizedExpression(rhs.left)) &&
        rhs.operatorToken.kind === SyntaxKind.PercentToken &&
        ts.isRegularExpressionLiteral(rhs.right)
      ) {
        if (
          ts.isBinaryExpression(rhs.left) &&
          rhs.left.operatorToken.kind === SyntaxKind.EqualsToken
        ) {
          throw new Error("todo: operator operator");
        }

        const text = (
          ts.isParenthesizedExpression(rhs.left)
            ? rhs.left.expression
            : rhs.left
        ).getText();
        const regex = rhs.right;

        const pattern = `{{ ${identifierOf(lhs)} = $$expr(${JSON.stringify(text)}) % ${regex.text} }}`;
        return factory.createStringLiteral(pattern);
      } else if (ts.isRegularExpressionLiteral(rhs)) {
        const pattern = `{{ ${identifierOf(lhs)} % ${rhs.text} }}`;
        return factory.createStringLiteral(pattern);
      } else if (ts.isBinaryExpression(rhs)) {
        rhs = binaryExpression(rhs, factory) ?? rhs;
      }

      return factory.createCallExpression(
        factory.createPropertyAccessExpression(lhs, "of"),
        undefined,
        [rhs],
      );
    }
    case SyntaxKind.PercentEqualsToken:
      if (ts.isRegularExpressionLiteral(currentNode.right)) {
        const pattern = `{{ ${identifierOf(currentNode.left)} = % ${currentNode.right.text} }}`;
        return factory.createStringLiteral(pattern);
      }
      break;
    case SyntaxKind.AsteriskToken:
      return factory.createCallExpression(
        factory.createIdentifier("keyed"),
        undefined,
        [currentNode.left, currentNode.right],
      );
    case SyntaxKind.AsteriskAsteriskToken:
      return factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("keyed"),
          "mv",
        ),
        undefined,
        [currentNode.left, currentNode.right],
      );
  }
}
