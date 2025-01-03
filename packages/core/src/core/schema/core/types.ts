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

import { Pattern } from "./pattern.js";

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
  diagnostics: SchemaWarnings[];
};

export type SchemaWarnings = {
  loc: string;
  err: Error | string;
};

/**
 * Matching (and mixing) operates on stub (or schema) values,
 * hopefully of type T.
 */
export type SchemaMergingContext<T> = SchemaContextBase & {
  mode: "match" | "mix" | "mux" | "meld";
  phase: "validate" | "build";
  scope: SchemaScope;
  environment: SchemaScriptEnvironment;
  template?: Template<T>;
  expand<T>(template?: Template<T>): Schema<T>;
};

/** Given a type T, produce a type where T or any recursive field of T is alternated with T | Schematic\<T> */
export type Template<R> =
  | R
  | Schematic<R>
  | (R extends Array<infer E>
      ? Array<Template<E>> | { [K in keyof R]: Template<R[K]> }
      : R extends object
        ? {
            [K in keyof R]?: Template<R[K]>;
          }
        : never);

/**
 * A schematic is a temporary structure that influences merging operations.
 * The idea is that the schematic can expose additional internal structures
 * that allow the schema produced to merge with those internal structures directly.
 *
 * Schematics are functions to distinguish them from data.
 *
 * Applications:
 *   - changing context modes and applying default expansions.
 *   - wrapping schemas like reference schemas.
 *   - representing variants of structures and relationships not directly implied by a data template.
 */
export type SchematicOps<T> = {
  expand(context: SchemaMergingContext<T>): Schema<T>;
  blend?(
    context: SchemaMergingContext<T>,
    next: (context: SchemaMergingContext<T>) => Schema<T> | undefined,
  ): Schema<T> | undefined;
};

export type Schematic<T> = () => SchematicOps<T>;

/**
 * Schemas are "expanded" from templates.  Templates can either be `Schematic<T>` or
 * `T` values.  In any case schemas merge / integrate templates into their
 * internal representation, one layer at a time.
 *
 * All schemas are defined in terms of three simple "Schema Operations".
 *
 * The map of schematic operations also serves as a kind of runtime-type-info system,
 * as well as allowing schematics to merge their internal state.
 *
 * The type T is what the schema matches and renders.
 */
export type SchemaOps<T> = {
  /**
   * The scope operation registers any variable definitions or declarations into
   * the context.  This is executed as a pre-match and pre-render pass.
   */
  scope(context: SchemaContext<T>): void;

  /**
   * Merging checks if the `stub` value in the context is compatible with the
   * current schema, and either
   *
   *  - returns undefined if the value is incompatible, or
   *  - returns an unmodified copy of the same schematic, often if the value is missing
   *  - returns a modified copy of the current schematic, incorporating the value.
   *  - throws an execption if the value conflicts in some ugly way
   *
   * The context can also be updated with definitions gleaned from the merge.
   *
   * Merging is a core mechanism for building and extending schemas.
   */
  merge(context: SchemaMergingContext<T>): Schema<T> | undefined;

  /**
   * Rendering evaluates a result of this schema from the current context.
   */
  render(context: SchemaRenderContext): T | Promise<T | undefined>;

  /**
   * Resolves the current value.  Only some structures need to support this.
   * @param context the current merging context
   */
  resolve?(context: SchemaContext<T>): T | undefined;
};

/**
 * To definitely avoid confusing schemas with values, all values are "not functions", and
 * schemas are functions that return their operations map.
 *
 * However, schemas *should* never be mixed with values, perhaps we can change this.
 */
export type Schema<T> = () => SchemaOps<T>;

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
export type SchemaContext<T = unknown> =
  | SchemaMergingContext<T>
  | SchemaRenderContext;

export type ScopeData = {
  readonly values: Record<string, ValueDefinition>;
  readonly subscopes: Record<string, ScopeData>;
};

export type ScopeIndex =
  | {
      context: SchemaContext;
      struts: Identifier[];
      type: "field";
      key?: string;
    }
  | {
      context: SchemaContext;
      struts: Identifier[];
      type: "element";
      key?: number;
    };

export type ResolvedValueOptions = { secrets?: boolean };

export type SchemaScope = {
  subscope(name: string, index?: ScopeIndex): SchemaScope;

  tempscope(): SchemaScope;

  declare(
    identifier: string,
    declaration: Omit<ExpressionDeclaration, "identifier" | "path" | "name">,
  ): void;

  imported(indentifer: string, context: SchemaRenderContext): void;

  define<T>(context: SchemaContext<T>, key: string, value: T): T | undefined;

  cached<T>(
    context: SchemaRenderContext,
    action: () => Promise<T> | T,
    ...keys: string[]
  ): Promise<T> | Exclude<T, undefined>;

  rendering<T>(
    context: SchemaRenderContext,
    name: string,
    action: () => Promise<T>,
  ): Promise<T>;

  resolving<T>(
    context: SchemaContext,
    name: string,
    action: () => T,
  ): T | undefined;

  evaluating(name: string): boolean;

  lookup(name: string): ValueDeclaration | ExpressionDeclaration | undefined;

  lookupDeclaration(name: string): ExpressionDeclaration | undefined;

  resolve(
    context: SchemaContext,
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

export interface SchemaScriptEnvironment {
  name?(): string | undefined;

  evaluating<T>(info: {
    evaluation: () => Promise<T>;
    identifier: Identifier | null;
    hint: string | null;
    source: string | null;
    context: SchemaRenderContext;
  }): Promise<T | string>;

  redact<T>(info: {
    value: T;
    context: SchemaRenderContext;
    patterns: Pattern[] | null;
  }): T | string | undefined;

  match(
    template: Pattern,
    patterns: Pattern[],
  ): { patterns: Pattern[]; related: string[] } | undefined;

  config(context: SchemaContext, pattern: Pattern[]): Pattern[];

  init(info: { context: SchemaContext }): SchemaScriptEnvironment;

  exhausted(): boolean;

  implied(
    override?: Record<string, unknown>,
    context?: SchemaMergingContext<unknown>,
  ): Record<string, string>;

  resolve(info: {
    context: SchemaContext<unknown>;
    identifier: Identifier;
  }): unknown;

  evaluate(info: {
    context: SchemaRenderContext;
    identifier: Identifier;
  }): unknown | undefined | Promise<unknown | undefined>;

  reset(): void;

  option(key: string): unknown;
}

export type Identifier = {
  loc?: string; // context location info
  name: string;
  root: string;
  path: string[];
};

export type ScopeValueReference = {
  identifier: string;
  name: string;
  path: Identifier["path"];
  context: SchemaContext<unknown>;
  value?: unknown;
};

export type ValueDeclaration = ScopeValueReference;

export type ValueDefinition = ScopeValueReference & {
  expression?: ExpressionDeclaration;
};

export type ExpressionDeclaration = ScopeValueReference & {
  expression: string | null;
  hint: string | null;
  source: string | null;
  context: SchemaContext<unknown>;
  resolved?(context: SchemaContext<unknown>): unknown;
  rendered?(context: SchemaRenderContext): Promise<unknown>;
};
