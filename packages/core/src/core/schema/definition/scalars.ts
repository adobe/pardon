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
import { isNonEmpty, isOptional, isRequired, isSecret } from "./hinting.js";
import {
  resolveIdentifier,
  evaluateIdentifierWithExpression,
} from "../core/evaluate.js";
import { isMergingContext } from "../core/schema.js";
import { isLookupValue, parseScopedIdentifier } from "../core/scope.js";
import { rescope } from "../core/context.js";
import {
  ExpressionDeclaration,
  Schema,
  SchemaContext,
  SchemaMergingContext,
  SchemaRenderContext,
  SchematicOps,
} from "../core/types.js";
import {
  defineSchema,
  defineSchematic,
  exposeSchematic,
  isSchema,
} from "../core/schema-ops.js";
import { Scalar, ScalarType } from "./scalar-type.js";
import { diagnostic, isAbstractContext } from "../core/context-util.js";

type ScalarRepresentation = {
  patterns: Pattern[];
  type?: ScalarType;
  custom?: PatternBuilding;
};

const defaultScalarBuilding: PatternBuilding = {
  re: ({ hint }) => (isNonEmpty({ hint }) ? ".+" : ".*"),
};

function mergeRepresentation<T extends Scalar>(
  context: SchemaMergingContext<T>,
  rep: ScalarRepresentation,
  info?: ScalarSchematicInfo<T>,
): ScalarRepresentation | undefined {
  if (info === undefined) {
    return rep;
  }

  const { value, literal } = info;
  let { patterns } = rep;
  const custom = rep.custom ?? info.custom;
  const type = rep.type ?? info.type;

  const source = String(value);

  const pattern = literal
    ? patternLiteral(source)
    : patternize(source, custom ?? defaultScalarBuilding);

  if (context.mode === "meld" && patterns.length) {
    if (!isPatternTrivial(pattern)) {
      if (
        !patterns?.some(
          (existing) =>
            isPatternTrivial(existing) || existing.source === source,
        )
      ) {
        return;
      }
    }
  }

  if (!patterns?.some((existing) => patternsMatch(pattern, existing))) {
    patterns = [pattern, ...(patterns ?? [])];
  }

  return {
    custom,
    patterns,
    type,
  };
}

function defineScalar<T extends Scalar>(self: ScalarRepresentation): Schema<T> {
  return defineSchema<T>({
    scope(context) {
      const { scope } = context;
      const { patterns } = self;

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
          return renderAndLookup(rescope(context, scope), self, param);
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
                rescope(context, scope) as SchemaContext<Scalar>,
                self,
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
                rescope(context, scope) as SchemaContext<Scalar>,
                self,
                param,
              );
            },
          });
        });
      }

      // calling this for the side-effect of populating
      // the scope with values from pattern matching
      if (!isMergingContext(context)) {
        resolveScalar(context, self, true);
      }
    },
    merge(context) {
      const { environment } = context;
      const info = extractScalar(context);
      const mergedSelf = mergeRepresentation(context, self, info);
      if (!mergedSelf) {
        return;
      }

      const { patterns, type, custom } = mergedSelf;

      /*
       * This is where the patterns/values we have get
       * interpolated by the config: mapping into
       * matching alternates.  It also reduces the set
       * of matching alternates as resolved patterns are merged.
       */
      const configuredPatterns = environment.match({
        context: {
          ...context,
          template: info?.value,
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
        if (info?.value !== undefined) {
          diagnostic(
            context,
            `incompatible stub ${info.value} with ${patterns.map(({ source }) => JSON.stringify(source)).join(", ")}`,
          );
          return undefined;
        }

        // don't give up yet?
        return defineScalar(mergedSelf);
      }

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
        info?.value === undefined
      ) {
        const redact = configuredPatterns.some(
          (pattern) =>
            isPatternRegex(pattern) && pattern.vars.some((v) => isSecret(v)),
        );

        diagnostic(
          context,
          `expected value: ${redact ? "<redacted>" : appraised} = ${redact ? "<redacted>" : info?.value}`,
        );

        return undefined;
      }

      if (appraised !== undefined) {
        appraised = convert(appraised, type) as T;
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

              if (
                resolveAndLookup(
                  context,
                  self /* or mergedSelf, configuredSelf? */,
                  variable.param,
                ) !== undefined
              ) {
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

      return defineScalar<T>(mergedSelf);
    },
    async render(context) {
      return (await renderScalar(context, self)) as T;
    },
  });
}

function renderScalar<T>(
  context: SchemaRenderContext,
  self: ScalarRepresentation,
): Promise<T | undefined> {
  const { scope } = context;

  return scope.cached(context, () => doRenderScalar(context, self));
}

function resolveScalar<T extends Scalar>(
  context: SchemaContext<T>,
  self: ScalarRepresentation,
  forScope?: boolean,
): T | undefined {
  const { patterns, custom } = self;

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
    throw diagnostic(context, `configuration exhausted`);
  }

  const result: Scalar | undefined = resolveDefinedPattern(
    context,
    configuredPatterns,
  );

  if (result !== undefined) {
    const issue = defineMatchesInScope(context, configuredPatterns, result);

    if (issue) {
      if (isMergingContext(context)) {
        diagnostic(context, `define: ${issue}`);
        return undefined;
      }

      throw diagnostic(context, `define: ${issue}`);
    }

    return result as T;
  }
}

async function doRenderScalar<T>(
  context: SchemaRenderContext,
  self: ScalarRepresentation,
): Promise<T | undefined> {
  const { mode, environment } = context;
  const { patterns, type } = self;

  // remap patterns against endpoint config
  const configuredPatterns = environment.reconfigurePatterns(context, patterns);

  // if we have exhausted the configuration space, fail.
  if (!configuredPatterns) {
    throw diagnostic(context, "no valid configurations");
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

      throw diagnostic(context, `unevaluated: type=${type}`);
    }
  }

  if (mode === "preview" && result === undefined) {
    // TODO: this unfortunately discards any known type here.
    return configuredPatterns[0].source as T;
  } else if (result !== undefined) {
    const issue = defineMatchesInScope(context, configuredPatterns, result);

    if (issue) {
      throw diagnostic(context, issue);
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

async function renderAndLookup(
  context: SchemaRenderContext,
  self: ScalarRepresentation,
  param: string,
) {
  await renderScalar(context, self);

  const { scope } = context;

  const lookup = scope.lookup(param);

  if (isLookupValue(lookup)) {
    return lookup.value;
  }
}

function resolveAndLookup<T extends Scalar>(
  context: SchemaContext<T>,
  self: ScalarRepresentation,
  param: string,
) {
  if (resolveScalar(context, self) === undefined) {
    return undefined;
  }

  const { scope } = context;

  const lookup = scope.lookup(param);

  if (isLookupValue(lookup)) {
    return lookup.value;
  }
}

function fullPatternDefinition(context: SchemaContext, pattern: Pattern) {
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

function defineMatchesInScope<T extends Scalar>(
  context: SchemaContext<T>,
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
        scope.define(context, key, value as T | null);
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

        scope.define(context, key, value as T | null);
      }
    }
  }
}

function findFullyDefinedPattern(context: SchemaContext, patterns: Pattern[]) {
  for (const pattern of patterns) {
    const params = fullPatternDefinition(context, pattern);
    if (params) {
      return { pattern, params };
    }
  }
}

function resolveDefinedPattern(context: SchemaContext, patterns: Pattern[]) {
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

function resolvePattern<T extends Scalar>(
  context: SchemaContext<T>,
  pattern?: Pattern,
) {
  if (!pattern) {
    return;
  }

  if (isAbstractContext(context)) {
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

type ScalarSchematicInfo<T extends Scalar> = {
  value: T | string;
  type?: ScalarType;
  literal?: boolean;
  custom?: PatternBuilding;
};

type ScalarSchematicOps<T extends Scalar> = SchematicOps<T> & {
  scalar(context: SchemaMergingContext<T>): ScalarSchematicInfo<T>;
};

function extractScalar<T extends Scalar>(
  context: SchemaMergingContext<T>,
): ScalarSchematicInfo<T> | undefined {
  const template = context.template;

  if (typeof template === "function") {
    const ops = exposeSchematic<ScalarSchematicOps<T>>(template);
    if (isSchema(template)) {
      throw diagnostic(context, `illegal schema`);
    }

    if (!ops.scalar) {
      throw diagnostic(
        context,
        `merge scalar with unknown schematic (${Object.keys(ops).join("/")})`,
      );
    }

    return ops.scalar(context);
  }

  return template === undefined
    ? undefined
    : {
        value: template as T,
        literal: context.mode === "match",
        type: scalarFuzzyTypeOf(context, template as T),
      };
}

function schematicTemplate<T extends Scalar>(
  value: T | string,
  {
    type,
    custom,
    literal,
  }: { type?: ScalarType; custom?: PatternBuilding; literal?: true },
) {
  return defineSchematic<ScalarSchematicOps<T>>({
    scalar(context) {
      return {
        value,
        type: type ?? scalarFuzzyTypeOf(context, value),
        custom,
        literal,
      };
    },
    expand(context) {
      return defineScalar(
        mergeRepresentation(
          context,
          {
            patterns: [],
          },
          {
            value,
            type: type ?? scalarFuzzyTypeOf(context, value),
            custom,
            literal,
          },
        ),
      ) as Schema<T>;
    },
  });
}

export const scalars = {
  any: <T extends Scalar = Scalar>(source: T | string) =>
    schematicTemplate<T>(source, {}),
  null: (source: string) => schematicTemplate<null>(source, { type: "null" }),
  string: (source: string) =>
    schematicTemplate<string>(source, { type: "string" }),
  pattern: <T extends Scalar = Scalar>(
    source: string,
    {
      re,
      type = "string",
    }: PatternBuilding & {
      type?: ScalarType;
    },
  ) => schematicTemplate<T>(source, { type, custom: { re } }),
  antipattern: <T extends Scalar = Scalar>(source: T) =>
    schematicTemplate<T>(source, {
      type: scalarTypeOf(source),
      literal: true,
    }),
  number: (source: string) =>
    schematicTemplate<number>(source, { type: "number" }),
  bigint: (source: string) =>
    schematicTemplate<bigint>(source, { type: "bigint" }),
  boolean: (source: string) =>
    schematicTemplate<boolean>(source, { type: "boolean" }),
};

function scalarTypeOf(value?: Scalar): ScalarType | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? "null"
      : (typeof value as ScalarType);
}

function scalarFuzzyTypeOf<T extends Scalar>(
  context: SchemaMergingContext<T>,
  value?: NoInfer<T> | string,
): ScalarType | undefined {
  if (
    context.mode !== "match" &&
    typeof value === "string" &&
    isPatternSimple(patternize(value))
  ) {
    return undefined;
  }

  return value === undefined
    ? undefined
    : value === null
      ? "null"
      : (typeof value as ScalarType);
}
