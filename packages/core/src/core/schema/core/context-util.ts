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
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  SchemaScope,
} from "./types.js";

export type DereferenceType<
  M,
  Parameters extends (string | number)[],
> = Parameters extends [
  infer H extends string | number,
  ...infer Rest extends (string | number)[],
]
  ? H extends keyof M
    ? DereferenceType<M[H], Rest>
    : H extends number
      ? M extends (infer O)[]
        ? O
        : never
      : never
  : M;

export type KeyedContext<
  C extends SchemaContext,
  Parameters extends (string | number)[],
> = C extends SchemaRenderContext
  ? SchemaRenderContext
  : C extends SchemaMergingContext<infer M>
    ? SchemaMergingContext<DereferenceType<M, Parameters>>
    : C;

export function diagnostic(
  context: SchemaContext<unknown>,
  error: string | Error,
): string | Error {
  const location = loc(context);

  if (typeof error === "string") {
    if (!DEBUG) {
      error = `${location}: ${error}`;
    } else {
      const warning = `${location}: ${error}`;
      error = new Error(`${location}: ${error}`);
      const [message /* ignore 1 frame */, , ...stack] = error.stack?.split(
        "\n",
      ) || [warning];
      error.stack = [message, ...stack].join("\n");
    }
  }

  context.diagnostics.push({
    loc: location,
    err: error,
  });

  return error;
}

export function loc({ environment, scopes, keys }: SchemaContext) {
  const name = environment?.name?.();
  return `${name ? `${name}: ` : ""}${scopes.map((s) => `:${s}`).join("")}|${keys
    .map((k) => `.${k}`)
    .join("")}`;
}

export function isAbstractContext(context: SchemaContext<unknown>) {
  return context.scope.path.some(
    (part) => part.endsWith("[]") || part.endsWith("{}"),
  );
}

export function keyContext<
  C extends SchemaContext | SchemaMergingContext<unknown>,
  Parameters extends (string | number)[],
  O = KeyedContext<C, Parameters>,
>(context: C, ...keys: Parameters): O {
  const template = keys.reduce(
    (template, key) => template?.[key],
    (context as SchemaMergingContext<unknown>).template,
  );

  return {
    ...context,
    template,
    keys: [...context.keys, ...keys],
  } as O;
}

export function elementScopeContext<
  C extends SchemaContext,
  Key extends number,
  O = KeyedContext<C, [Key]>,
>(context: C, key: Key): O {
  context = keyContext(context, key === -1 ? "[]" : key) as C;

  const subscope = context.scope.subscope(context.keys.join("."), {
    context,
    type: "element",
    key: key === -1 ? undefined : key,
    struts: [],
  });

  return { ...context, scope: subscope, scopes: subscope.path, keys: [] } as O;
}

export function fieldScopeContext<
  C extends SchemaContext,
  Key extends string | undefined,
  O = KeyedContext<C, [Key extends undefined ? string : Key]>,
>(context: C, key: Key): O {
  context = keyContext(context, key ?? "{}") as C;

  const subscope = context.scope.subscope(context.keys.join("."), {
    context,
    type: "field",
    key,
    struts: [],
  });

  return { ...context, scope: subscope, scopes: subscope.path, keys: [] } as O;
}

export function tempContext<C extends SchemaContext>(context: C): C {
  const { scope } = context as SchemaContext;

  return { ...context, scope: scope?.tempscope() };
}

export function rescope<T extends SchemaContext>(
  context: T,
  scope: SchemaScope,
): T {
  return {
    ...context,
    scope: scope.rescope(context.scope),
    scopes: [...scope.scopePath()],
  };
}

export function metaScopeContext<C extends SchemaContext>(
  context: C,
  meta: string,
): C {
  const subscope = context.scope.subscope([...context.keys, meta].join("."));

  return { ...context, scope: subscope, scopes: subscope.path, keys: [] } as C;
}
