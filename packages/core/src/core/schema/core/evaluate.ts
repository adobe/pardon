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
import { rescope } from "./schema-utils.js";
import {
  ExpressionDeclaration,
  SchemaCaptureContext,
  SchemaRenderContext,
  ValueIdentifier,
} from "./schema.js";

import { isLookupValue, isLookupExpr, parseScopedIdentifier } from "./scope.js";

export function evaluateIdentifierWithExpression(
  context: SchemaRenderContext,
  identifier: string,
  expr?: string,
): undefined | unknown | Promise<unknown> {
  const resolved = resolveIdentifier(context, identifier);
  if (resolved !== undefined) {
    return resolved;
  }

  return renderIdentifierInExpression(context, identifier, expr);
}

function doRenderExpression(
  context: SchemaRenderContext,
  {
    ident,
    expr,
    source,
    hint,
  }: {
    ident: ValueIdentifier;
    expr: string;
    source: string | null;
    hint: string | null;
  },
) {
  return context.environment.evaluating({
    ident,
    context,
    source,
    hint,
    evaluation: async () =>
      await evaluation(expr!, {
        binding(unbound) {
          return evaluateIdentifierWithExpression(context, unbound);
        },
      }),
  });
}

function synthesizeExpressionDeclaration(
  context: SchemaRenderContext,
  identifier: string,
  expr?: string,
): Omit<ExpressionDeclaration, "name" | "path"> {
  const { scope } = context;

  const lookup = scope.lookup(identifier);

  if (isLookupExpr(lookup)) {
    return {
      ...lookup,
      expr: expr ?? lookup.expr,
    };
  }

  return {
    identifier,
    context,
    expr: expr ?? null,
    hint: null,
    source: `{{=${expr}}}`,
  };
}

function renderIdentifierInExpression(
  context: SchemaRenderContext,
  identifier: string,
  expr?: string,
) {
  const decl = synthesizeExpressionDeclaration(context, identifier, expr);
  const { scope } = context;
  const rescoped = rescope(context, decl.context.scope);

  return scope.rendering(context, identifier, async () => {
    const ident = parseScopedIdentifier(identifier);

    if (decl.expr) {
      const { expr, source, hint } = decl;

      const expressionResult = await doRenderExpression(rescoped, {
        ident,
        expr,
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
      ident,
    });

    return evaluatedResult;
  });
}

export function resolveIdentifier(
  context: SchemaCaptureContext,
  identifier: string,
) {
  const { scope } = context;
  const resolution = scope.resolve(context, identifier);

  if (isLookupValue(resolution)) {
    return resolution.value;
  }
}
