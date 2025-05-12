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
import { JSON } from "../raw-json.js";
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

  const compiledExpr = result
    .getFiles()[0]
    .text.replace(/^export default [(]/, "")
    .replace(/[)];\s+$/m, "");

  exprSourceFile.replaceWithText(compiledExpr);

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

// helper for recompiling x.await to (await x).
// because: fetch().await.json().await.x
// is easier to read than: (await (await fetch()).json()).x
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

export function syncEvaluation(
  expression: string,
  {
    binding,
  }: {
    binding?: (identifier: string) => unknown;
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

  try {
    return fn(([name]: TemplateStringsArray) => refs[name], ...args);
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

  try {
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
  } catch (error) {
    console.warn(
      `error evaluating expression: ${expression} as ${morphed}`,
      error,
    );
    throw error;
  }
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

    return types.reduce<ts.Expression>(
      (node, type) => factory.createPropertyAccessExpression(node, type),
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
          return ["$redacted"];
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

  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap((type) => asTypes(type));
  }

  throw new PardonError(`unhandled as-type: ${node.getText()}`);
}

const referenceHints = {
  $noexport: ":",
  $optional: "?",
  $required: "!",
  $redact: "@",
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
        const types = asTypes(rhs.type);
        const refValue = ts.isParenthesizedExpression(rhs.expression)
          ? factory.createStringLiteral(
              `{{ = $$expr(${JSON.stringify(text)}) }}`,
            )
          : rhs.expression;
        const ref = types.reduce<ts.Expression>(
          (node, type) => factory.createPropertyAccessExpression(node, type),
          lhs,
        );

        return factory.createCallExpression(
          factory.createPropertyAccessExpression(ref, "$of"),
          undefined,
          [refValue],
        );
      } else if (ts.isParenthesizedExpression(rhs)) {
        const text = (
          ts.isParenthesizedExpression(rhs) ? rhs.expression : rhs
        ).getText();

        const pattern = `{{ = $$expr(${JSON.stringify(text)}) }}`;

        return factory.createCallExpression(
          factory.createPropertyAccessExpression(lhs, "$of"),
          undefined,
          [factory.createStringLiteral(pattern)],
        );
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
