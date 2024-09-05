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
import {
  SchemaCaptureContext,
  SchemaMergingContext,
  SchemaRenderContext,
  SchemaScriptEnvironment,
  ValueIdentifier,
  globalIdentifier,
  isGlobalIdentifier,
} from "./schema.js";
import { isScalar } from "../definition/scalars.js";
import { indexChain } from "./scope.js";

export type ScriptDataResolver = (
  name: string,
  context: SchemaCaptureContext,
) => unknown | undefined;

export type ScriptDataEvaluator = (
  ident: string,
  context: SchemaRenderContext,
) => unknown | undefined | Promise<unknown | undefined>;

export type ScriptResolver = (
  name: ValueIdentifier,
  context: SchemaCaptureContext,
) => unknown | undefined;

export type ScriptEvaluator = (
  ident: ValueIdentifier,
  context: SchemaRenderContext,
) => unknown | undefined | Promise<unknown | undefined>;

export type RenderRedactor = <T>(
  value: T,
  patterns: Pattern[] | null,
) => T | string | undefined;

export type ScriptExpressionRenderer = <T>(info: {
  evaluation: () => Promise<T>;
  ident: ValueIdentifier | null;
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

    this.resolver = (ident, context) => {
      return resolveAccess(
        this.input[ident.root] ??
          runtime?.[ident.root] ??
          resolve?.(ident.root, context),
        ident,
        context,
      );
    };
    this.resolvedDefaults = resolvedDefaults;

    this.evaluator = (ident, context) =>
      resolveAccess(evaluate?.(ident.root, context), ident, context);
    this.redactor = redact;
    this.expression = express;
    this.options = options;
  }

  resolve({
    ident,
    context,
  }: {
    ident: ValueIdentifier;
    context: SchemaCaptureContext<unknown>;
  }): unknown {
    return this.resolver?.(ident, context);
  }

  evaluate({
    ident,
    context,
  }: {
    ident: ValueIdentifier;
    context: SchemaRenderContext;
  }): unknown | undefined | Promise<unknown | undefined> {
    return this.resolver?.(ident, context) ?? this.evaluator?.(ident, context);
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
    const { stub } = context;

    // bail if the stub value is not a scalar.
    if (!isScalar(stub)) {
      return patterns;
    }

    // configuration only applies to the root scope, so if we're
    // not in the root scope, just mix in the stub value
    // and bail.
    if (context.scopes.length) {
      if (stub !== undefined) {
        const stubPattern =
          context.mode === "match"
            ? patternLiteral(String(stub))
            : patternize(String(stub));
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
      context: { ...context, stub: String(stub) },
      patternize,
      resolve,
    });
  }

  reconfigurePatterns(context: SchemaCaptureContext, patterns: Pattern[]) {
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

  init({ context }: { context: SchemaCaptureContext }) {
    const contextualConfiguraiton = arrayIntoObject(
      [...this.space.keys()],
      (key) => {
        const value = this.resolve({
          ident: globalIdentifier(key),
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
    ident,
    context,
  }: {
    value: unknown;
    ident: ValueIdentifier;
    context: SchemaCaptureContext<unknown>;
  }): unknown {
    if (isGlobalIdentifier(ident) && !context.scope.parent) {
      return this.space.update(ident.path[0], value);
    }

    return value;
  }

  evaluating<T>({
    evaluation,
    ident,
    source,
    context,
  }: {
    evaluation: () => Promise<T>;
    ident: ValueIdentifier | null;
    source: string | null;
    context: SchemaRenderContext;
  }): Promise<T | string> {
    return this.expression
      ? (this.expression({
          evaluation,
          ident,
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
  ident: ValueIdentifier,
  context: SchemaCaptureContext,
) {
  if (ident.path.length == 0) {
    return value;
  }

  const indices = indexChain(context.scope);
  if (ident.name.endsWith(".@key")) {
    return indices[0]?.key;
  }

  const resolved = ident.path.reduce<unknown>(
    (value, step, idx) => {
      value = value?.[step];
      const index = indices[indices.length - idx - 1];
      if (!index) {
        return undefined;
      } else if (index.key === undefined) {
        index.struts.push({
          root: ident.root,
          path: ident.path.slice(0, idx),
          name: ident.path[idx],
        });
      } else {
        value = value?.[String(index.key)];
      }

      return value;
    },
    { [ident.path[0]]: value },
  );

  if (ident.name.endsWith(".@value")) {
    return resolved;
  }

  return resolved?.[ident.name];
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
