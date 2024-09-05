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
import { evaluateIdentifierWithExpression } from "../../core/evaluate.js";
import { rescope } from "../../core/schema-utils.js";
import {
  SchematicOps,
  Schema,
  defineSchema,
  executeOp,
  isMatchingContext,
  SchemaRenderContext,
} from "../../core/schema.js";
import { parseScopedIdentifier } from "../../core/scope.js";
import { expandTemplate, templateTrampoline } from "../../template.js";
import { stubSchema } from "./stub-schema.js";

type ReferenceOps<T = unknown> = SchematicOps<T> & {
  reference(): string;
  schema(): Schema<T>;
  hint(): string;
};

type ReferenceSchemaOptions<T> = {
  hint?: string;
  schema?: Schema<T>;
};

export function referenceSchema<T = unknown>(
  reference: string,
  { schema = stubSchema(), hint = "" }: ReferenceSchemaOptions<T> = {},
): Schema<T> {
  const identifier = parseScopedIdentifier(reference);

  const schemaDefintion = defineSchema<ReferenceOps<T>>({
    merge(context) {
      const merged = executeOp(schema, "merge", context);

      if (merged && context.stub !== undefined) {
        context.scope.define(context, reference, context.stub);
      }

      return merged && referenceSchema(reference, { schema: merged, hint });
    },
    async render(context) {
      const value = context.scope.resolve(context, reference);

      if (value) {
        return value.value as T;
      }

      const result =
        (await executeOp(schema, "render", context)) ??
        ((context.mode === "render"
          ? await evaluateIdentifierWithExpression(context, reference)
          : undefined) as T);

      context.scope.define(context, reference, result);

      return result;
    },
    scope(context) {
      const { scope } = context;
      scope.declare(reference, {
        context,
        expr: null,
        hint,
        source: null,
        // might we need resolved() { ... } too?
        async rendered(context) {
          return renderReference(rescope(context, scope));
        },
      });

      if (isMatchingContext(context) && context.stub !== undefined) {
        context.scope.define(context, reference, context.stub);
      }

      executeOp(schema, "scope", context);
    },
    reference() {
      return reference;
    },
    schema() {
      return schema;
    },
    hint() {
      return hint;
    },
  });

  // copied from capture-schema (might not be necessary!)
  async function renderReference(context: SchemaRenderContext) {
    const value = await executeOp(schema, "render", context);

    if (!context.scope.evaluating(identifier.name)) {
      context.scope.define(context, reference, value);
    }

    return value;
  }

  return new Proxy(schemaDefintion, {
    get(target, property) {
      if (typeof property === "symbol" || !property.startsWith("$")) {
        return (
          target[property] ??
          {
            get noexport() {
              // use the redacted() schema node for redacting on render,
              // this is more of a hack to create a variable that's primarily
              // for internal use by the render (for signing requests, etc...).
              return referenceSchema(reference, { hint: "@", schema });
            },
            get value() {
              return referenceSchema(`${reference}.@value`, { hint, schema });
            },
            get key() {
              return referenceSchema(`${reference}.@key`, { hint, schema });
            },
            of(definition: unknown) {
              return templateTrampoline((context) =>
                referenceSchema(reference, {
                  hint,
                  schema: expandTemplate(definition, context),
                }),
              );
            },
          }[property]
        );
      }

      return referenceSchema(`${reference}.${property.slice(1)}`, {
        hint,
        schema,
      });
    },
  });
}
