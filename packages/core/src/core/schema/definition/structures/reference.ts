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
import {
  defineSchema,
  defineSchematic,
  executeOp,
  exposeSchematic,
  isSchematic,
  merge,
} from "../../core/schema-ops.js";
import { rescope } from "../../core/context.js";
import { isMergingContext } from "../../core/schema.js";
import { parseScopedIdentifier } from "../../core/scope.js";
import {
  Schema,
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  Schematic,
  SchematicOps,
  Template,
} from "../../core/types.js";
import { expandTemplate } from "../../template.js";
import { stubSchema } from "./stub.js";
import { RedactedOps } from "./redact.js";

type ReferenceSchema<T> = {
  refs: Set<string>;
  hint: string;
  schema?: Schema<T>;
};

type ReferenceTemplateOps<T> = SchematicOps<T> & {
  reference(): ReferenceTemplate<T>;
};

type ReferenceTemplate<T> = {
  ref: string;
  hint?: string;
  template?: Template<T>;
};

type ReferenceSchematic<T> = Schematic<T> & {
  of<T>(template: Template<T>): ReferenceSchematic<T>;
  readonly key: ReferenceSchematic<T>;
  readonly value: ReferenceSchematic<T>;
  readonly noexport: ReferenceSchematic<T>;
  readonly optional: ReferenceSchematic<T>;
  [_: `$${string}`]: ReferenceSchematic<T>;
};

export function referenceTemplate<T = unknown>(
  reference: ReferenceTemplate<T>,
): ReferenceSchematic<T> {
  const referenceSchematic = defineSchematic<ReferenceTemplateOps<T>>({
    expand(context) {
      return defineReference({
        refs: new Set([reference.ref]),
        hint: reference.hint ?? "",
        schema:
          reference.template !== undefined
            ? expandTemplate(reference.template, context)
            : undefined,
      });
    },
    blend(context, next) {
      const schema = next({ ...context, template: reference.template });

      if (reference.template !== undefined && !schema) {
        return;
      }

      let autohint = "";
      if (isSchematic(reference.template)) {
        const ops = exposeSchematic<RedactedOps<T>>(reference.template);
        if (ops.redacted) {
          // apply noexport
          autohint += "@";
        }
      }

      return defineReference({
        refs: new Set([reference.ref]),
        hint: `${reference.hint ?? ""}${autohint}`,
        schema,
      });
    },
    reference() {
      return reference;
    },
  });

  return new Proxy<any>(referenceSchematic, {
    get(target, property) {
      if (typeof property === "symbol" || !property.startsWith("$")) {
        return (
          target[property] ??
          {
            get noexport() {
              // use the redacted() schema node for redacting on render,
              // this is more of a hack to create a variable that's primarily
              // for internal use by the render (for signing requests, etc...).
              return referenceTemplate({
                ...reference,
                hint: `${reference.hint ?? ""}@`,
              });
            },
            get optional() {
              // use the redacted() schema node for redacting on render,
              // this is more of a hack to create a variable that's primarily
              // for internal use by the render (for signing requests, etc...).
              return referenceTemplate({
                ...reference,
                hint: `${reference.hint ?? ""}?`,
              });
            },
            get value() {
              return referenceTemplate({
                ...reference,
                ref: `${reference.ref}.@value`,
              });
            },
            get key() {
              return referenceTemplate({
                ...reference,
                ref: `${reference.ref}.@key`,
              });
            },
            of(template: Template<T>) {
              return referenceTemplate({
                ...reference,
                template,
              });
            },
          }[property]
        );
      }

      return referenceTemplate({
        ...reference,
        ref: `${reference.ref}.${property.slice(1)}`,
      });
    },
  });
}

function extractReference<T>({
  template,
}: SchemaMergingContext<T>): ReferenceTemplate<T> | undefined {
  if (isSchematic(template)) {
    const ops = exposeSchematic<ReferenceTemplateOps<T>>(template);

    if (ops.reference) {
      return ops.reference();
    }
  }
}

export function defineReference<T = unknown>(
  referenceSchema: ReferenceSchema<T>,
): Schema<T> {
  const { refs, hint, schema } = referenceSchema;

  return defineSchema<T>({
    merge(context) {
      const info = extractReference(context);

      if (info) {
        if (info.template !== undefined) {
          const merged = merge(schema ?? stubSchema(), {
            ...context,
            template: info.template,
          });

          return (
            merged &&
            defineReference({
              refs: new Set([...refs, info.ref]),
              hint: `${hint}${info.hint ?? ""}`,
              schema: merged,
            })
          );
        }

        return defineReference({
          refs: new Set([...refs, info.ref]),
          hint: `${hint}${info.hint ?? ""}`,
          schema,
        });
      }

      if (context.template === undefined) {
        return defineReference(referenceSchema);
      }

      const merged = merge(schema ?? stubSchema(), context);
      if (!merged) {
        return undefined;
      }

      if (
        context.template !== undefined &&
        typeof context.template !== "function"
      ) {
        defineReferenceValue(context, context.template as T);
      }

      return defineReference({ ...referenceSchema, schema: merged });
    },
    async render(context) {
      if (schema) {
        const result = await renderReference(schema, context);

        // if the schema was a stub, we'll try to derive the value
        // by evaluating the refs.
        if (result !== undefined) {
          return result;
        }
      }

      for (const ref of refs) {
        const value = (
          context.mode === "render"
            ? await evaluateIdentifierWithExpression(context, ref)
            : undefined
        ) as T | undefined;

        defineReferenceValue(context, value);

        return value as T;
      }

      return undefined!;
    },
    scope(context) {
      const { scope } = context;

      for (const ref of refs) {
        scope.declare(ref, {
          context,
          expr: null,
          hint,
          source: null,
          // might we need resolved() { ... } too?
          async rendered(context) {
            return await renderReference(schema, rescope(context, scope));
          },
        });

        if (isMergingContext(context) && context.template !== undefined) {
          context.scope.define(context, ref, context.template as T);
        }
      }

      if (schema) {
        executeOp(schema as Schema<unknown>, "scope", context);
      }
    },
  });

  async function renderReference(
    schema: Schema<T> | undefined,
    context: SchemaRenderContext,
  ) {
    for (const ref of refs) {
      const value = context.scope.resolve(context, ref);

      if (value != undefined) {
        for (const other of refs) {
          if (other !== ref) {
            context.scope.define(context, other, value);
          }
        }

        return value.value as T;
      }
    }

    const result = schema && (await executeOp(schema, "render", context));

    return defineReferenceValue(context, result);
  }

  function defineReferenceValue(context: SchemaContext<T>, result?: T) {
    if (result === undefined) {
      return;
    }

    for (const ref of refs) {
      const identifier = parseScopedIdentifier(ref);

      if (!context.scope.evaluating(identifier.name)) {
        context.scope.define(context, ref, result);
      }
    }

    return result;
  }
}
