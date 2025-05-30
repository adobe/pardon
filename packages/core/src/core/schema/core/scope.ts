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
import { arrayIntoObject, mapObject } from "../../../util/mapping.js";
import { disarm } from "../../../util/promise.js";
import { valueId } from "../../../util/value-id.js";
import { PardonError } from "../../error.js";
import { shared } from "../../tracking.js";
import {
  isFlowExport,
  isNoExport,
  isOptional,
  isSecret,
} from "../definition/hinting.js";
import { isScalar } from "../definition/scalar.js";
import { diagnostic, loc } from "./context-util.js";
import { DEBUG } from "./debugging.js";
import { isMergingContext } from "./schema.js";
import {
  ExpressionDeclaration,
  ResolvedValueOptions,
  SchemaContext,
  SchemaRenderContext,
  EvaluationScope,
  ScopeData,
  ScopeIndex,
  ValueDeclaration,
  ValueDefinition,
  Identifier,
  AggregateDeclaration,
} from "./types.js";

export class Scope implements EvaluationScope, ScopeData {
  parent?: Scope;
  path: string[];
  index?: ScopeIndex;
  cache: Record<string, Promise<unknown | undefined> | unknown> = {};
  declarations: Record<string, ExpressionDeclaration> = {};
  importedValues: Set<string | symbol> = new Set();
  values: Record<string, ValueDefinition> = {};
  subscopes: Record<string, Scope> = {};
  evaluations: Record<string, undefined | Promise<unknown>> = {};
  resolutionStarted: Record<string, boolean> = {};

  constructor(parent?: Scope, path: string[] = [], index?: ScopeIndex) {
    this.parent = parent;
    this.path = path;
    this.index = index;
  }

  static createRootScope() {
    return new Scope(undefined, []);
  }

  exportValues(
    options: ResolvedValueOptions,
    depth: number = 0,
  ): Record<string, unknown> {
    const currentExports = arrayIntoObject(
      Object.values(this.values).filter(
        ({ identifier, path }) =>
          depth === path.length &&
          shouldExport(options, this.declarations[identifier]) &&
          !this.importedValues.has(identifier),
      ),
      ({ value, path, name }) => {
        const emit = {};
        const indices = indexChain(this).slice(-path.length);
        const node = path.reduce((node, step, idx) => {
          const index = indices.pop()!;

          if (!node || index.key === undefined) {
            return;
          }

          switch (index.type) {
            case "element": {
              const list = (node[step] ??= []);

              if (idx === path.length - 1 && name.endsWith(".@value")) {
                return (list[index.key!] = value) as any;
              }

              return (list[index.key!] = {});
            }
            case "field": {
              const object = (node[step] ??= {});

              if (idx === path.length - 1 && name.endsWith(".@value")) {
                return (object[index.key!] = value) as any;
              }

              return (object[index.key!] = {});
            }
            default:
              return node;
          }
        }, emit);

        if (node && !name.endsWith(".@key") && !name.endsWith(".@value")) {
          node[name] = value;
        }

        return emit;
      },
      mergeExports,
    );

    const subscopeExports = arrayIntoObject(
      Object.values(this.subscopes),
      (subscope) => subscope.exportValues(options, depth + 1),
      mergeExports,
    );

    return mergeExports(subscopeExports, currentExports);
  }

  exportableValues(options: ResolvedValueOptions): Record<string, unknown> {
    const localValues = mapObject(this.values, {
      values: ({ value }) => value,
      select: ({ declaration }, key) =>
        shouldExport(options, declaration) && !this.importedValues.has(key),
    });

    const exportValues = this.exportValues(options);

    return {
      ...exportValues,
      ...localValues,
    };
  }

  resolvedValues(
    options: ResolvedValueOptions = { secrets: false },
  ): Record<string, unknown> {
    return {
      ...this.parent?.resolvedValues(options),
      ...this.exportableValues(options),
    };
  }

  subscope(name: string, index: ScopeIndex) {
    return (this.subscopes[name] ??= new Scope(
      this,
      [...this.path, name],
      index,
    )) as EvaluationScope;
  }

  tempscope() {
    return new Scope(this, [...this.path]) as EvaluationScope;
  }

  rescope(evaluationScope: EvaluationScope): EvaluationScope {
    while (evaluationScope.parent) {
      evaluationScope = evaluationScope.parent!;
    }

    return this.path.reduce<{
      thisScope: EvaluationScope;
      thatScope: EvaluationScope;
    }>(
      ({ thisScope, thatScope }, part) => ({
        thatScope: thatScope.subscope(part, thisScope?.index),
        thisScope: thisScope?.subscopes[part] as Scope,
      }),
      { thisScope: this, thatScope: evaluationScope },
    ).thatScope as Scope;
  }

  scopePath() {
    return this.path;
  }

  imported(identifier: string) {
    this.importedValues.add(identifier);
  }

  declare(
    identifier: string,
    declaration: Omit<ExpressionDeclaration, "identifier" | "path" | "name">,
  ) {
    const { name, path } = parseScopedIdentifier(identifier);
    const { context } = declaration;

    let declared = this.declarations[name];

    if (!declared) {
      // TODO: re-evaluate this double assignment or
      // switch to export prefixes being multiply-associated with values.
      declared =
        this.declarations[name] =
        this.declarations[identifier] =
          {
            ...declaration,
            identifier,
            name,
            path,
          };

      if (this.values[name]) {
        this.values[name].declaration = declared;
      }
    } else {
      // okay, this is a bit convoluted
      // the expression is a definition of a value to be evaluated,
      // while the rendered function is a fallback that is
      // used to extract a value from a rendered match.
      //
      // as such, we complain when there's two expressions,
      // and we override any rendered fallbacks with expressions.

      const { expression, source, hint, rendered, resolved, aggregates } =
        declaration;
      if (!(expression || rendered || resolved || hint || aggregates)) {
        return;
      }

      if (expression && declared.expression) {
        // TODO: revisit why we need to compare declared.expression == expression
        // and fix the double declaration upstream?
        // TODO: revisit if we even want to do this, maybe overriding is good?
        if (expression !== declared.expression) {
          throw diagnostic(
            context,
            `redeclared ${identifier} = (${expression}): previously defined @${loc(
              declared.context,
            )} as (${declared.expression})`,
          );
        }
      }

      declared.expression ??= expression;
      declared.source = source;
      declared.hint ??= hint || null;
      declared.context = context;

      if (aggregates) {
        declared.aggregates = {
          ...declared.aggregates,
          ...mapObject(aggregates, (aggregate, key) =>
            mergeAggregates(declared.aggregates?.[key], aggregate),
          ),
        };
      }

      function mergeAggregates(
        a?: AggregateDeclaration,
        b?: AggregateDeclaration,
      ): AggregateDeclaration {
        if (!a || !b) {
          return (a ?? b)!;
        }

        return {
          type: b.type ?? a.type,
          archetype: b.archetype ?? a.archetype,
          specializations: {
            ...a.specializations,
            ...b.specializations,
          },
        };
      }

      // expressions override the need to attempt render-match matches.
      // we combine render and resolution triggers
      // in the hopes that one of them will work.
      declared.rendered = declared.expression
        ? undefined
        : combineAsync(rendered, declared.rendered);

      declared.resolved = combineSync(resolved, declared.resolved);
    }

    if (path.length && this.index) {
      const parentScope = this.parent;

      parentScope?.declare(path.join("."), {
        // this is a hack for aggregates that needs to be refactored.
        //  the refactor involves replacing contexts with scopes here (possibly multiple)
        //  and should also allow us to solve the declarations[name] = declarations[identifier] hack above
        context: null!,
        expression: null,
        source: "a",
        hint: "-",
        aggregates: {
          [name.split(".").slice(-1)[0]]: {
            type: this.index.type,
            ...(this.index.key === undefined
              ? { archetype: declared }
              : { specializations: { [this.index.key]: declared } }),
          },
        },
      });
    }
  }

  define<T>(
    context: SchemaContext<unknown>,
    identifier: string,
    value: T,
  ): T | undefined {
    const { name, path } = parseScopedIdentifier(identifier);

    const current = this.values[name];

    // note that scalars might be boxed, (also, might not be)

    // extra fuzzy match because null values might resolve to string "null" + type null, etc...
    if (current) {
      if (
        current.value === value ||
        (isScalar(current.value) &&
          isScalar(value) &&
          String(current.value) === String(value)) ||
        valueId(value) === valueId(current.value)
      ) {
        // upgrade the type to the value if we used to have a string.
        if (typeof current.value === "string") {
          current.value = value;
        }

        return value;
      }

      if (isMergingContext(context)) {
        diagnostic(
          context,
          `redefined:${name}=${valueId(value)} :: previously defined as ${valueId(current.value)}`,
        );

        // TODO: make this return undefined and propagate the error
        return undefined;
      }

      throw diagnostic(
        context,
        `redefined:${name}=${value} :: previously defined as ${current.value}`,
      );
    }

    if (value === undefined) {
      if (
        context.mode === "preview" ||
        context.mode === "prerender" ||
        context.mode === "postrender"
      ) {
        return value;
      }

      const hint = this.lookupDeclaration(identifier)?.hint ?? undefined;
      if (!isOptional({ hint })) {
        throw diagnostic(context, `undefined:${identifier}`);
      }
    }

    this.values[name] = this.values[identifier] = {
      identifier,
      value,
      name,
      path,
      context,
      declaration: this.declarations[identifier],
      ...(DEBUG ? { stack: new Error("defined:here") } : {}),
    };

    return value;
  }

  lookup(
    identifier: string,
  ): ValueDefinition | ExpressionDeclaration | undefined {
    const value = findValue(identifier, this);
    const declaration = this.lookupDeclaration(identifier);

    if (value) {
      if (
        !declaration ||
        value.context.evaluationScope === declaration?.context.evaluationScope
      ) {
        return value;
      }
    }

    return declaration;
  }

  lookupDeclaration(identifier: string): ExpressionDeclaration | undefined {
    return findDefinition(identifier, this);
  }

  resolve(context: SchemaContext, name: string) {
    let lookup = this.lookup(name);

    if (isLookupExpr(lookup) && lookup.resolved) {
      this.resolving(context, name, lookup.resolved);
      lookup = this.lookup(name);
    }

    if (isLookupValue(lookup)) {
      return lookup;
    }

    const identifier = parseScopedIdentifier(name);

    const value = context.environment.resolve({
      context,
      identifier,
    });

    if (value !== undefined) {
      if (this.define(context, name, value) === undefined) {
        return undefined;
      }

      return this.values[identifier.name];
    }
  }

  rendering<T>(
    context: SchemaRenderContext,
    name: string,
    action: () => Promise<T>,
  ) {
    type RenderingChainError = (Error | { message: string; cause?: Error }) & {
      loc: string;
      data?: any;
    };
    const location = loc(context);
    const evaluating = `${location}: evaluating ${name}`;
    const chainError: RenderingChainError = DEBUG
      ? Object.assign(new Error(evaluating), {
          loc: location,
        })
      : {
          message: evaluating,
          loc: location,
        };

    const identifier = parseScopedIdentifier(name);

    const evaluation =
      name === ""
        ? action()
        : ((this.evaluations[identifier.name] ??= this._doEvaluate(
            context,
            name,
            action,
          )) as Promise<T>);

    return evaluation.catch((chain) => {
      if (chain.loc === chainError.loc) {
        chain = diagnostic(context, `${name} is undefined`);
      }

      chainError.cause = chain;

      throw chainError;
    });
  }

  resolving<T>(
    context: SchemaContext,
    name: string,
    action: (context: SchemaContext) => T,
  ) {
    const identifier = parseScopedIdentifier(name);

    if (this.resolutionStarted[identifier.name]) {
      // or error on recursive resolution?
      return undefined;
    }

    this.resolutionStarted[identifier.name] = true;

    const value = action(context);

    if (value === undefined) {
      return undefined;
    }

    return this.define(context, name, action(context));
  }

  cached<T>(
    context: SchemaRenderContext,
    action: () => Promise<T> | T,
    ...keys: string[]
  ): Promise<T> | Exclude<T, undefined> {
    const key = [...context.keys, ...keys].join(".");

    return (this.cache[key] ??= disarm(
      shared(async () => action()),
    )) as Promise<T>;
  }

  evaluating(name: string) {
    return Boolean(this.evaluations[name]);
  }

  async _doEvaluate<T>(
    context: SchemaRenderContext,
    name: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const identifier = parseScopedIdentifier(name);

    this.evaluations[identifier.name] = disarm(
      Promise.reject(
        new PardonError(
          `${loc(context)} ${identifier.name}: circular definition`,
        ),
      ),
    );

    const value = await action();

    const result = name !== "" ? this.define(context, name, value) : value;

    if (result === undefined && context.mode !== "prerender") {
      if (context.mode !== "postrender") {
        const hint = this.lookupDeclaration(name)?.hint ?? undefined;

        if (!isOptional({ hint })) {
          throw diagnostic(context, `failed to define ${name}=${value}`);
        }
      }
    }

    return result!;
  }
}

export function isLookupValue(lookup: unknown): lookup is ValueDeclaration {
  return lookup?.["value"] !== undefined;
}

export function isLookupExpr(lookup: unknown): lookup is ExpressionDeclaration {
  return lookup?.["expression"] !== undefined;
}

function findDefinition(identifier: string, inScope: EvaluationScope) {
  let firstRenderedDeclaration: ExpressionDeclaration | undefined;
  let firstExpressionDeclaration: ExpressionDeclaration | undefined;
  let firstAggregateDeclaration: ExpressionDeclaration | undefined;

  for (const scope of scopeChain(inScope)) {
    if (identifier in scope.declarations) {
      const declaration = scope.declarations[identifier];

      if (declaration.rendered) {
        firstRenderedDeclaration ??= declaration;
      }
      if (declaration.expression) {
        firstExpressionDeclaration ??= declaration;
      }
      if (declaration.aggregates) {
        firstAggregateDeclaration ??= declaration;
      }
    }
  }

  return (
    firstRenderedDeclaration ??
    firstExpressionDeclaration ??
    firstAggregateDeclaration
  );
}

function findValue(name: string, inScope: Scope): ValueDeclaration | undefined {
  for (const scope of scopeChain(inScope)) {
    if (name in scope.values) {
      return scope.values[name];
    }
  }
}

function* scopeChain(scope?: EvaluationScope) {
  while (scope) {
    yield scope;

    scope = scope.parent;
  }
}

function combineAsync<F extends (...args: any) => Promise<unknown>>(
  fn?: F,
  gn?: F,
): F | undefined {
  if (!fn) return gn;
  if (!gn) return fn;

  return (async (...args: Parameters<F>) => {
    return ((await fn(...(args as any))) ?? (await gn(...(args as any)))) as
      | Awaited<ReturnType<F>>
      | undefined;
  }) as F;
}

function combineSync<F extends (...args: any) => unknown>(
  fn?: F,
  gn?: F,
): F | undefined {
  if (!fn) return gn;
  if (!gn) return fn;

  return ((...args: Parameters<F>) => {
    return fn(...(args as any)) ?? gn(...(args as any));
  }) as F;
}

export function parseScopedIdentifier(name: string): Identifier {
  if (!name) {
    return {
      name: "",
      root: "",
      path: [],
    };
  }

  const parts = name.split(".");
  const key = /.@[a-z]+$/.test(name) ? name : parts.slice(-1)[0];

  return {
    name: key,
    root: parts[0] ?? key,
    path: parts.slice(0, -1),
  };
}

function mergeExports(exported: unknown, current: unknown) {
  switch (true) {
    case exported === undefined:
      return current;
    case current === undefined:
      return exported;
    case Array.isArray(current):
      if (!Array.isArray(exported)) {
        throw new Error("mismatched array merge");
      }

      return [...(exported.length > current.length ? exported : current)].map(
        (_, i) => mergeExports(exported[i], current[i]),
      );

    case typeof current === "object" &&
      current &&
      Object.getPrototypeOf(current) === Object.prototype:
      if (current === null && Object.keys(exported || {}).length == 0) {
        return null;
      }

      return {
        ...(exported as Record<string, unknown>),
        ...mapObject(current as Record<string, unknown>, (value, key) =>
          mergeExports(exported![key], value),
        ),
      };
  }

  return current ?? exported;
}

function shouldExport(
  options: ResolvedValueOptions,
  declaration?: ExpressionDeclaration,
) {
  if (isNoExport(declaration)) {
    return false;
  }

  if (isSecret(declaration) && !options.secrets) {
    return false;
  }

  if (options.flow && !isFlowExport(declaration)) {
    return false;
  }

  return true;
}

export function indexChain(scope: EvaluationScope | undefined) {
  const chain: ScopeIndex[] = [];

  while (scope) {
    if (scope.index) {
      chain.push(scope.index);
    }
    scope = scope.parent;
  }

  return chain;
}
