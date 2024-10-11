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
  maybeResolve,
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
import { redact, RedactedOps } from "./redact.js";
import { isSecret } from "../hinting.js";
import {
  convertScalar,
  Scalar,
  scalarFuzzyTypeOf,
  ScalarType,
} from "../scalar.js";
import { datumTemplate } from "../datum.js";

type ReferenceSchema<T> = {
  refs: Set<string>;
  hint: string;
  schema?: Schema<T>;
  encoding?: ScalarType;
  anull?: true;
};

export type ReferenceTemplateOps<T> = SchematicOps<T> & {
  reference(): ReferenceTemplate<T>;
};

type ReferenceTemplate<T> = {
  ref?: string;
  hint?: string;
  template?: Template<T>;
  encoding?: Exclude<ScalarType, "null">;
  anull?: true;
};

type ReferenceSchematic<T> = Schematic<T> & {
  of<T>(template: Template<T>): ReferenceSchematic<T>;
  readonly key: ReferenceSchematic<T>;
  readonly value: ReferenceSchematic<T>;
  readonly noexport: ReferenceSchematic<T>;
  readonly optional: ReferenceSchematic<T>;
  readonly redact: ReferenceSchematic<T>;
  readonly meld: ReferenceSchematic<T>;
  readonly string: ReferenceSchematic<string>;
  readonly bool: ReferenceSchematic<boolean>;
  readonly number: ReferenceSchematic<number>;
  readonly bigint: ReferenceSchematic<bigint>;
  readonly nullable: ReferenceSchematic<T | null>;
  [_: `$${string}`]: ReferenceSchematic<T>;
};

export function isReferenceSchematic<T>(
  s: unknown,
): s is ReferenceSchematic<T> {
  return (
    isSchematic<T>(s) &&
    Boolean(exposeSchematic<ReferenceTemplateOps<T>>(s).reference)
  );
}

export function referenceTemplate<T = unknown>(
  reference: ReferenceTemplate<T>,
): ReferenceSchematic<T> {
  const referenceSchematic = defineSchematic<ReferenceTemplateOps<T>>({
    expand(context) {
      return defineReference({
        refs: new Set([reference.ref].filter(Boolean)),
        hint: reference.hint ?? "",
        schema:
          reference.template !== undefined
            ? expandTemplate(reference.template, context)
            : undefined,
        encoding: reference.encoding,
        anull: reference.anull,
      });
    },
    blend(context, next) {
      let { template } = reference;
      const hint = new Set([...(reference.hint ?? "")]);

      if (isSchematic(template)) {
        const ops = exposeSchematic<RedactedOps<T>>(template);
        if (ops.redacted) {
          hint.add("@");
        }
      } else if (isSecret(reference)) {
        template = redact(template);
        hint.add("@");
      }

      const schema = next({ ...context, template });

      if (template !== undefined && !schema) {
        return;
      }

      return defineReference({
        refs: new Set([reference.ref].filter(Boolean)),
        hint: [...hint].join(""),
        schema,
        encoding: reference.encoding,
        anull: reference.anull,
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
              return referenceTemplate({
                ...reference,
                hint: `${reference.hint ?? ""}:`,
              });
            },
            get optional() {
              return referenceTemplate({
                ...reference,
                hint: `${reference.hint ?? ""}?`,
              });
            },
            get required() {
              return referenceTemplate({
                ...reference,
                hint: `${reference.hint ?? ""}!`,
              });
            },
            get meld() {
              return referenceTemplate({
                ...reference,
                hint: `${reference.hint ?? ""}~`,
              });
            },
            get redact() {
              return referenceTemplate({
                ...reference,
                hint: `${reference.hint ?? ""}@`,
              });
            },
            ...(reference.ref && {
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
            }),
            of(template: Template<T>) {
              return referenceTemplate({
                ...reference,
                template,
              });
            },
            get string() {
              return referenceTemplate({
                ...reference,
                encoding: "string",
              });
            },
            get number() {
              return referenceTemplate({
                ...reference,
                encoding: "number",
              });
            },
            get bigint() {
              return referenceTemplate({
                ...reference,
                encoding: "bigint",
              });
            },
            get bool() {
              return referenceTemplate({
                ...reference,
                encoding: "boolean",
              });
            },
            get null() {
              return referenceTemplate({
                ...reference,
                anull: true,
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
  const { refs, hint, schema, encoding, anull } = referenceSchema;

  return defineSchema<T>({
    merge(context) {
      const info = extractReference(context);

      if (info) {
        const { ref } = info;
        const mergedHint = `${hint}${info.hint ?? ""}`;

        let merged = schema;

        if (info.encoding && encoding && info.encoding !== encoding) {
          return;
        }

        if (info.template !== undefined) {
          merged = merge(schema ?? stubSchema(), {
            ...context,
            template: info.template,
          });

          if (!merged) {
            return;
          }
        }

        if (merged) {
          tryResolve(merged, context);
        }

        if (ref) {
          declareRef(context, {
            ref,
            hint: mergedHint,
          });
        }

        return defineReference({
          refs: new Set([...refs, info.ref].filter(Boolean)),
          hint: mergedHint,
          schema: merged,
          encoding: info.encoding ?? encoding,
          anull: info.anull || anull,
        });
      }

      if (schema) {
        tryResolve(schema, context);
      }

      if (context.template === undefined) {
        return defineReference(referenceSchema);
      }

      if (encoding && !isSchematic(context.template)) {
        const templateType = scalarFuzzyTypeOf(context, context.template as T);
        if (
          templateType &&
          templateType !== encoding &&
          !(templateType === "number" && encoding === "bigint")
        ) {
          return;
        }
      }

      let mergeSchema = schema;

      if (encoding) {
        mergeSchema = merge(schema ?? stubSchema(), {
          ...context,
          template: datumTemplate(
            context.mode === "match"
              ? (context.template as T & Scalar)
              : undefined,
            {
              type: encoding,
            },
          ) as Schematic<T>,
        });

        if (!mergeSchema) {
          return;
        }
      }

      const merged = merge(mergeSchema ?? stubSchema(), context);
      if (!merged) {
        return undefined;
      }

      if (merged) {
        tryResolve(merged, context);
      }

      return defineReference({ ...referenceSchema, schema: merged });
    },
    async render(context) {
      if (schema) {
        const result = await renderReference(schema, context);

        // if the schema was a stub, we'll try to derive the value
        // by evaluating the refs.
        if (result !== undefined) {
          return convertScalar(result, encoding, anull) as T;
        }
      }

      for (const ref of refs) {
        const value = (
          context.mode === "render"
            ? await evaluateIdentifierWithExpression(context, ref)
            : undefined
        ) as T | undefined;

        defineReferenceValue(context, value);

        return convertScalar(value, encoding, anull) as T;
      }

      return anull ? (null as T) : undefined!;
    },
    scope(context) {
      const { scope } = context;

      for (const ref of refs) {
        declareRef(context, { ref, hint });

        if (!isMergingContext(context)) {
          scope.resolve(context, ref);
        }
      }

      if (schema) {
        executeOp(schema as Schema<unknown>, "scope", context);
      }
    },
  });

  function declareRef(
    context: SchemaContext,
    { ref, hint }: { ref?: string; hint?: string },
  ) {
    if (!ref) {
      return;
    }

    const { scope } = context;

    scope.declare(ref, {
      context,
      expr: null,
      hint: hint || null,
      source: null,
      resolved(context) {
        return resolveReference(rescope(context, scope));
      },
      async rendered(context) {
        return await renderReference(schema, rescope(context, scope));
      },
    });
  }

  function tryResolve<T>(schema: Schema<T>, context: SchemaContext<T>) {
    const resolved = schema && maybeResolve(schema, context);

    if (resolved !== undefined) {
      for (const ref of refs) {
        context.scope.define(context, ref, resolved);
      }

      return resolved;
    }
  }

  function resolveReference(context: SchemaContext<unknown>) {
    const resolved = schema && tryResolve(schema, context);
    if (resolved !== undefined) {
      return resolved;
    }

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
  }

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
