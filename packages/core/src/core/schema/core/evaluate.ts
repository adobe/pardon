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
import { evaluation, dotAwaitTransform } from "../../evaluation/expression.js";
import { JSON } from "../../json.js";
import { rescope } from "./context-util.js";

import { isLookupValue, isLookupExpr, parseScopedIdentifier } from "./scope.js";
import {
  ExpressionDeclaration,
  SchemaContext,
  SchemaRenderContext,
  Identifier,
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
    identifier: Identifier;
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
    evaluation: () =>
      evaluation(
        expression!,
        {
          binding: (unbound) =>
            evaluateIdentifierWithExpression(context, unbound),
        },
        dotAwaitTransform,
      ),
  });
}

function synthesizeExpressionDeclaration(
  context: SchemaRenderContext,
  identifier: string,
  expression?: string,
): Omit<ExpressionDeclaration, "name" | "path"> {
  const { evaluationScope: scope } = context;

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
  const { evaluationScope: scope } = context;
  const rescoped = rescope(context, decl.context.evaluationScope);

  return scope.rendering(context, name, async () => {
    const identifier = parseScopedIdentifier(name);

    if (decl.expression) {
      const { expression, source, hint } = decl;

      return doRenderExpression(rescoped, {
        identifier,
        expression,
        source,
        hint,
      });
    }

    const ambientResult = await decl?.rendered?.(rescoped);

    if (ambientResult !== undefined) {
      return ambientResult;
    }

    return context.environment.evaluate({
      context,
      identifier,
    });
  });
}

export function resolveIdentifier(context: SchemaContext, identifier: string) {
  const { evaluationScope: scope } = context;
  const resolution = scope.resolve(context, identifier);

  if (isLookupValue(resolution)) {
    const declaration = scope.lookupDeclaration(identifier);

    if (
      declaration &&
      resolution.context.evaluationScope !==
        declaration?.context.evaluationScope
    ) {
      return;
    }

    return resolution.value;
  }
}
