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

import type {
  Schema,
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  Schematic,
  SchematicOps,
  Template,
} from "../../core/types.js";
import type { RedactedOps } from "./redact.js";
import { evaluateIdentifierWithExpression } from "../../core/evaluate.js";
import {
  defineSchema,
  defineSchematic,
  executeOp,
  exposeSchematic,
  isSchematic,
  merge,
  maybeResolve,
  directMerge,
} from "../../core/schema-ops.js";
import { isStubSchema, stubSchema } from "./stub.js";
import { isExport, isOptional, isRequired, isSecret } from "../hinting.js";
import {
  type Scalar,
  type ScalarType,
  convertScalar,
  scalarFuzzyTypeOf,
} from "../scalar.js";
import { datumTemplate } from "../datum.js";
import {
  diagnostic,
  isAbstractContext,
  rescope,
} from "../../core/context-util.js";
import { isMergingContext } from "../../core/schema.js";
import { patternize } from "../../core/pattern.js";
import { isLookupExpr, isLookupValue } from "../../core/scope.js";

type ReferenceInfo<T> = {
  refs: Set<string>;
  hint: string;
  schema?: Schema<T>;
  encoding?: ScalarType;
  anull?: true;
  expr?: string;
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
  expr?: string;
};

export type ReferenceSchematic<T> = Schematic<T> & {
  $expr(expr: string): ReferenceSchematic<T>;
  readonly $key: ReferenceSchematic<T>;
  readonly $value: ReferenceSchematic<T>;
  readonly $noexport: ReferenceSchematic<T>;
  readonly $required: ReferenceSchematic<T>;
  readonly $secret: ReferenceSchematic<T>;
  readonly $optional: ReferenceSchematic<T>;
  readonly $export: ReferenceSchematic<T>;
  readonly $distinct: ReferenceSchematic<T>;
  readonly $string: ReferenceSchematic<string>;
  readonly $bool: ReferenceSchematic<boolean>;
  readonly $boolean: ReferenceSchematic<boolean>;
  readonly $number: ReferenceSchematic<number>;
  readonly $bigint: ReferenceSchematic<bigint>;
  readonly $null: ReferenceSchematic<T | null>;
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

const types = {
  $string: { encoding: "string" },
  $number: { encoding: "number" },
  $bigint: { encoding: "bigint" },
  $bool: { encoding: "boolean" },
  $boolean: { encoding: "boolean" },
  $null: { anull: true },
  $nullable: { anull: true },
};

const hints = {
  $noexport: "-",
  $secret: "@",
  $optional: "?",
  $required: "!",
  $distinct: "~",
  $export: "+",
};

export function referenceTemplate<T = unknown>(
  reference: ReferenceTemplate<T>,
): ReferenceSchematic<T> {
  const referenceSchematic = defineSchematic<ReferenceSchematicOps<T>>({
    expand(context) {
      const { ref } = reference;

      const schema = defineReference({
        refs: new Set([ref].filter(Boolean)),
        hint: reference.hint ?? "",
        schema:
          reference.template !== undefined
            ? context.expand(reference.template)
            : undefined,
        encoding: reference.encoding,
        anull: reference.anull,
        expr: reference.expr,
      });

      const value = ref
        ? context.evaluationScope.resolve(context, ref)
        : undefined;

      if (value?.value !== undefined) {
        return merge(schema, { ...context, template: value.value as T });
      }

      return schema;
    },
    blend(context, next) {
      let { template } = reference;
      const { ref } = reference;
      let hint = reference.hint ?? "";

      while (isSchematic(template)) {
        const ops = exposeSchematic<RedactedOps<T>>(template);

        if (!ops.redacted) {
          break;
        }

        if (!hint.includes("@")) hint += "@";
        template = ops.template;
      }

      let schema = next({ ...context, template });

      if (template !== undefined && !schema) {
        return;
      }

      if (schema && references.has(schema)) {
        return directMerge(schema, context);
      }

      if (schema && !isSchematic(context.template)) {
        schema = merge(schema, context);
      }

      if (template !== undefined && !schema) {
        return;
      }

      schema = defineReference({
        refs: new Set([ref].filter(Boolean)),
        hint,
        schema,
        encoding: reference.encoding,
        anull: reference.anull,
        expr: reference.expr,
      });

      return schema;
    },
    reference() {
      return reference;
    },
  });

  return new Proxy<any>(referenceSchematic, {
    get(target, property) {
      if (typeof property === "symbol") {
        return target[property];
      }

      if (!property.startsWith("$")) {
        return referenceTemplate({
          ...reference,
          ref: `${reference.ref}.${property}`,
        });
      }

      if (property === "$expr") {
        return (expr: string) =>
          referenceTemplate({
            ...reference,
            expr,
          });
      }

      if (reference.ref && property == "$value") {
        return referenceTemplate({
          ...reference,
          ref: `${reference.ref}.@value`,
        });
      }

      if (reference.ref && property == "$key") {
        return referenceTemplate({
          ...reference,
          ref: `${reference.ref}.@key`,
        });
      }

      if (property in hints) {
        return referenceTemplate({
          ...reference,
          hint: `${reference.hint ?? ""}${hints[property]}`,
        });
      }

      if (property === "$hint") {
        return (hint: string) =>
          referenceTemplate({
            ...reference,
            hint: `${reference.hint ?? ""}${hint}`,
          });
      }

      if (property in types) {
        return referenceTemplate({
          ...reference,
          ...types[property],
        });
      }

      if (property in target) {
        return target[property];
      }

      throw new Error(`unknown reference modifier: ${String(property)}`);
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

const references = new WeakSet<Schema<any>>();

export function defineReference<T = unknown>(
  referenceInfo: ReferenceInfo<T>,
): Schema<T> {
  const { refs, hint, expr, schema, encoding, anull } = referenceInfo;

  const reference = defineSchema<T>({
    merge(context) {
      const info = extractReference(context);
      const verifying =
        context.mode === "match" && context.phase === "validate";

      if (verifying && !info && isRequired({ hint })) {
        diagnostic(context, `missing value for ${[...refs].join("/")}`);
        return undefined;
      }

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

        if (
          isRequired(info) &&
          context.mode === "match" &&
          context.phase === "validate"
        ) {
          if (
            !expr &&
            ![...refs].some((ref) => {
              const declaration = context.evaluationScope.lookup(ref);
              return (
                (isLookupExpr(declaration) && declaration.expression) ||
                isLookupValue(declaration)
              );
            })
          ) {
            diagnostic(context, `undefined required reference: ${[...refs]}`);
            return undefined;
          }
        }

        return defineReference({
          refs: new Set([...refs, info.ref].filter(Boolean)),
          hint: mergedHint,
          schema: merged,
          encoding: info.encoding ?? encoding,
          anull: info.anull || anull,
          expr: info.expr ?? expr,
        });
      }

      if (context.mode === "match") {
        if (context.template !== undefined) {
          commitResolution({ resolved: context.template as T }, context);
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

      if (encoding && context.mode === "match") {
        nextSchema = merge(schema ?? stubSchema(), {
          ...context,
          template: datumTemplate(context.template as T & Scalar, {
            type: encoding,
          }) as Schematic<T>,
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
        template: context.template ?? resolved,
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
        nextSchema && defineReference({ ...referenceInfo, schema: nextSchema })
      );
    },
    async render(context) {
      if (schema) {
        const value = await renderReference(schema, context);

        // if the schema was a stub, we'll try to derive the value
        // by evaluating the refs.
        if (value !== undefined) {
          return convertScalar(value, encoding, { anull }) as T;
        }
      }

      for (const ref of refs) {
        if (context.cycles.has(`ref:::${ref}`)) {
          continue;
        }

        const value = (
          context.mode === "render"
            ? await evaluateIdentifierWithExpression(
                {
                  ...context,
                  cycles: new Set(context.cycles).add(`ref:::${ref}`),
                },
                ref,
              )
            : undefined
        ) as T | undefined;

        if (value !== undefined) {
          return defineRenderedReferenceValue(
            context,
            convertScalar(value, encoding, { anull }) as T,
          );
        }
      }

      if (expr) {
        const value = (await evaluateIdentifierWithExpression(
          context,
          "",
          expr,
        )) as T;

        if (value !== undefined) {
          return defineRenderedReferenceValue(
            context,
            convertScalar(value, encoding, { anull }) as T,
          );
        }
      }

      if (anull) {
        return null as T;
      }

      if (isOptional({ hint })) {
        return undefined;
      }

      if (context.mode === "render" && isStubSchema(schema)) {
        throw diagnostic(
          context,
          `undefined reference: ${[...refs].join("=")}`,
        );
      }
    },
    scope(context) {
      for (const ref of refs) {
        declareRef(context, { ref, hint, expr });

        if (!isMergingContext(context) && isAbstractContext(context)) {
          context.evaluationScope.resolve(context, ref);
        }
      }

      if (schema) {
        executeOp(schema as Schema<unknown>, "scope", context);
      }
    },
  });

  references.add(reference);

  return reference;

  function declareRef(
    context: SchemaContext,
    { ref, hint, expr }: { ref: string; hint?: string; expr?: string },
  ) {
    const { evaluationScope: scope } = context;

    scope.declare(ref, {
      context,
      expression: expr ?? null,
      hint: hint || null,
      source: null,
      resolved(context) {
        return resolveReference(rescope(context, scope) as SchemaContext<T>);
      },
      rendered(context) {
        return renderReference(schema, rescope(context, scope));
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

    // resolve before trying to render
    result = resolveReference(context, schema);

    if (schema && result === undefined) {
      result = await executeOp(schema, "render", context);
    }

    if (result === undefined) {
      // sometimes resolving afterwards works
      // TODO: determine if race conditions apply here
      result = resolveReference(context, schema);
    }

    if (result === undefined) {
      for (const ref of refs) {
        const key = `ref:::${ref}`;
        if (context.cycles.has(key)) {
          continue;
        }

        const declaration = context.evaluationScope.lookupDeclaration(ref);

        if (!declaration) {
          continue;
        }

        if (context.mode !== "render" && declaration.expression) {
          return `{{ ${hint}${ref} = ${declaration.expression} }}`;
        }

        const rendered = await declaration.rendered?.({
          ...context,
          cycles: new Set(context.cycles).add(key),
        });

        if (rendered !== undefined) {
          result = rendered as T;
          break;
        }
      }
    }

    const defined = defineRenderedReferenceValue(context, result as T);

    if (context.mode === "prerender" && isExport(referenceInfo)) {
      return undefined;
    }

    if (
      isSecret(referenceInfo) &&
      typeof defined === "string" &&
      context.mode === "postrender" &&
      "{{redacted}}" === defined
    ) {
      // the value came back as "{{redacted}}" but we have a better name to give it.
      return `{{ @${[...refs].filter(Boolean)[0] ?? ""} }}`;
    }

    if (isSecret(referenceInfo)) {
      const redacted = await context.environment.redact({
        value: defined,
        context,
        patterns: [patternize(`{{ @${[...refs].filter(Boolean)[0] ?? ""} }}`)],
      });

      return redacted;
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
      context.evaluationScope.define(context, ref, result);
    }

    return result;
  }
}
