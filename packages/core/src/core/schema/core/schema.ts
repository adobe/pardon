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

import { Pattern, PatternRegex } from "./pattern.js";

/**
 * All Schemas support the following "Schematic Operations", as well as any they
 * implement themselves for their own internal usage.
 *
 * The map of schematic operations also serves as a kind of runtime-type-info system,
 * as well as allowing schematics to merge their internal state.
 *
 * The type T is what the schema matches and renders.
 */
export type SchematicOps<T> = {
  /**
   * The scope operation registers any variable definitions or declarations into
   * the context.  This is executed as a pre-match and pre-render pass.
   */
  scope(context: SchemaCaptureContext<T>): void;

  /**
   * Merging checks if the `stub` value in the context is compatible with the
   * current schema, and either
   *
   *  - returns undefined if the value is incompatible, or
   *  - returns an unmodified copy of the same schematic, often if the value is missing
   *  - returns a modified copy of the current schematic, incorporating the value.
   *  - throws an execption if the value conflicts in some way
   *
   * The context can also be updated with definitions gleaned from the merge.
   *
   * Merging is a core mechanism for building and extending schemas.
   */
  merge(context: SchemaMergingContext<T>): Schema<T> | undefined;

  /**
   * Rendering evaluates a result of this schema from the current context.
   */
  render(context: SchemaRenderContext): Promise<T | undefined>;
};

/**
 * To avoid confusing schemas with values, all values are "not functions", and
 * schemas are functions that return their operations map.
 */
export type Schema<T> = () => SchematicOps<T>;

/**
 * Schema operations are applied to a context object which is
 * rebuilt/threaded through the operations.
 *
 * All context objects have a mode, and a current keys[] and scopes[] array identifying
 * the location in the object which the schema is operating on.
 */
type SchemaContextBase = {
  mode: string;
  keys: (string | number)[];
  scopes: string[];
};

export type ValueIdentifier = {
  name: string;
  root: string;
  path: string[];
};

export function globalIdentifier(key: string): ValueIdentifier {
  return {
    root: key,
    name: key,
    path: [],
  };
}

export function isGlobalIdentifier({ path }: ValueIdentifier): boolean {
  return path.length === 0;
}

export type SchemaContext = SchemaMergingContext<unknown> | SchemaRenderContext;

export interface SchemaScriptEnvironment {
  name?(): string | undefined;

  evaluating<T>(info: {
    evaluation: () => Promise<T>;
    ident: ValueIdentifier | null;
    hint: string | null;
    source: string | null;
    context: SchemaRenderContext;
  }): Promise<T | string>;

  redact<T>(info: {
    value: T;
    context: SchemaRenderContext;
    patterns: Pattern[] | null;
  }): T | string | undefined;

  match(info: {
    context: SchemaMergingContext<unknown>;
    patterns: Pattern[];
    patternize(s: string): PatternRegex;
    resolve(p: Pattern): string | undefined;
  }): Pattern[] | undefined;

  reconfigurePatterns(
    context: SchemaCaptureContext,
    pattern: Pattern[],
  ): Pattern[];

  init(info: { context: SchemaCaptureContext }): SchemaScriptEnvironment;

  exhausted(): boolean;

  update(info: {
    value: unknown;
    ident: ValueIdentifier;
    context: SchemaCaptureContext;
  }): unknown | undefined;

  implied(
    override?: Record<string, unknown>,
    context?: SchemaMergingContext<unknown>,
  ): Record<string, string>;

  resolve(info: {
    context: SchemaCaptureContext<unknown>;
    ident: ValueIdentifier;
  }): unknown;

  evaluate(info: {
    context: SchemaRenderContext;
    ident: ValueIdentifier;
  }): unknown | undefined | Promise<unknown | undefined>;

  reset(): void;

  option(key: string): unknown;
}

export type ResolvedValueOptions = { secrets?: boolean };

export type ScopeData = {
  readonly values: Record<string, ValueDefinition>;
  readonly subscopes: Record<string, ScopeData>;
};

export type ScopeIndex =
  | {
      context: SchemaCaptureContext;
      struts: ValueIdentifier[];
      type: "field";
      key?: string;
    }
  | {
      context: SchemaCaptureContext;
      struts: ValueIdentifier[];
      type: "element";
      key?: number;
    };

export type SchemaScope = {
  clone(context: SchemaCaptureContext): SchemaScope;

  subscope(name: string, index?: ScopeIndex): SchemaScope;

  tempscope(): SchemaScope;

  declare(
    identifier: string,
    declaration: Omit<ExpressionDeclaration, "identifier" | "path" | "name">,
  ): void;

  imported(indentifer: string, context: SchemaRenderContext): void;

  define<T>(
    context: SchemaCaptureContext<T>,
    key: string,
    value: T,
  ): T | undefined;

  cached<T>(
    context: SchemaRenderContext,
    action: () => Promise<T>,
    ...keys: string[]
  ): Promise<T>;

  rendering<T>(
    context: SchemaRenderContext,
    ident: string,
    action: () => Promise<T>,
  ): Promise<T>;

  resolving<T>(
    context: SchemaCaptureContext,
    ident: string,
    action: () => T,
  ): T | undefined;

  evaluating(ident: string): boolean;

  lookup(ident: string): ValueDeclaration | ExpressionDeclaration | undefined;

  lookupDeclaration(ident: string): ExpressionDeclaration | undefined;

  resolve(
    context: SchemaCaptureContext,
    identifier: string,
  ): ValueDeclaration | undefined;

  resolvedValues(options?: ResolvedValueOptions): Record<string, unknown>;

  rescope(scope: SchemaScope): SchemaScope;

  scopePath(): string[];

  readonly parent?: SchemaScope;

  readonly path: string[];

  readonly index?: ScopeIndex;

  readonly declarations: Record<string, ExpressionDeclaration>;
} & ScopeData;

export type ScopeValueReference = {
  identifier: string;
  name: string;
  path: ValueIdentifier["path"];
  context: SchemaContext;
  value?: unknown;
};

export type ExpressionDeclaration = ScopeValueReference & {
  expr: string | null;
  hint: string | null;
  source: string | null;
  context: SchemaCaptureContext<unknown>;
  resolved?(context: SchemaCaptureContext<unknown>): unknown;
  rendered?(context: SchemaRenderContext): Promise<unknown>;
};

export type ValueDeclaration = ScopeValueReference;

export type ValueDefinition = ScopeValueReference & {
  expr?: ExpressionDeclaration;
};

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
 * Matching (and mixing) operates on stub (or schema) values,
 * hopefully of type T.
 */
export type SchemaMergingContext<T> = SchemaContextBase & {
  mode: "match" | "mix" | "mux";
  phase: "validate" | "build";
  scope: SchemaScope;
  environment: SchemaScriptEnvironment;
  stub?: T;
  diagnostics: SchemaWarnings[];
};

export type SchemaWarnings = {
  loc: string;
  err: Error;
};

/**
 * Render contexts have the async evaluator.
 */
export type SchemaRenderContext = SchemaContextBase & {
  mode: "render" | "prerender" | "postrender" | "preview";
  scope: SchemaScope;
  environment: SchemaScriptEnvironment;
};

/**
 * Match and render contexts can capture and resolve values.
 *
 * This context has a resolver and scope, used by the pre-match
 * and pre-render scope() pass.
 */
export type SchemaCaptureContext<T = unknown> =
  | SchemaMergingContext<T>
  | SchemaRenderContext;

/**
 * Unwrap the schema type from a schema operations type
 */
type OpsValueType<Ops> = Ops extends SchematicOps<infer T> ? T : never;

/**
 * Define a schema from its operations object.
 *
 * Note: the operations methods often have access to closure-data.
 */
export function defineSchema<Ops extends SchematicOps<unknown>>(
  ops: Ops,
): Schema<OpsValueType<Ops>> {
  return () => ops as Ops & SchematicOps<OpsValueType<Ops>>;
}

/**
 * Unwraps a schema to access its operations (inverse of define),
 * with type hinting.
 *
 * This is commonly used internally by schemas when they merge.
 */
export function extractOps<O extends SchematicOps<unknown>>(
  schema: Schema<OpsValueType<O>>,
): Partial<O> {
  return schema() as Partial<O>;
}

/**
 * Execute core schema operations.
 */
export function executeOp<T, Operation extends keyof SchematicOps<T>>(
  schema: Schema<T>,
  op: Operation,
  ...args: Parameters<SchemeOperation<T, Operation>>
) {
  return (extractOps(schema)[op] as SchemeOperation<T, Operation>)(
    ...(args as any),
  ) as ReturnType<SchemeOperation<T, Operation>>;
}

// ---- internal utility types ----
type SchemeOperation<
  T,
  Operation extends keyof SchematicOps<T>,
> = SchematicOps<T>[Operation] extends (...args: any) => any
  ? SchematicOps<T>[Operation]
  : never;

/** Given a type with Schema\<T> nested in it, try to unwrap all Schema\<T>s into T */
export type Render<R> =
  R extends Schema<infer V>
    ? Render<V>
    : R extends Array<infer I>
      ? Render<I>[]
      : R extends object
        ? {
            [K in keyof R]: Render<R[K]>;
          }
        : R;

/** Given a type T, produce a type where T or any recursive field of T is alternated with T | Schema\<T> */
export type Template<R> =
  R extends Schema<infer V>
    ? Template<Render<V>>
    : R extends object
      ?
          | {
              [K in keyof R]: Template<R[K]>;
            }
          | Schema<{
              [K in keyof R]: Template<R[K]>;
            }>
      : R extends (...args: any) => any
        ? any
        : R | Schema<R>;

export function isMatchingContext(
  context: SchemaContext,
): context is SchemaMergingContext<unknown> {
  switch (context.mode) {
    case "match":
    case "mix":
    case "mux":
      return true;
  }
  return false;
}
