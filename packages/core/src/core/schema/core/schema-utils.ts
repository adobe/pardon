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
  createPreviewContext,
  createRenderContext,
  createPrerenderContext,
  createPostrenderContext,
  ContextMeta,
  createMergingContext,
} from "./context.js";
import {
  Schema,
  SchemaMergingContext,
  SchemaScriptEnvironment,
  ScopeData,
  Template,
} from "./types.js";
import { executeOp, merge } from "./schema-ops.js";
import { isNoExport, isSecret } from "../definition/hinting.js";
import { diagnostic } from "./context-util.js";
import { isScalar, Scalar } from "../definition/scalar.js";

function applySchema<T>(
  context: SchemaMergingContext<T>,
  schema: Schema<T>,
): { context: SchemaMergingContext<T>; schema?: Schema<T>; error?: any } {
  try {
    const matchedSchema = merge(schema, context);

    if (matchedSchema && context.diagnostics.length) {
      for (const diagnostic of context.diagnostics) {
        console.warn(diagnostic.loc, diagnostic.err);
      }
      return { context };
      throw new Error(
        "unpropagated error (" + context.diagnostics.length + ")",
      );
    }

    return { context, schema: matchedSchema, error: undefined };
  } catch (error) {
    diagnostic(context, error);
    return { context, schema: undefined, error };
  }
}

export function mergeSchema<T>(
  how: ContextMeta,
  schema: Schema<T>,
  template: Template<T>,
  environment?: SchemaScriptEnvironment,
): { context?: SchemaMergingContext<T>; schema?: Schema<T>; error?: any } {
  try {
    return applySchema(
      createMergingContext(how, schema, template, environment),
      schema,
    );
  } catch (error) {
    return { error };
  }
}

export async function renderSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
) {
  const context = createRenderContext(schema, environment);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export async function prerenderSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
) {
  const context = createPrerenderContext(schema, environment);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export async function postrenderSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
) {
  const context = createPostrenderContext(schema, environment);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export async function previewSchema<T>(
  schema: Schema<T>,
  environment?: SchemaScriptEnvironment,
) {
  const context = createPreviewContext(schema, environment);
  const output = (await executeOp(schema, "render", context))!;

  return { output, context };
}

export function scopedScalarValues(
  data: ScopeData,
): { name: string; scope: string; value: Scalar }[] {
  const definitions = Object.entries(data.values)
    .map(
      ([
        name,
        {
          value,
          context: { evaluationScopePath: scopes },
          declaration,
        },
      ]) => {
        return (
          isScalar(value) &&
          !isNoExport(declaration) &&
          !isSecret(declaration) && {
            scope: scopes.map((part) => `:${part}`).join(""),
            name,
            value,
          }
        );
      },
    )
    .filter(Boolean);

  return [
    ...definitions,
    ...Object.values(data.subscopes || {}).flatMap((subscopeData) =>
      scopedScalarValues(subscopeData),
    ),
  ];
}
