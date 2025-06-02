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

import { SyntaxKind, ts } from "ts-morph";
import { syncEvaluation, TsMorphTransform } from "../evaluation/expression.js";
import { Template } from "../schema/core/types.js";
import { referenceTemplate } from "../schema/definition/structures/reference.js";
import { PardonError } from "../error.js";

export function evalTemplate(
  schemaSource: string,
  globals: Record<string, unknown>,
): Template<unknown> {
  return syncEvaluation(
    `${schemaSource}`,
    {
      binding(name) {
        if (name in globals) {
          return globals[name];
        }

        if (!name.startsWith("$")) {
          return referenceTemplate({ ref: name });
        }

        return undefined;
      },
    },
    jsonSchemaTransform,
  ) as Template<string>;
}

// operator overloading - JSON edition.
//   - (...) -> don't transform the contents, this expression is to be evaluated by the pardon render engine
//   - /.../ -> anonymous regex match /.../ :: "{{ % /.../ }}"
//   - x = 'value' -> bind x to the value :: x.of("value")
//   - x = (...) -> bind x to the variable :: x.of("{{ = (...) }}")
//   - x %= /.../ -> bind x to the variable with regex /.../ :: x.of("{{ % /.../ }}")
//   - x = (...) % /.../ -> bind $x to the variable with regex /.../ :: x.of("{{ = (...) % /.../ }}")
//   - x = ... -> bind x to the structure :: x.of(...)
//   - x! -> mark x required for match :: x.$required (this only affects matching response templates)
export const jsonSchemaTransform: TsMorphTransform = ({
  currentNode,
  visitChildren,
  factory,
}) => {
  if (
    ts.isTemplateExpression(currentNode) &&
    !ts.isTaggedTemplateExpression(currentNode.parent)
  ) {
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
        parts.push(`{{ ${identifierOf(expression, factory)} }}`);
      }

      parts.push(literal.text);
    }

    return factory.createStringLiteral(parts.join(""));
  }

  if (ts.isCallExpression(currentNode)) {
    return decorateCall(visitChildren(), factory);
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
    (ts.isAsExpression(currentNode.right) ||
      ts.isParenthesizedExpression(currentNode.right) ||
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

  if (ts.isAsExpression(currentNode)) {
    const types = asTypes(currentNode.type);

    if (
      ts.isLeftHandSideExpression(currentNode.expression) &&
      !ts.isLiteralExpression(currentNode.expression)
    ) {
      return types.reduce<ts.Expression>(
        (node, type) =>
          factory.createPropertyAccessChain(node, undefined, type),
        currentNode.expression,
      );
    }

    return types.reduce<ts.Expression>(
      (node, type) =>
        factory.createCallExpression(
          factory.createIdentifier(type),
          undefined,
          [node],
        ),
      currentNode.expression,
    );
  }

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

  if (ts.isPrefixUnaryExpression(currentNode)) {
    switch (currentNode.operator) {
      case SyntaxKind.PlusPlusToken:
        return factory.createCallExpression(
          factory.createIdentifier("$mux"),
          undefined,
          [currentNode.operand],
        );
      case SyntaxKind.MinusMinusToken:
        return factory.createCallExpression(
          factory.createIdentifier("$mix"),
          undefined,
          [currentNode.operand],
        );
      case SyntaxKind.MinusToken:
        return factory.createCallExpression(
          factory.createIdentifier("$hidden"),
          undefined,
          [currentNode.operand],
        );
      case SyntaxKind.PlusToken:
        return factory.createCallExpression(
          factory.createIdentifier("$flow"),
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
      "$required",
    );
  }

  return currentNode;
};

function decorateCall(expression: ts.Node, factory: ts.NodeFactory) {
  if (!ts.isCallExpression(expression)) {
    return expression;
  }

  const thisExpression = expression.expression;

  if (
    ts.isPropertyAccessChain(thisExpression) ||
    ts.isPropertyAccessExpression(thisExpression)
  ) {
    const name = ts.isMemberName(thisExpression.name)
      ? thisExpression.name.text
      : thisExpression.name;

    if (name.startsWith("$")) {
      return expression;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        thisExpression.expression,
        `$${name}`,
      ),
      expression.typeArguments,
      expression.arguments,
    );
  }

  if (ts.isIdentifier(thisExpression)) {
    if (thisExpression.text.startsWith("$")) {
      return expression;
    }

    return factory.createCallExpression(
      factory.createIdentifier(`$${thisExpression.text}`),
      expression.typeArguments,
      expression.arguments,
    );
  }

  return expression;
}

function asTypes(node: ts.TypeNode): string[] {
  if (ts.isToken(node)) {
    switch (node.kind) {
      case SyntaxKind.UndefinedKeyword:
        return ["$optional"];
      case SyntaxKind.BooleanKeyword:
        return ["$bool"];
      case SyntaxKind.StringKeyword:
        return ["$string"];
      case SyntaxKind.NumberKeyword:
        return ["$number"];
      case SyntaxKind.BigIntKeyword:
        return ["$bigint"];
      case SyntaxKind.NullKeyword:
        return ["$nullable"];
      default:
        throw new PardonError(
          `unhandled as-type: SyntaxKind=${node.kind} (${ts.SyntaxKind[node.kind]})`,
        );
    }
  }

  if (ts.isTypeReferenceNode(node)) {
    if (ts.isIdentifier(node.typeName)) {
      switch (node.typeName.text) {
        case "secret":
        case "redacted":
          return ["$secret"];
        case "hidden":
          return ["$hidden"];
        case "internal":
          return ["$noexport"];
        case "bool":
          return ["$bool"];
        case "optional":
          return ["$optional"];
        case "flow":
          return ["$flow"];
        default:
          throw new PardonError(`unhandled as-type: ${node.typeName.text}`);
      }
    }
  }

  if (ts.isStringLiteral(node)) {
    return [`$hint(${JSON.stringify(node.text)})`];
  }

  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap((type) => asTypes(type));
  }

  throw new PardonError(`unhandled as-type: ${node.getText()}`);
}

const referenceHints = {
  $noexport: "-",
  $optional: "?",
  $required: "!",
  $secret: "@",
  $hidden: "#",
  $flow: "+",
  $meld: "~",
};

const referenceSpecials = {
  $key: "@key",
  $value: "@value",
};

function identifierOf(node: ts.Expression, factory: ts.NodeFactory) {
  const parts: string[] = [];
  const hints = new Set<string>();

  while (!ts.isIdentifier(node)) {
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;

      if (name.startsWith("$hint(") && name.endsWith(")")) {
        hints.add(JSON.parse(name.slice(6, -1)));
      } else {
        const hint = referenceHints[name];
        const special = referenceSpecials[name];

        if (hint) {
          hints.add(hint);
        } else if (special) {
          parts.unshift(special);
        } else if (!name.startsWith("$")) {
          parts.unshift(name);
        } else {
          throw new Error(
            "illegal reference node name: " +
              name +
              " (references must not start with $)",
          );
        }
      }

      node = node.expression;
    } else if (ts.isParenthesizedExpression(node)) {
      node = node.expression;
    } else if (ts.isAsExpression(node)) {
      const types = asTypes(node.type);
      node = types.reduce<ts.Expression>(
        (node, type) => factory.createPropertyAccessExpression(node, type),
        node.expression,
      );
    } else {
      throw new Error(
        `illegal reference node: ${node.getText()} (expected identifier)`,
      );
    }
  }

  const name = node.text;

  if (name.startsWith("$")) {
    throw new Error(
      "illegal reference node name: " +
        name +
        " (references must not start with $)",
    );
  }

  parts.unshift(name);

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

      if (scalar) {
        const text = rhs.getText();
        const pattern = `{{ ${identifierOf(lhs, factory)} = $$expr(${JSON.stringify(text)}) }}`;
        return factory.createStringLiteral(pattern);
      } else if (ts.isAsExpression(rhs)) {
        const text = rhs.expression.getText();
        const ref = asTypes(rhs.type).reduce<ts.Expression>(
          (node, type) => factory.createPropertyAccessExpression(node, type),
          lhs,
        );
        return ts.isParenthesizedExpression(rhs.expression)
          ? factory.createStringLiteral(
              `{{ ${identifierOf(ref, factory)} = $$expr(${JSON.stringify(text)}) }}`,
            )
          : factory.createCallExpression(
              factory.createPropertyAccessExpression(ref, "$of"),
              undefined,
              [rhs.expression],
            );
      } else if (ts.isParenthesizedExpression(rhs)) {
        const text = rhs.expression.getText();

        const pattern = `{{ ${identifierOf(lhs, factory)} = $$expr(${JSON.stringify(text)}) }}`;

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

        const pattern = `{{ ${identifierOf(lhs, factory)} = $$expr(${JSON.stringify(text)}) % ${regex.text} }}`;
        return factory.createStringLiteral(pattern);
      } else if (ts.isRegularExpressionLiteral(rhs)) {
        const pattern = `{{ ${identifierOf(lhs, factory)} % ${rhs.text} }}`;
        return factory.createStringLiteral(pattern);
      } else if (ts.isBinaryExpression(rhs)) {
        rhs = binaryExpression(rhs, factory) ?? rhs;
      }

      return factory.createCallExpression(
        factory.createPropertyAccessExpression(lhs, "$of"),
        undefined,
        [rhs],
      );
    }
    case SyntaxKind.PercentEqualsToken:
      if (ts.isRegularExpressionLiteral(currentNode.right)) {
        const pattern = `{{ ${identifierOf(currentNode.left, factory)} = % ${currentNode.right.text} }}`;
        return factory.createStringLiteral(pattern);
      }
      break;
    case SyntaxKind.AsteriskToken:
      return factory.createCallExpression(
        factory.createIdentifier("$keyed"),
        undefined,
        [currentNode.left, currentNode.right],
      );
    case SyntaxKind.AsteriskAsteriskToken:
      return factory.createCallExpression(
        factory.createIdentifier("$keyed$mv"),
        undefined,
        [currentNode.left, currentNode.right],
      );
  }
}
