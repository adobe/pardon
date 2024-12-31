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
import { evaluation } from "../../expression.js";
import { rescope } from "./context.js";

import { isLookupValue, isLookupExpr, parseScopedIdentifier } from "./scope.js";
import {
  ExpressionDeclaration,
  SchemaContext,
  SchemaRenderContext,
  ValueIdentifier,
} from "./types.js";

export function evaluateIdentifierWithExpression(
  context: SchemaRenderContext,
  identifier: string,
  expression?: string,
): undefined | unknown | Promise<unknown> {
  const resolved = resolveIdentifier(context, identifier);
  if (resolved !== undefined) {
    return resolved;
  }

  return renderIdentifierInExpression(context, identifier, expression);
}

function doRenderExpression(
  context: SchemaRenderContext,
  {
    identifier,
    expression,
    source,
    hint,
  }: {
    identifier: ValueIdentifier;
    expression: string;
    source: string | null;
    hint: string | null;
  },
) {
  return context.environment.evaluating({
    identifier,
    context,
    source,
    hint,
    evaluation: async () =>
      await evaluation(expression!, {
        binding(unbound) {
          return evaluateIdentifierWithExpression(context, unbound);
        },
      }),
  });
}

function synthesizeExpressionDeclaration(
  context: SchemaRenderContext,
  identifier: string,
  expression?: string,
): Omit<ExpressionDeclaration, "name" | "path"> {
  const { scope } = context;

  const lookup = scope.lookup(identifier);

  if (isLookupExpr(lookup)) {
    return {
      ...lookup,
      expression: expression ?? lookup.expression,
    };
  }

  return {
    identifier,
    context,
    expression: expression ?? null,
    hint: null,
    source:
      expression === undefined
        ? `{{}}`
        : `{{= $$expr(${JSON.stringify(expression)}) }}`,
  };
}

function renderIdentifierInExpression(
  context: SchemaRenderContext,
  name: string,
  expression?: string,
) {
  const decl = synthesizeExpressionDeclaration(context, name, expression);
  const { scope } = context;
  const rescoped = rescope(context, decl.context.scope);

  return scope.rendering(context, name, async () => {
    const identifier = parseScopedIdentifier(name);

    if (decl.expression) {
      const { expression, source, hint } = decl;

      const expressionResult = await doRenderExpression(rescoped, {
        identifier,
        expression,
        source,
        hint,
      });

      return expressionResult;
    }

    const ambientResult = await decl?.rendered?.(rescoped);

    if (ambientResult !== undefined) {
      return ambientResult;
    }

    const evaluatedResult = await context.environment.evaluate({
      context,
      identifier: identifier,
    });

    return evaluatedResult;
  });
}

export function resolveIdentifier(context: SchemaContext, identifier: string) {
  const { scope } = context;
  const resolution = scope.resolve(context, identifier);

  if (isLookupValue(resolution)) {
    return resolution.value;
  }
}
