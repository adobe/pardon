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
import { mapObjectAsync } from "../../../util/mapping.js";
import { evaluation, dotAwaitTransform } from "../../evaluation/expression.js";
import { JSON } from "../../raw-json.js";
import { loc } from "./context-util.js";

import { isLookupValue, isLookupExpr, parseScopedIdentifier } from "./scope.js";
import type {
  ExpressionDeclaration,
  SchemaContext,
  SchemaRenderContext,
  Identifier,
  AggregateDeclaration,
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
  context: SchemaRenderContext | null,
  identifier: string,
  expression?: string,
): Omit<ExpressionDeclaration, "name" | "path" | "context"> & {
  context: SchemaRenderContext | null;
} {
  if (context) {
    const { evaluationScope: scope } = context;

    const lookup = scope.lookup(identifier);

    if (isLookupExpr(lookup)) {
      return {
        ...lookup,
        expression: expression ?? lookup.expression,
        context: lookup.context
          ? { ...lookup.context, cycles: context.cycles }
          : null,
      } as typeof lookup & { context: SchemaRenderContext };
    }
  }

  return {
    identifier,
    context,
    expression: expression ?? null,
    hint: null,
    source:
      expression === undefined
        ? `{{}}`
        : `{{ = $$expr(${JSON.stringify(expression)}) }}`,
  };
}

async function renderIdentifierInExpression(
  renderContext: SchemaRenderContext,
  name: string,
  renderExpression?: string,
) {
  const lookup = renderContext?.evaluationScope.lookup(name);

  if (isLookupValue(lookup)) {
    return lookup.value;
  }

  const { context, expression, source, hint, rendered, aggregates } =
    synthesizeExpressionDeclaration(renderContext, name, renderExpression);

  if (!context) {
    if (aggregates) {
      return evaluateAggregates(aggregates);
    }
    throw new Error(
      `${renderContext ? loc(renderContext) : "unknown"} expected context rendering ${name}`,
    );
  }

  return context.evaluationScope.rendering(context, name, async (context) => {
    const identifier = parseScopedIdentifier(name);

    if (expression) {
      const result = await doRenderExpression(context, {
        identifier,
        expression,
        source,
        hint,
      });

      return result;
    }

    const ambientResult = await rendered?.(context);

    if (ambientResult !== undefined) {
      return ambientResult;
    }

    const result = await context.environment.evaluate({
      context,
      identifier,
    });

    if (result === undefined && aggregates) {
      return evaluateAggregates(aggregates);
    }

    return result;
  });
}

async function evaluateAggregates(
  aggregates: Record<string, AggregateDeclaration>,
) {
  const elements = Object.entries(aggregates).filter(
    ([, { type }]) => type === "element",
  );

  if (elements.length) {
    if (aggregates?.["@value"]?.type === "element") {
      const item = aggregates["@value"];
      const result: Promise<unknown>[] = [];
      for (let i = 0; item.specializations?.[i]; i++) {
        const { context, expression, name, aggregates } =
          item.specializations[i];
        result.push(
          aggregates
            ? evaluateAggregates(aggregates)
            : renderIdentifierInExpression(
                context as SchemaRenderContext,
                name,
                expression ?? undefined,
              ),
        );
      }
      return Promise.all(result);
    }

    const result: Record<string, Promise<unknown>>[] = [];
    elements.map(([key, item]) => {
      for (let i = 0; item.specializations?.[i]; i++) {
        const { context, expression, name, aggregates } =
          item.specializations[i];

        (result[i] ??= {})[key] = aggregates
          ? evaluateAggregates(aggregates)
          : renderIdentifierInExpression(
              context as SchemaRenderContext,
              name,
              expression ?? undefined,
            );
      }
    });

    return Promise.all(result.map(async (item) => await mapObjectAsync(item)));
  }

  const fields = Object.entries(aggregates).filter(
    ([, { type }]) => type === "field",
  );

  if (fields) {
    if (aggregates["@value"]?.type === "field") {
      const item = aggregates["@value"];

      const mapped = await mapObjectAsync(
        item.specializations ?? {},
        ({ context, expression, name, aggregates }) => {
          return aggregates
            ? evaluateAggregates(aggregates)
            : renderIdentifierInExpression(
                context as SchemaRenderContext,
                name,
                expression ?? undefined,
              );
        },
      );

      return mapped;
    }

    const result: Record<string, Record<string, Promise<unknown>>> = {};

    for (const [key, value] of fields) {
      for (const [
        field,
        { context, name, expression, aggregates },
      ] of Object.entries(value.specializations ?? {})) {
        (result[field] ??= {})[key] = aggregates
          ? evaluateAggregates(aggregates)
          : renderIdentifierInExpression(
              context as SchemaRenderContext,
              name,
              expression ?? undefined,
            );
      }
    }

    return mapObjectAsync(result, (value) => mapObjectAsync(value));
  }
}

export function resolveIdentifier(context: SchemaContext, identifier: string) {
  const { evaluationScope: scope } = context;
  const resolution = scope.resolve(context, identifier);

  if (isLookupValue(resolution)) {
    const declaration = scope.lookupDeclaration(identifier);

    if (
      declaration?.context &&
      resolution.context.evaluationScope !== declaration.context.evaluationScope
    ) {
      return;
    }

    return resolution.value;
  }
}
