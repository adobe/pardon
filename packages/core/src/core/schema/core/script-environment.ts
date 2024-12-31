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
import {
  Pattern,
  PatternRegex,
  arePatternsCompatible,
  patternLiteral,
  patternize,
} from "./pattern.js";
import { arrayIntoObject, mapObject } from "../../../util/mapping.js";
import { ConfigMapping, ConfigSpace } from "./config-space.js";
import { makeGlobalIdentifier, isGlobalIdentifier } from "./schema.js";
import { indexChain } from "./scope.js";
import {
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  SchemaScriptEnvironment,
  ValueIdentifier,
} from "./types.js";
import { loc } from "./context-util.js";
import { isScalar } from "../definition/scalar.js";

export type ScriptDataResolver = (
  name: string,
  context: SchemaContext,
) => unknown | undefined;

export type ScriptDataEvaluator = (
  name: string,
  context: SchemaRenderContext,
) => unknown | undefined | Promise<unknown | undefined>;

export type ScriptResolver = (
  name: ValueIdentifier,
  context: SchemaContext,
) => unknown | undefined;

export type ScriptEvaluator = (
  identifier: ValueIdentifier,
  context: SchemaRenderContext,
) => unknown | undefined | Promise<unknown | undefined>;

export type RenderRedactor = <T>(
  value: T,
  patterns: Pattern[] | null,
) => T | string | undefined;

export type ScriptExpressionRenderer = <T>(info: {
  evaluation: () => Promise<T>;
  identifier: ValueIdentifier | null;
  source: string | null;
  context: SchemaRenderContext;
}) => Promise<T | string>;

export type ScriptDefaultsResolver = (
  context: SchemaMergingContext<unknown>,
) => Record<string, string>;

export type ScriptOptions = (key: string) => unknown;

export class ScriptEnvironment implements SchemaScriptEnvironment {
  name: () => string | undefined;
  input: Record<string, unknown>;
  space: ConfigSpace;
  resolver?: ScriptResolver;
  evaluator?: ScriptEvaluator;
  redactor?: RenderRedactor;
  resolvedDefaults?: ScriptDefaultsResolver;
  expression?: ScriptExpressionRenderer;
  options?: ScriptOptions;

  constructor({
    name,
    config,
    input,
    runtime,
    resolve,
    evaluate,
    redact,
    express,
    options,
    resolvedDefaults,
  }: {
    name?: string;
    config?: Record<string, ConfigMapping>;
    input?: Record<string, unknown>;
    runtime?: Record<string, unknown>;
    resolve?: ScriptDataResolver;
    resolvedDefaults?: ScriptDefaultsResolver;
    evaluate?: ScriptDataEvaluator;
    redact?: RenderRedactor;
    express?: ScriptExpressionRenderer;
    options?: ScriptOptions;
  } = {}) {
    this.name = () => name;
    this.input = input ?? {};
    this.space = new ConfigSpace(config ?? {});
    this.space.choose(input ?? {});

    this.resolver = (identifier, context) => {
      return resolveAccess(
        this.input[identifier.root] ??
          runtime?.[identifier.root] ??
          resolve?.(identifier.root, context),
        identifier,
        context,
      );
    };
    this.resolvedDefaults = resolvedDefaults;

    this.evaluator = (identifier, context) =>
      resolveAccess(evaluate?.(identifier.root, context), identifier, context);
    this.redactor = redact;
    this.expression = express;
    this.options = options;
  }

  resolve({
    identifier,
    context,
  }: {
    identifier: ValueIdentifier;
    context: SchemaContext<unknown>;
  }): unknown {
    return this.resolver?.(identifier, context);
  }

  evaluate({
    identifier,
    context,
  }: {
    identifier: ValueIdentifier;
    context: SchemaRenderContext;
  }): unknown | undefined | Promise<unknown | undefined> {
    return (
      this.resolver?.(identifier, context) ??
      this.evaluator?.(identifier, context)
    );
  }

  match({
    context,
    patterns,
    patternize,
    resolve,
  }: {
    patterns: Pattern[];
    context: SchemaMergingContext<unknown>;
    patternize(s: string): PatternRegex;
    resolve(p: Pattern): string | undefined;
  }): Pattern[] | undefined {
    const { template } = context;

    // bail if the stub value is not a scalar.
    if (!isScalar(template)) {
      return patterns;
    }

    // configuration only applies to the root scope, so if we're
    // not in the root scope, just mix in the stub value
    // and bail.
    if (context.scopes.length) {
      if (template !== undefined) {
        const stubPattern =
          context.mode === "match"
            ? patternLiteral(String(template))
            : patternize(String(template));
        if (
          patterns.some(
            (pattern) => !arePatternsCompatible(stubPattern, pattern),
          )
        ) {
          return undefined;
        }

        return [stubPattern, ...patterns];
      }
      return patterns;
    }

    return this.space.match(patterns, {
      context: { ...context, template: String(template) },
      patternize,
      resolve,
    });
  }

  reconfigurePatterns(context: SchemaContext, patterns: Pattern[]) {
    if (context.scope?.scopePath()?.length) {
      return patterns;
    }

    return this.space.reconfigurePatterns(patterns);
  }

  choose(requirements: Record<string, string>) {
    this.space.choose(requirements);
    return this;
  }

  implied(
    override: Record<string, string> = {},
    context?: SchemaMergingContext<unknown>,
  ) {
    const values = mapObject(this.space.implied(override), {
      filter: (_, value) => patternize(value).vars.length === 0,
    });

    if (context) {
      const defaults = this.resolvedDefaults?.(context);
      const scalars = resolvedScalars(context);

      Object.assign(
        values,
        unconfigured(
          {
            ...defaults,
            ...scalars,
            ...override,
          },
          this.space,
        ),
      );
    }

    return values;
  }

  init({ context }: { context: SchemaContext }) {
    const contextualConfiguraiton = arrayIntoObject(
      [...this.space.keys()],
      (key) => {
        const value = this.resolve({
          identifier: makeGlobalIdentifier(key),
          context,
        });

        if (value !== undefined) {
          return { [key]: String(value) };
        }
      },
    );

    this.space.choose(contextualConfiguraiton);

    return this;
  }

  exhausted(): boolean {
    return this.space.exhausted();
  }

  reset() {
    this.space.reset();
  }

  update({
    value,
    identifier,
    context,
  }: {
    value: unknown;
    identifier: ValueIdentifier;
    context: SchemaContext<unknown>;
  }): unknown {
    if (isGlobalIdentifier(identifier) && !context.scope.parent) {
      return this.space.update(identifier.path[0], value);
    }

    return value;
  }

  evaluating<T>({
    evaluation,
    identifier,
    source,
    context,
  }: {
    evaluation: () => Promise<T>;
    identifier: ValueIdentifier | null;
    source: string | null;
    context: SchemaRenderContext;
  }): Promise<T | string> {
    return this.expression
      ? (this.expression({
          evaluation,
          identifier: identifier,
          source,
          context,
        }) as Promise<T | string>)
      : evaluation();
  }

  redact<T>({
    value,
    patterns,
  }: {
    value: T;
    patterns: Pattern[] | null;
  }): string | T | undefined {
    return this.redactor?.(value, patterns) ?? value;
  }

  option(key: string) {
    return this.options?.(key);
  }
}

export function resolveAccess(
  value: unknown,
  identifier: ValueIdentifier,
  context: SchemaContext,
) {
  if (identifier.path.length == 0) {
    return value;
  }

  const indices = indexChain(context.scope);

  if (identifier.name.endsWith(".@key")) {
    const keyIndex = indices.length - identifier.path.length;
    return indices[keyIndex]?.key;
  }

  const resolved = identifier.path.reduce<unknown>(
    (value, step, idx) => {
      value = value?.[step];
      const index = indices[indices.length - idx - 1];
      if (!index) {
        return undefined;
      } else if (index.key === undefined) {
        index.struts.push({
          loc: loc(context),
          root: identifier.root,
          path: identifier.path.slice(0, idx),
          name: identifier.path[idx],
        });
      } else {
        value = value?.[String(index.key)];
      }

      return value;
    },
    { [identifier.path[0]]: value },
  );

  if (identifier.name.endsWith(".@value")) {
    return resolved;
  }

  return resolved?.[identifier.name];
}

function resolvedScalars(context: SchemaMergingContext<unknown>) {
  return mapObject(context.scope.resolvedValues({ secrets: false }), {
    values(value) {
      switch (typeof value) {
        case "string":
        case "number":
        case "boolean":
        case "bigint":
          return String(value);
      }
    },
    filter(_key, value) {
      return value !== undefined;
    },
  }) as Record<string, string>;
}

function unconfigured(values: Record<string, string>, space: ConfigSpace) {
  const keys = space.keys();

  return mapObject(values, { filter: (key) => !keys.has(key) });
}
