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

import { DEBUG } from "./debugging.js";
import {
  Schema,
  SchemaContext,
  SchemaMergingContext,
  SchemaOps,
  Schematic,
  SchematicOps,
} from "./types.js";

/**
 * Execute core schema operations.
 */
export function executeOp<
  T,
  Operation extends Exclude<keyof SchemaOps<T>, "merge" | "resolve">,
>(
  schema: Schema<T>,
  op: Operation,
  ...args: Parameters<SchemaOperation<T, Operation>>
) {
  const schemaOps = exposeSchema(schema);

  if (typeof schemaOps[op] !== "function") {
    throw new Error(
      `schema does not have ${op}(). (${Object.keys(schemaOps).join("/")})`,
      { cause: schemaOps[createdAt] },
    );
  }

  return (schemaOps[op] as SchemaOperation<T, Operation>)(
    ...(args as any),
  ) as ReturnType<SchemaOperation<T, Operation>>;
}

export function maybeResolve<T>(
  schema: Schema<T>,
  context: SchemaContext<T>,
): T | undefined {
  const { resolve } = exposeSchema<SchemaOps<T>>(schema);
  return (
    resolve?.(context) ??
    (context.mode === "match" ? (context.template as T) : undefined)
  );
}

// ---- internal utility types ----

/** DEBUG only */
const createdAt = Symbol("created-at");

type SchemaOperation<
  T,
  Operation extends keyof SchemaOps<T>,
> = SchemaOps<T>[Operation] extends (...args: any) => any
  ? SchemaOps<T>[Operation]
  : never;

/**
 * Define a schema from its operations object.
 *
 * Note: the operations methods often have access to closure-data.
 */
export function defineSchema<T>(ops: SchemaOps<T>): Schema<T> {
  if (DEBUG) {
    Object.defineProperty(ops, createdAt, {
      value: new Error("created-at"),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  return () => ops;
}

export function defineSchematic<Ops extends SchematicOps<any>>(
  ops: Ops,
): Schematic<Ops extends SchematicOps<infer T> ? T : never> {
  if (DEBUG) {
    Object.defineProperty(ops, createdAt, {
      value: new Error("created-at"),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  return () => ops;
}

/**
 * Unwraps a schema to access its operations (inverse of define).
 */
function exposeSchema<O extends SchemaOps<unknown>>(
  schema: Schema<O extends SchemaOps<infer T> ? T : never>,
): Partial<O> {
  return schema() as Partial<O>;
}

/**
 * Matching and rendering.
 *
 * Matching and rendering read and write values to the current scope.
 *
 * Scopes are nested collections of values, and some schemas create
 * these nested subscopes.
 *
 * For example, a schema produced from
 * ```js
 * templateInContext([{ "a": scalars.number("{{a}}"), "a-plus-one": "{{= a + 1}}" }])
 * ```
 * can match a value like [{ "a": 1 }, { "a": 10 }],
 * and render [{ a: 1, "a-plus-one": 2 }, { a: 10, "a-plus-one": 11 }].
 *
 * This works because the schema is applied to two scopes, "0" and "1",
 * with different values registered for "a" in each.
 */

/**
 * Unwraps a schematic.  Returns a partial to encourage runtime checks to confirm
 * the type of schematc.
 */
export function exposeSchematic<O extends SchematicOps<unknown>>(
  template: Schematic<O extends SchematicOps<infer T> ? T : never>,
): Partial<O> {
  return template() as Partial<O>;
}

export function merge<T>(
  schema: Schema<T>,
  context: SchemaMergingContext<T>,
): Schema<T> | undefined {
  const scheme = exposeSchema(schema);

  if (isSchematic(context.template)) {
    const ops = exposeSchematic<SchematicOps<T>>(context.template);

    if (ops.blend) {
      return ops.blend(context, (context) => merge(schema, context)) as
        | Schema<T>
        | undefined;
    }
  }

  return scheme.merge!(context) as Schema<T> | undefined;
}

export function isSchema<T = unknown>(thing: unknown): thing is Schema<T> {
  if (typeof thing !== "function") {
    return false;
  }

  const ops = exposeSchema(thing as any);

  return Boolean(ops.scope);
}

export function isSchematic<T = unknown>(
  thing: unknown,
): thing is Schematic<T> {
  if (typeof thing !== "function") {
    return false;
  }

  const ops = exposeSchematic(thing as any);

  return Boolean(ops.expand);
}
