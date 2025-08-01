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
import { Pattern, patternize } from "./pattern.js";
import { arrayIntoObject, mapObject } from "../../../util/mapping.js";
import { DefaultsMap, ConfigSpace } from "./config-space.js";
import { makeGlobalIdentifier } from "./identifier.js";
import { indexChain } from "./scope.js";
import {
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  SchemaScriptEnvironment,
  Identifier,
} from "./types.js";
import { loc } from "./context-util.js";
import { PardonAppContext } from "../../pardon/pardon.js";

export type ScriptDataResolver = (
  context: SchemaContext,
  options: { name: string; scoped?: boolean },
) => unknown | undefined;

export type ScriptDataEvaluator = (
  name: string,
  context: SchemaRenderContext,
) => unknown | undefined | Promise<unknown | undefined>;

export type ScriptResolver = (
  context: SchemaContext,
  info: { identifier: Identifier; scoped?: boolean },
) => unknown | undefined;

export type ScriptEvaluator = (
  identifier: Identifier,
  context: SchemaRenderContext,
) => unknown | undefined | Promise<unknown | undefined>;

export type RenderRedactor = <T>(
  value: T,
  patterns: Pattern[] | null,
) => Promise<T | string | undefined> | T | string | undefined;

export type ScriptExpressionRenderer = <T>(info: {
  evaluation: () => Promise<T>;
  identifier: Identifier | null;
  source: string | null;
  context: SchemaRenderContext;
}) => Promise<T | string>;

export type ScriptDefaultsResolver = (
  context: SchemaMergingContext<unknown>,
) => Record<string, string>;

export type ScriptOptions = (key: string) => unknown;

export class ScriptEnvironment implements SchemaScriptEnvironment {
  app: Pick<PardonAppContext, "database" | "secrets">;
  name: () => string | undefined;
  input: Record<string, unknown>;
  space: ConfigSpace;
  resolver?: ScriptResolver;
  evaluator?: ScriptEvaluator;
  redactor?: RenderRedactor;
  resolvedDefaults?: ScriptDefaultsResolver;
  expression?: ScriptExpressionRenderer;
  options?: ScriptOptions;

  extendedContextValues?: Record<string, any>;

  constructor({
    app = {},
    name,
    config,
    defaults,
    input,
    runtime,
    resolve,
    evaluate,
    redact,
    express,
    options,
    resolvedDefaults,
    context,
  }: {
    app?: Pick<PardonAppContext, "database" | "secrets">;
    name?: string;
    config?: Record<string, string>[];
    defaults?: DefaultsMap;
    input?: Record<string, unknown>;
    runtime?: Record<string, unknown>;
    resolve?: ScriptDataResolver;
    resolvedDefaults?: ScriptDefaultsResolver;
    evaluate?: ScriptDataEvaluator;
    redact?: RenderRedactor;
    express?: ScriptExpressionRenderer;
    options?: ScriptOptions;
    context?: Record<string, any>;
  } = {}) {
    this.app = app;
    this.name = () => name;
    this.input = input ?? {};
    this.space = new ConfigSpace(config ?? [{}], defaults);
    this.space.choose(input ?? {});

    this.resolver = (context, { identifier, scoped }) => {
      let value = this.input[identifier.root];
      if (value === undefined) {
        value = resolve?.(context, { name: identifier.root, scoped });
      }

      const resolved = resolveAccess(context, {
        value,
        identifier,
        scoped,
      });

      return resolved;
    };

    this.resolvedDefaults = resolvedDefaults;

    this.evaluator = (identifier, context) =>
      runtime?.[identifier.root] ?? evaluate?.(identifier.root, context);

    this.redactor = redact;
    this.expression = express;
    this.options = options;
    this.extendedContextValues = context;
  }

  resolve({
    identifier,
    context,
    scoped,
  }: {
    context: SchemaContext<unknown>;
    identifier: Identifier;
    scoped?: boolean;
  }): unknown {
    return this.resolver?.(context, { identifier, scoped });
  }

  evaluate({
    identifier,
    context,
  }: {
    identifier: Identifier;
    context: SchemaRenderContext;
  }): unknown | undefined | Promise<unknown | undefined> {
    const resolved = this.resolver?.(context, { identifier, scoped: false });
    if (resolved !== undefined) {
      return resolved;
    }

    return this.evaluator?.(identifier, context);
  }

  match(
    template: Pattern,
    patterns: Pattern[],
  ): { patterns: Pattern[]; related: string[] } | undefined {
    return this.space.match(template, patterns);
  }

  config(context: SchemaContext, patterns: Pattern[]) {
    if (context.evaluationScope?.scopePath()?.length) {
      return patterns;
    }

    return this.space.config(patterns);
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

  get contextValues() {
    return { ...this.extendedContextValues, ...this.implied(), ...this.input };
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

  evaluating<T>({
    evaluation,
    identifier,
    source,
    context,
  }: {
    evaluation: () => Promise<T>;
    identifier: Identifier | null;
    source: string | null;
    context: SchemaRenderContext;
  }): Promise<T | string> {
    return this.expression
      ? (this.expression({
          evaluation,
          identifier,
          source,
          context,
        }) as Promise<T | string>)
      : evaluation();
  }

  async redact<T>({
    value,
    context: { mode },
    patterns,
  }: {
    value: T;
    context: SchemaRenderContext;
    patterns: Pattern[] | null;
  }) {
    if (mode === "preview") {
      return value;
    }

    return this.redactor?.(value, patterns) ?? value;
  }

  option(key: string) {
    return this.options?.(key);
  }
}

export function resolveAccess(
  context: SchemaContext,
  {
    identifier,
    value,
    scoped,
  }: { identifier: Identifier; value: unknown; scoped?: boolean },
) {
  const indices = indexChain(context.evaluationScope);

  // scoped resoltion is only for detecting conflicts with
  // existing definitions.
  if (!scoped) {
    if (identifier.path.length === 0) {
      return value;
    }

    if (identifier.name.endsWith(".@key")) {
      const keyIndex = indices.length - identifier.path.length;
      return indices[keyIndex]?.key;
    }
  } else {
    if (identifier.path.length === 0 && indices.length === 0) {
      return value;
    }
  }

  const resolved = identifier.path.reduce<unknown>(
    (value, step, idx) => {
      const index = indices[indices.length - idx - 1];
      value = step === "@value" ? value : value?.[step];
      if (!index) {
        return undefined;
      } else if (index.key === undefined) {
        if (
          !index.struts.some(({ root, path, name }) => {
            return (
              root === identifier.root &&
              name === identifier.path[idx] &&
              path.join(".") === identifier.path.slice(0, idx).join(".")
            );
          })
        ) {
          index.struts.push({
            loc: loc(context) + ":::" + identifier.name,
            root: identifier.root,
            path: identifier.path.slice(0, idx),
            name: identifier.path[idx],
          });
        }
      } else if (String(index.key) !== "@value") {
        value = value?.[String(index.key)];
      }

      return value;
    },
    { [identifier.path[0]]: value },
  );

  if (identifier.name.endsWith(".@value") || identifier.name === "@value") {
    return resolved;
  }

  return resolved?.[identifier.name];
}

function resolvedScalars(context: SchemaMergingContext<unknown>) {
  return mapObject(context.evaluationScope.resolvedValues({ secrets: false }), {
    values(value) {
      switch (typeof value) {
        case "string":
        case "number":
        case "boolean":
        case "bigint":
          return String(value);
      }
      if (value instanceof Number) {
        return value["source"];
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
