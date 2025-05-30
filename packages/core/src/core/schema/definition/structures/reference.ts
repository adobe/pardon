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
import {
  diagnostic,
  isAbstractContext,
  rescope,
} from "../../core/context-util.js";
import { isMergingContext } from "../../core/schema.js";

type ReferenceSchema<T> = {
  refs: Set<string>;
  hint: string;
  schema?: Schema<T>;
  encoding?: ScalarType;
  anull?: true;
};

export type ReferenceSchematicOps<T> = SchematicOps<T> & {
  reference(): ReferenceTemplate<T>;
};

type ReferenceTemplate<T> = {
  ref?: string;
  hint?: string;
  template?: Template<T>;
  encoding?: Exclude<ScalarType, "null">;
  anull?: true;
};

export type ReferenceSchematic<T> = Schematic<T> & {
  $of<T>(template: Template<T>): ReferenceSchematic<T>;
  readonly $key: ReferenceSchematic<T>;
  readonly $value: ReferenceSchematic<T>;
  readonly $noexport: ReferenceSchematic<T>;
  readonly $redacted: ReferenceSchematic<T>;
  readonly $optional: ReferenceSchematic<T>;
  readonly $flow: ReferenceSchematic<T>;
  readonly $redact: ReferenceSchematic<T>;
  readonly $meld: ReferenceSchematic<T>;
  readonly $string: ReferenceSchematic<string>;
  readonly $bool: ReferenceSchematic<boolean>;
  readonly $number: ReferenceSchematic<number>;
  readonly $bigint: ReferenceSchematic<bigint>;
  readonly $nullable: ReferenceSchematic<T | null>;
} & {
  [_: string]: ReferenceSchematic<any>;
};

export function isReferenceSchematic<T>(
  s: unknown,
): s is ReferenceSchematic<T> {
  return (
    isSchematic<T>(s) &&
    Boolean(exposeSchematic<ReferenceSchematicOps<T>>(s).reference)
  );
}

export function referenceTemplate<T = unknown>(
  reference: ReferenceTemplate<T>,
): ReferenceSchematic<T> {
  const referenceSchematic = defineSchematic<ReferenceSchematicOps<T>>({
    expand(context) {
      const schema = defineReference({
        refs: new Set([reference.ref].filter(Boolean)),
        hint: reference.hint ?? "",
        schema:
          reference.template !== undefined
            ? context.expand(reference.template)
            : undefined,
        encoding: reference.encoding,
        anull: reference.anull,
      });

      const value = reference.ref
        ? context.evaluationScope.resolve(context, reference.ref)
        : undefined;

      if (value?.value !== undefined) {
        return merge(schema, { ...context, template: value.value as T });
      }

      return schema;
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

      let schema = next({ ...context, template });
      if (schema && context.template !== undefined) {
        if (!isSchematic(context.template)) {
          schema = merge(schema, context);
        }
      }

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
      if (typeof property !== "symbol" && !property.startsWith("$")) {
        return referenceTemplate({
          ...reference,
          ref: `${reference.ref}.${property}`,
        });
      }

      return (
        target[property] ??
        {
          get $noexport() {
            return referenceTemplate({
              ...reference,
              hint: `${reference.hint ?? ""}:`,
            });
          },
          get $redacted() {
            return referenceTemplate({
              ...reference,
              hint: `${reference.hint ?? ""}@`,
            });
          },
          get $optional() {
            return referenceTemplate({
              ...reference,
              hint: `${reference.hint ?? ""}?`,
            });
          },
          get $required() {
            return referenceTemplate({
              ...reference,
              hint: `${reference.hint ?? ""}!`,
            });
          },
          get $meld() {
            return referenceTemplate({
              ...reference,
              hint: `${reference.hint ?? ""}~`,
            });
          },
          get $flow() {
            return referenceTemplate({
              ...reference,
              hint: `${reference.hint ?? ""}+`,
            });
          },
          get $redact() {
            return referenceTemplate({
              ...reference,
              hint: `${reference.hint ?? ""}@`,
            });
          },
          ...(reference.ref && {
            get $value() {
              return referenceTemplate({
                ...reference,
                ref: `${reference.ref}.@value`,
              });
            },
            get $key() {
              return referenceTemplate({
                ...reference,
                ref: `${reference.ref}.@key`,
              });
            },
          }),
          $of(template: Template<T>) {
            return referenceTemplate({
              ...reference,
              template,
            });
          },
          get $string() {
            return referenceTemplate({
              ...reference,
              encoding: "string",
            });
          },
          get $number() {
            return referenceTemplate({
              ...reference,
              encoding: "number",
            });
          },
          get $bigint() {
            return referenceTemplate({
              ...reference,
              encoding: "bigint",
            });
          },
          get $bool() {
            return referenceTemplate({
              ...reference,
              encoding: "boolean",
            });
          },
          get $null() {
            return referenceTemplate({
              ...reference,
              anull: true,
            });
          },
        }[property]
      );
    },
  });
}

function extractReference<T>({
  template,
}: SchemaMergingContext<T>): ReferenceTemplate<T> | undefined {
  if (isSchematic(template)) {
    const ops = exposeSchematic<ReferenceSchematicOps<T>>(template);

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
          diagnostic(context, "incompatible encodings");
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
          tryResolve(context, merged);
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

      if (context.mode === "match") {
        if (context.template !== undefined) {
          // commitResolution({ resolved: context.template as T }, context);
        }
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

      let nextSchema = schema;

      if (encoding) {
        nextSchema = merge(schema ?? stubSchema(), {
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

        if (!nextSchema) {
          return;
        }
      }

      const resolved = isAbstractContext(context)
        ? undefined
        : resolveReference(context, nextSchema);

      nextSchema = merge(nextSchema ?? stubSchema(), {
        ...context,
        template: resolved ?? context.template,
      });

      if (
        nextSchema &&
        resolved !== undefined &&
        context.template !== undefined
      ) {
        nextSchema = merge(nextSchema, context);
      }

      if (nextSchema) {
        tryResolve(context, nextSchema);
      }

      return (
        nextSchema &&
        defineReference({ ...referenceSchema, schema: nextSchema })
      );
    },
    async render(context) {
      if (schema) {
        const result = await renderReference(schema, context);

        // if the schema was a stub, we'll try to derive the value
        // by evaluating the refs.
        if (result !== undefined) {
          return convertScalar(result, encoding, { anull }) as T;
        }
      }

      for (const ref of refs) {
        const value = (
          context.mode === "render"
            ? await evaluateIdentifierWithExpression(context, ref)
            : undefined
        ) as T | undefined;

        defineRenderedReferenceValue(context, value);

        return convertScalar(value, encoding, { anull }) as T;
      }

      return anull ? (null as T) : undefined!;
    },
    scope(context) {
      for (const ref of refs) {
        declareRef(context, { ref, hint });

        if (!isMergingContext(context) && isAbstractContext(context)) {
          context.evaluationScope.resolve(context, ref);
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

    const { evaluationScope: scope } = context;

    scope.declare(ref, {
      context,
      expression: null,
      hint: hint || null,
      source: null,
      resolved(context) {
        return resolveReference(rescope(context, scope) as SchemaContext<T>);
      },
      async rendered(context) {
        return await renderReference(schema, rescope(context, scope));
      },
    });
  }

  function tryResolve(context: SchemaContext<T>, schema: Schema<T>) {
    const resolution = maybeResolveRef(context, schema);

    if (resolution?.resolved !== undefined) {
      commitResolution(resolution, context);

      return resolution.resolved;
    }
  }

  function commitResolution(
    resolution: { ref?: string; resolved?: T },
    context: SchemaContext<T>,
  ) {
    for (const ref of refs) {
      if (ref !== resolution.ref) {
        context.evaluationScope.define(context, ref, resolution.resolved);
      }
    }

    return resolution.resolved;
  }

  function maybeResolveRef(
    context: SchemaContext<T>,
    schema?: Schema<T>,
  ):
    | {
        ref?: string;
        resolved: T;
      }
    | undefined {
    const resolved = schema && maybeResolve(schema, context);

    if (resolved !== undefined) {
      return { resolved };
    }

    for (const ref of refs) {
      const resolved = context.evaluationScope.resolve(context, ref);

      if (resolved?.value !== undefined) {
        return { ref, resolved: resolved.value as T };
      }
    }
  }

  function resolveReference(context: SchemaContext<T>, withSchema?: Schema<T>) {
    const resolution = maybeResolveRef(context, withSchema ?? schema);

    return resolution && commitResolution(resolution, context);
  }

  async function renderReference(
    schema: Schema<T> | undefined,
    context: SchemaRenderContext,
  ) {
    let result: T | string | undefined;

    if (schema) {
      result = await executeOp(schema, "render", context);
    }

    if (result === undefined) {
      result = resolveReference(context, schema);
    }

    const defined = defineRenderedReferenceValue(context, result as T);

    if (
      isSecret(referenceSchema) &&
      typeof defined === "string" &&
      context.mode !== "preview" &&
      "{{redacted}}" == defined
    ) {
      return `{{ @${[...refs][0]} }}`;
    }

    return defined;
  }

  function defineRenderedReferenceValue(
    context: SchemaRenderContext,
    result?: T,
  ) {
    if (result === undefined) {
      return;
    }

    for (const ref of refs) {
      const identifier = parseScopedIdentifier(ref);

      if (!context.evaluationScope.evaluating(identifier.name)) {
        context.evaluationScope.define(context, ref, result);
      }
    }

    return result;
  }
}
