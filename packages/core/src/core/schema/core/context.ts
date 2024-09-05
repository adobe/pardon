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
import { applyModeTrampoline } from "../template.js";
import { loc } from "./schema-utils.js";
import {
  Schema,
  executeOp,
  SchemaRenderContext,
  SchemaMergingContext,
  SchemaContext,
  SchemaCaptureContext,
  SchemaScriptEnvironment,
  SchemaScope,
  ResolvedValueOptions,
} from "./schema.js";
import { Scope } from "./scope.js";
import { ScriptEnvironment } from "./script-environment.js";

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

export function keyContext<
  C extends SchemaContext | SchemaMergingContext<unknown>,
  Parameters extends (string | number)[],
  O = KeyedContext<C, Parameters>,
>(context: C, ...keys: Parameters): O {
  const stub = keys.reduce(
    (template, key) => template?.[key],
    (context as SchemaMergingContext<unknown>).stub,
  );

  return applyModeTrampoline({
    ...context,
    stub,
    keys: [...context.keys, ...keys],
  } as SchemaMergingContext<unknown>) as O;
}

export function metaScopeContext<C extends SchemaContext>(
  context: C,
  meta: string,
): C {
  const subscope = context.scope.subscope([...context.keys, meta].join("."));

  return { ...context, scope: subscope, scopes: subscope.path, keys: [] } as C;
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
  const { scope } = context as SchemaCaptureContext;

  return { ...context, scope: scope?.tempscope() };
}

export function createRenderContext<T>(
  schema: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
  scope?: SchemaScope,
): SchemaRenderContext {
  const ctx = {
    mode: "render",
    keys: [],
    scopes: [],
    environment,
    scope: scope ?? Scope.createRootScope(),
  } satisfies SchemaRenderContext;

  if (scope) {
    ctx.scope = scope.clone(ctx);
  }
  executeOp(schema, "scope", ctx);

  return ctx;
}

export function createPreviewContext<T>(
  scheme: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
  scope?: SchemaScope,
): SchemaRenderContext {
  const ctx = {
    mode: "preview",
    keys: [],
    scopes: [],
    environment,
    scope: scope ?? Scope.createRootScope(),
  } satisfies SchemaRenderContext;

  if (!scope) {
    executeOp(scheme, "scope", ctx);
  } else {
    ctx.scope = scope.clone(ctx);
  }

  return ctx;
}

export function createPrerenderContext<T>(
  scheme: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
  scope?: SchemaScope,
): SchemaRenderContext {
  const ctx = {
    mode: "prerender",
    keys: [],
    scopes: [],
    environment,
    scope: scope ?? Scope.createRootScope(),
  } satisfies SchemaRenderContext;

  if (!scope) {
    executeOp(scheme, "scope", ctx);
  } else {
    ctx.scope = scope.clone(ctx);
  }

  return ctx;
}

export function createPostrenderContext<T>(
  scheme: Schema<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
  scope?: SchemaScope,
): SchemaRenderContext {
  const ctx = {
    mode: "postrender",
    keys: [],
    scopes: [],
    environment,
    scope: scope ?? Scope.createRootScope(),
  } satisfies SchemaRenderContext;

  if (!scope) {
    executeOp(scheme, "scope", ctx);
  } else {
    ctx.scope = scope.clone(ctx);
  }

  return ctx;
}

export type DeepPartial<T> =
  | (T extends object
      ? {
          [P in keyof T]?: DeepPartial<T[P]>;
        }
      : never)
  | T;

export type SchemaMergeType = {
  mode: SchemaMergingContext<unknown>["mode"];
  phase: SchemaMergingContext<unknown>["phase"];
};

export function createMergingContext<T>(
  { mode, phase }: SchemaMergeType,
  schema: Schema<T>,
  stub: T | DeepPartial<T>,
  environment: SchemaScriptEnvironment = new ScriptEnvironment(),
): SchemaMergingContext<T> {
  const context = {
    mode,
    phase,
    keys: [],
    scopes: [],
    environment,
    scope: Scope.createRootScope(),
    stub: stub as T,
    diagnostics: [],
  } satisfies SchemaMergingContext<T>;

  context.environment.reset();
  executeOp(schema, "scope", context);

  return applyModeTrampoline(context);
}

export function getContextualValues(
  context: SchemaCaptureContext<unknown>,
  options: ResolvedValueOptions = {},
) {
  return {
    ...context.environment.implied(),
    ...context.scope.resolvedValues(options),
  };
}

export function diagnostic(
  context: SchemaMergingContext<unknown>,
  error: string | Error,
) {
  const location = loc(context);

  if (typeof error === "string") {
    const warning = `${location}: ${error}`;
    error = new Error(`${location}: ${error}`);
    const [message /* ignore 1 frame */, , ...stack] = error.stack?.split(
      "\n",
    ) || [warning];
    error.stack = [message, ...stack].join("\n");
  }

  context.diagnostics.push({
    loc: location,
    err: error,
  });
}
