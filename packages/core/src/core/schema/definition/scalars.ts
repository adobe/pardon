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
  PatternBuilding,
  PatternRegex,
  isPatternExpressive,
  isPatternLiteral,
  isPatternRegex,
  isPatternSimple,
  isPatternTrivial,
  patternLiteral,
  patternMatch,
  patternRender,
  patternize,
  patternsMatch,
} from "../core/pattern.js";
import { isNonEmpty, isOptional, isRequired } from "./scalar-hinting.js";
import {
  resolveIdentifier,
  evaluateIdentifierWithExpression,
} from "../core/evaluate.js";
import {
  SchematicOps,
  defineSchema,
  SchemaRenderContext,
  SchemaMergingContext,
  SchemaCaptureContext,
  Schema,
  isMatchingContext,
  ExpressionDeclaration,
} from "../core/schema.js";
import { SchemaError } from "../core/schema-error.js";
import { isLookupValue, parseScopedIdentifier } from "../core/scope.js";
import { rescope } from "../core/schema-utils.js";
import { isSecret } from "../../endpoint-environment.js";
import { diagnostic } from "../core/context.js";

export type Scalar = string | number | boolean | bigint | null;
export type ScalarType = "string" | "number" | "boolean" | "bigint" | "null";

export type ScalarOps<T extends Scalar = Scalar> = SchematicOps<T> & {
  type(): ScalarType | undefined;
  patterns(): Pattern[];
};

type ScalarOptions = {
  type?: ScalarType;
  patterns?: Pattern[];
  custom: PatternBuilding | null;
};

const defaultScalarBuilding: PatternBuilding = {
  re: ({ hint }) => (isNonEmpty({ hint }) ? ".+" : ".*"),
};

function defineScalar<T extends Scalar>(
  template: T | string | undefined,
  { type, patterns = [], custom }: ScalarOptions,
): Schema<T> {
  if (template !== undefined) {
    if (typeof template !== "string" && !type) {
      type = scalarTypeOf(template);
    }

    const pattern = patternize(
      String(template),
      custom ?? defaultScalarBuilding,
    );

    if (pattern.vars.length !== 1 && !type) {
      type = "string";
    }

    if (!patterns?.some((existing) => patternsMatch(pattern, existing))) {
      patterns = [pattern, ...(patterns || [])];
    }
  }

  patterns = patterns.filter(
    (p, idx, all) => !all.slice(0, idx).some((q) => patternsMatch(p, q)),
  );

  return defineSchema<ScalarOps<T>>({
    scope(context) {
      const { scope } = context;

      // only consider expressions for the last-merged expressive definition.
      const exprPattern = patterns?.find(isPatternExpressive);

      function renderedTrigger(
        param: string,
        pattern: Pattern,
      ): ExpressionDeclaration["rendered"] {
        // setup a triggered render for a value if the
        // the pattern could be resolved via evaluation:
        //
        // we don't do this to avoid "cyclic dependencies" (worse and more expensive than "undefined" values),
        // in the following cases:
        //
        // - trivial patterns can be resolved rather than rendered.
        // - the param to be evaluated is in the pattern and not an expression.
        // - every pattern is simple and not expressive (or has an expression in scope).
        //
        // (should this also skip cases for non-simple patterns?)
        if (
          isPatternTrivial(pattern) ||
          pattern.vars.find((v) => v.param === param)?.expr ||
          patterns.every(
            (p) =>
              p === pattern ||
              (isPatternSimple(p) &&
                !isPatternExpressive(p) &&
                !context.scope.lookupDeclaration(
                  parseScopedIdentifier(p.vars[0].param).name,
                )?.rendered),
          )
        ) {
          return;
        }

        return (context) => {
          return renderAndLookup(rescope(context, scope), param);
        };
      }

      for (const pattern of patterns) {
        if (
          isPatternRegex(pattern) &&
          isPatternSimple(pattern) &&
          pattern != exprPattern
        ) {
          const { param } = pattern.vars[0];

          scope.declare(param, {
            context,
            expr: null,
            source: pattern.vars[0].source ?? null,
            hint: pattern.vars[0].hint ?? null,
            rendered: renderedTrigger(param, pattern),
            resolved(context) {
              return resolveAndLookup(
                rescope(context, scope) as SchemaCaptureContext<Scalar>,
                param,
              );
            },
          });

          continue;
        }

        if (!isPatternRegex(pattern)) {
          continue;
        }

        pattern?.vars?.forEach(({ param, hint, source, expr }) => {
          if (!param) {
            return;
          }

          scope.declare(param, {
            context,
            expr: (exprPattern == pattern ? expr : undefined) ?? null,
            hint: hint ?? null,
            source: source ?? null,
            rendered: renderedTrigger(param, pattern),
            resolved(context) {
              return resolveAndLookup(
                rescope(context, scope) as SchemaCaptureContext<Scalar>,
                param,
              );
            },
          });
        });
      }

      // calling this for the side-effect of populating
      // the scope with values from pattern matching
      resolveScalar(context, true);
    },
    merge(context) {
      const { stub, environment } = context;

      /*
       * This is where the patterns/values we have get
       * interpolated by the config: mapping into
       * matching alternates.  It also reduces the set
       * of matching alternates as resolved patterns are merged.
       */
      const configuredPatterns = environment.match({
        context: {
          ...context,
          stub,
        },
        patterns,
        resolve(pattern) {
          return resolvePattern(context, pattern);
        },
        patternize(s: string) {
          return patternize(s, custom ?? defaultScalarBuilding);
        },
      });

      if (!configuredPatterns) {
        if (stub !== undefined) {
          diagnostic(
            context,
            `incompatible stub ${stub} with ${patterns.map(({ source }) => JSON.stringify(source)).join(", ")}`,
          );
          return undefined;
        }

        return defineScalar<T>(undefined, {
          type,
          patterns,
          custom,
        });
      }

      const primedType = type ?? scalarTypeOf(stub);

      let appraised: Scalar | undefined;

      for (const pattern of configuredPatterns) {
        appraised = resolvePattern(context, pattern);
        if (appraised !== undefined) {
          break;
        }
      }

      if (
        context.mode === "match" &&
        appraised !== undefined &&
        stub === undefined
      ) {
        const redact = configuredPatterns.some(
          (pattern) =>
            isPatternRegex(pattern) && pattern.vars.some((v) => isSecret(v)),
        );

        diagnostic(
          context,
          `expected value: ${redact ? "<redacted>" : appraised} = ${redact ? "<redacted>" : stub}`,
        );

        return undefined;
      }

      if (appraised !== undefined) {
        appraised = convert(appraised, primedType) as T;
      }

      if (appraised === undefined && context.mode === "match") {
        if (
          configuredPatterns.some(
            (pattern) =>
              isPatternRegex(pattern) && pattern.vars.some(isRequired),
          )
        ) {
          diagnostic(context, "required value");

          return undefined;
        }
      }

      if (appraised !== undefined) {
        const issue = defineMatchesInScope(
          context,
          configuredPatterns,
          appraised,
        );

        if (issue) {
          diagnostic(context, issue);
          return undefined;
        }
      }

      if (appraised === undefined && context.phase === "validate") {
        const requiredPattern = configuredPatterns.find(
          (pattern) =>
            isPatternRegex(pattern) &&
            pattern.vars.some((variable) => {
              if (!isRequired(variable)) {
                return false;
              }

              if (!variable.param) {
                return true;
              }

              if (resolveAndLookup(context, variable.param) !== undefined) {
                return false;
              }

              const declaration = context.scope.lookup(variable.param) as
                | ExpressionDeclaration
                | undefined;

              if (
                declaration?.expr ||
                declaration?.rendered ||
                configuredPatterns.some((pattern) =>
                  isPatternExpressive(pattern),
                )
              ) {
                diagnostic(context, "unresolved required pattern");
              }

              return true;
            }),
        );

        if (requiredPattern) {
          diagnostic(
            context,
            `undefined but required by ${requiredPattern.source}`,
          );

          return undefined;
        }
      }

      return defineScalar<T>(undefined, {
        type: primedType,
        patterns: configuredPatterns,
        custom,
      });
    },
    async render(context) {
      return (await renderScalar(context)) as T;
    },
    type() {
      return type;
    },
    patterns() {
      return patterns;
    },
  });

  function renderScalar(context: SchemaRenderContext): Promise<T | undefined> {
    const { scope } = context;

    return scope.cached(context, () => doRenderScalar(context));
  }

  function resolveScalar(
    context: SchemaCaptureContext<Scalar>,
    forScope?: boolean,
  ): T | undefined {
    const configuredPatterns =
      context.mode === "render" ||
      context.mode === "preview" ||
      context.mode === "prerender" ||
      context.mode === "postrender"
        ? context.environment.reconfigurePatterns(context, patterns)
        : context.environment.match({
            patterns,
            context: context as SchemaMergingContext<string>,
            resolve(pattern) {
              return resolvePattern(context, pattern);
            },
            patternize(s: string) {
              return patternize(s, custom ?? defaultScalarBuilding);
            },
          });

    if (!configuredPatterns && forScope) {
      return;
    }

    if (!configuredPatterns) {
      throw SchemaError.error(context, { note: `configuration exhausted` });
    }

    const result: Scalar | undefined = resolveDefinedPattern(
      context,
      configuredPatterns,
    );

    if (result !== undefined) {
      const issue = defineMatchesInScope(context, configuredPatterns, result);

      if (issue) {
        if (isMatchingContext(context)) {
          diagnostic(context, issue);
          return undefined;
        }

        throw SchemaError.error(context, { note: issue });
      }

      return result as T;
    }
  }

  async function doRenderScalar(
    context: SchemaRenderContext,
  ): Promise<T | undefined> {
    const { mode, environment } = context;

    // remap patterns against endpoint config
    const configuredPatterns = environment.reconfigurePatterns(
      context,
      patterns,
    );

    // if we have exhausted the configuration space, fail.
    if (!configuredPatterns) {
      throw SchemaError.render.reject(context, {
        note: "no valid configurations",
      });
    }

    let result: Scalar | undefined;

    // if there's a pattern which is already defined, we can evaluate it
    const definition = resolveDefinedPattern(context, configuredPatterns);
    if (definition !== undefined) {
      result = convert(definition, type);
    }

    if (mode === "render" || mode === "prerender" || mode === "postrender") {
      if (result === undefined) {
        result = convert(
          (await evaluateScalar(context, configuredPatterns)) as Scalar,
          type,
        );
      }

      if (result === undefined) {
        if (
          mode === "prerender" ||
          mode === "postrender" ||
          configuredPatterns.some(
            (pattern) =>
              isPatternLiteral(pattern) || pattern.vars.every(isOptional),
          )
        ) {
          return undefined;
        }

        throw SchemaError.render.unevaluated(context, {
          note: `type=${type}`,
        });
      }
    }

    if (mode === "preview" && result === undefined) {
      // TODO: this unfortunately discards any known type here.
      return configuredPatterns[0].source as T;
    } else if (result !== undefined) {
      const issue = defineMatchesInScope(context, configuredPatterns, result);

      if (issue) {
        throw SchemaError.render.reject(context, { note: issue });
      }
    }

    if (result == null) {
      return result as T;
    }

    return environment.redact({
      value: result as T,
      context,
      patterns: configuredPatterns,
    }) as T;
  }

  async function renderAndLookup(context: SchemaRenderContext, param: string) {
    await renderScalar(context);

    const { scope } = context;

    const lookup = scope.lookup(param);

    if (isLookupValue(lookup)) {
      return lookup.value;
    }
  }

  function resolveAndLookup(
    context: SchemaCaptureContext<Scalar>,
    param: string,
  ) {
    if (resolveScalar(context) === undefined) {
      return undefined;
    }

    const { scope } = context;

    const lookup = scope.lookup(param);

    if (isLookupValue(lookup)) {
      return lookup.value;
    }
  }
}

function fullPatternDefinition(
  context: SchemaCaptureContext,
  pattern: Pattern,
) {
  if (isPatternLiteral(pattern)) {
    return [];
  }

  const definitions = pattern.vars.map(({ param }) => {
    if (!param) {
      return undefined;
    }
    return resolveIdentifier(context, param);
  });

  if (definitions.every((value) => value !== undefined)) {
    return definitions;
  }
}

function convert(value?: Scalar, type?: ScalarType) {
  if (value === undefined) {
    return undefined;
  }

  switch (type) {
    case "null":
      return value === "null" ? null : undefined;
    case "boolean":
      return value === "false" ? false : Boolean(value);
    case "number":
      return Number(value);
    case "string":
      return String(value);
    case "bigint":
      return value != null ? BigInt(value) : undefined;
    default:
      return value;
  }
}

function defineMatchesInScope(
  context: SchemaCaptureContext<Scalar>,
  patterns: Pattern[],
  value: Scalar,
) {
  const { scope } = context;

  for (const pattern of patterns) {
    if (
      isPatternRegex(pattern) &&
      isPatternSimple(pattern) &&
      patternMatch(pattern, String(value))
    ) {
      const key = pattern.vars[0].param;
      if (key) {
        scope.define(context, key, value);
        scope.declare(key, {
          context,
          expr: null,
          source: pattern.vars[0].source ?? null,
          hint: pattern.vars[0].hint ?? null,
        });
      }
      continue;
    }

    const match = isPatternRegex(pattern)
      ? patternMatch(
          pattern,
          String(value),
          pattern.vars.map(({ param }) => {
            const lookup = scope.lookup(param);
            if (isLookupValue(lookup)) {
              return lookup.value;
            }
          }),
        )
      : pattern.source == String(value);

    if (!match) {
      return `mismatch: pattern ${pattern.source} with ${
        patterns.some(
          (pattern) => isPatternRegex(pattern) && pattern.vars.some(isSecret),
        )
          ? "<redacted>"
          : value
      }`;
    }

    if (typeof match === "object") {
      for (const [key, value] of Object.entries(match!)) {
        if (!key) {
          continue;
        }

        scope.define(context, key, value);
      }
    }
  }
}

function findFullyDefinedPattern(
  context: SchemaCaptureContext,
  patterns: Pattern[],
) {
  for (const pattern of patterns) {
    const params = fullPatternDefinition(context, pattern);
    if (params) {
      return { pattern, params };
    }
  }
}

function resolveDefinedPattern(
  context: SchemaCaptureContext,
  patterns: Pattern[],
) {
  const definition = findFullyDefinedPattern(context, patterns);
  if (definition) {
    const { params, pattern } = definition;

    if (isPatternSimple(pattern)) {
      return params[0] as Scalar;
    } else {
      return patternRender(pattern, params.map(String));
    }
  }
}

function resolveOrEvaluate(
  context: SchemaRenderContext,
  identifier: string,
  expr: string | undefined,
) {
  const resolved = resolveIdentifier(context, identifier);

  return resolved !== undefined
    ? resolved
    : evaluateIdentifierWithExpression(context, identifier, expr);
}

async function evaluateScalar(
  context: SchemaRenderContext,
  patterns: Pattern[],
) {
  // otherwise, we find the first pattern with expressions.
  let pattern = (patterns as PatternRegex[]).find(isPatternExpressive);

  // if we can't find one and every pattern is defined as optional,
  // that's fine: we return undefined.  We shouldn't get here if there are any literals,
  // since they would be fully defined and we would have returned above..
  if (
    !pattern &&
    (patterns as PatternRegex[]).every((pattern) =>
      pattern.vars.every(isOptional),
    )
  ) {
    return undefined;
  }

  // pick a pattern to attempt to evaluate.
  if (!pattern) {
    pattern = patterns[0] as PatternRegex;
  }

  if (!pattern) {
    return undefined;
  }

  if (isPatternSimple(pattern)) {
    return await resolveOrEvaluate(
      context,
      pattern.vars[0].param,
      pattern.vars[0].expr,
    );
  } else {
    return patternRender(
      pattern,
      isPatternTrivial(pattern)
        ? []
        : await Promise.all(
            pattern.vars.map(async ({ param, expr }) => {
              return String(await resolveOrEvaluate(context, param, expr));
            }),
          ),
    );
  }
}

function resolvePattern(
  context: SchemaCaptureContext<Scalar>,
  pattern?: Pattern,
) {
  if (!pattern) {
    return;
  }

  if (isPatternLiteral(pattern)) {
    return pattern.source;
  }

  if (!pattern.vars.every(({ param }) => param)) {
    return;
  }

  const values = pattern.vars.map(({ param }) =>
    resolveIdentifier(context, param),
  );

  if (values.every((value) => value !== undefined)) {
    return patternRender(pattern, values.map(String));
  }
}

export const scalars = {
  any: <T extends Scalar = Scalar>(source: T | string) =>
    defineScalar<T>(source, { custom: null }),
  null: (source: string) =>
    defineScalar<null>(source, { type: "null", custom: null }),
  string: (source: string) =>
    defineScalar<string>(source, { type: "string", custom: null }),
  pattern: <T extends Scalar = Scalar>(
    source: string,
    {
      re,
      type = "string",
    }: PatternBuilding & {
      type?: ScalarType;
    },
  ) => defineScalar<T>(source, { type, custom: { re } }),
  antipattern: <T extends Scalar = Scalar>(source: T) =>
    defineScalar<T>(undefined, {
      type: scalarTypeOf(source),
      patterns: [patternLiteral(String(source))],
      custom: null,
    }),
  number: (source: string) =>
    defineScalar<number>(source, { type: "number", custom: null }),
  bigint: (source: string) =>
    defineScalar<bigint>(source, { type: "bigint", custom: null }),
  boolean: (source: string) =>
    defineScalar<boolean>(source, { type: "boolean", custom: null }),
};

export function isScalar(value: unknown): value is Scalar {
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
      return true;
    case "object":
      return value === null;
  }
  return false;
}

function scalarTypeOf(value?: Scalar): ScalarType | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? "null"
      : (typeof value as ScalarType);
}
