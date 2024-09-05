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
  arrayIntoObject,
  mapObject,
  mapObjectAsync,
} from "../../../util/mapping.js";
import {
  SchematicOps,
  Schema,
  defineSchema,
  executeOp,
  SchemaCaptureContext,
  SchemaRenderContext,
  SchemaMergingContext,
} from "../core/schema.js";
import { keyContext, fieldScopeContext } from "../core/context.js";
import { stubSchema } from "./structures/stub-schema.js";

type ObjectOptions = {
  scoped?: boolean;
};

type ObjectOps<M extends Record<string, unknown>> = SchematicOps<M> & {
  object(): { [K in keyof M]: Schema<M[K]> };
  valueSchema(): Schema<M[keyof M]>;
  options(): ObjectOptions;
};

function defineObject<M extends Record<string, unknown>>(
  object: {
    [K in keyof M]: Schema<M[K]>;
  },
  valueSchema: Schema<M[keyof M]> = stubSchema(),
  options: ObjectOptions = {},
) {
  function fieldContext(context: SchemaCaptureContext<M>, key: string) {
    return options.scoped
      ? fieldScopeContext(context, key)
      : keyContext(context, key);
  }

  return defineSchema<ObjectOps<M>>({
    scope(context) {
      inflateScope(context);
      const inflated = inflatedObject(context);

      for (const [key, value] of Object.entries(inflated)) {
        executeOp(value, "scope", fieldContext(context, key));
      }
    },
    merge(context) {
      const { stub } = context;
      const inflated = inflatedObject(context);

      const matchedObjectEntries = [
        ...new Set([...Object.keys(inflated), ...Object.keys(stub || {})]),
      ].map((key) => {
        const keymatch = executeOp(
          object[key] ?? valueSchema,
          "merge",
          fieldContext(context, key) as SchemaMergingContext<M[string]>,
        );

        return [key, keymatch] as const;
      });

      if (matchedObjectEntries.some(([, v]) => v === undefined)) {
        return undefined;
      }

      const matchedObject = arrayIntoObject(matchedObjectEntries, ([k, v]) => ({
        [k]: v,
      })) as any;

      return defineObject(matchedObject, valueSchema, options);
    },
    async render(context) {
      const inflated = await inflateRender(context);

      return mapObjectAsync(inflated as Record<string, Schema<M[keyof M]>>, {
        values(field, key) {
          return executeOp(
            field,
            "render",
            fieldContext(context, key) as SchemaRenderContext,
          );
        },
        filter(_key, mapped) {
          return mapped !== undefined;
        },
      }) as Promise<M>;
    },
    object() {
      return object;
    },
    valueSchema() {
      return valueSchema;
    },
    options() {
      return options;
    },
  });

  function inflateScope(context: SchemaCaptureContext<M>) {
    const inflationSchema = fieldScopeContext(context, undefined);

    executeOp(
      valueSchema,
      "scope",
      inflationSchema as SchemaCaptureContext<M[keyof M]>,
    );
  }

  function inflatedObject(context: SchemaCaptureContext<M>) {
    const inflationSchema = fieldScopeContext(context, undefined);

    return arrayIntoObject(
      [
        object,
        ...(inflationSchema.scope.index?.struts
          ?.map((strut) => {
            return context.environment.resolve({
              context,
              ident: strut,
            });
          })
          .filter((input) => input !== undefined)
          .map((input) =>
            mapObject(input as Record<string, unknown>, () => valueSchema),
          ) || []),
      ],
      (value) => {
        return value;
      },
    );
  }

  async function inflateRender(context: SchemaRenderContext) {
    const inflationSchema = fieldScopeContext(context, undefined);
    executeOp(valueSchema, "scope", inflationSchema);

    return arrayIntoObject(
      [
        object,
        ...(
          await Promise.all(
            inflationSchema.scope.index?.struts?.map(async (strut) => {
              return await context.environment.evaluate({
                context,
                ident: strut,
              });
            }) || [],
          )
        )
          .filter((values) => values !== undefined)
          .map((values) =>
            mapObject(values as Record<string, unknown>, () => valueSchema),
          ),
      ],
      (value) => {
        return value;
      },
    );
  }
}

export const objects = {
  object: (
    object: Record<string, Schema<unknown>>,
    valueSchema?: Schema<unknown>,
  ) => defineObject(object, valueSchema, {}),

  scoped: (
    object: Record<string, Schema<unknown>>,
    valueSchema?: Schema<unknown>,
  ) => defineObject(object, valueSchema, { scoped: true }),
};
