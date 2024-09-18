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
import {
  createPreviewContext,
  createRenderContext,
  createPrerenderContext,
  createPostrenderContext,
  SchemaMergeType,
  createMergingContext,
} from "./context.js";
import { isScalar, Scalar } from "../definition/scalar-type.js";
import {
  Schema,
  SchemaMergingContext,
  SchemaScope,
  SchemaScriptEnvironment,
  ScopeData,
  Template,
} from "./types.js";
import { executeOp, merge } from "./schema-ops.js";
import { isSecret } from "../definition/hinting.js";
import { diagnostic } from "./context-util.js";

function applySchema<T>(
  context: SchemaMergingContext<T>,
  schema: Schema<T>,
): { context: SchemaMergingContext<T>; schema?: Schema<T>; error?: any } {
  try {
    const matchedSchema = merge(schema, context);

    if (matchedSchema && context.diagnostics.length) {
      throw new Error("unreported error");
    }

    return { context, schema: matchedSchema, error: undefined };
  } catch (error) {
    diagnostic(context, error);
    return { context, schema: undefined, error };
  }
}

export function mergeSchema<T>(
  how: SchemaMergeType,
  schema: Schema<T>,
  template: Template<T>,
  environment?: SchemaScriptEnvironment,
) {
  return applySchema(
    createMergingContext(how, schema, template, environment),
    schema,
  );
}

export async function renderSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
  scope?: SchemaScope,
) {
  const context = createRenderContext(schema, environment, scope);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export async function prerenderSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
  scope?: SchemaScope,
) {
  const context = createPrerenderContext(schema, environment, scope);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export async function postrenderSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
  scope?: SchemaScope,
) {
  const context = createPostrenderContext(schema, environment, scope);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export async function previewSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
  previousScope?: SchemaScope,
) {
  const context = createPreviewContext(schema, environment, previousScope);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export function unredactedScalarValues(
  data: ScopeData,
): { ident: string; scope: string; value: Scalar }[] {
  const definitions = Object.entries(data.values)
    .map(
      ([
        ident,
        {
          value,
          context: { scopes },
          expr,
        },
      ]) => {
        return (
          isScalar(value) &&
          !isSecret(expr) && {
            scope: scopes.map((part) => `:${part}`).join(""),
            ident,
            value,
          }
        );
      },
    )
    .filter(Boolean);

  return [
    ...definitions,
    ...Object.values(data.subscopes || {}).flatMap((subscopeData) =>
      unredactedScalarValues(subscopeData),
    ),
  ];
}

export function unredactedValues(
  data: ScopeData,
): { ident: string; scope: string; value: unknown }[] {
  const definitions = Object.entries(data.values)
    .map(
      ([
        ident,
        {
          value,
          context: { scopes },
          expr,
        },
      ]) => {
        return (
          !isSecret(expr) && {
            scope: scopes.map((part) => `:${part}`).join(""),
            ident,
            value,
          }
        );
      },
    )
    .filter(Boolean);

  return [
    ...definitions,
    ...Object.values(data.subscopes || {}).flatMap((subscopeData) =>
      unredactedScalarValues(subscopeData),
    ),
  ];
}
