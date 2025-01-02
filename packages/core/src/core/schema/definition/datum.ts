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
  matchToPattern,
  patternRender,
  patternize,
  patternsMatch,
  renderTrivialPattern,
} from "../core/pattern.js";
import {
  isNonEmpty,
  isOptional,
  isRequired,
  isSecret,
  isMelding,
} from "./hinting.js";
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
  Schematic,
  SchematicOps,
} from "../core/types.js";
import {
  defineSchema,
  defineSchematic,
  exposeSchematic,
  isSchema,
  isSchematic,
} from "../core/schema-ops.js";
import { diagnostic, isAbstractContext } from "../core/context-util.js";
import {
  convertScalar,
  isScalar,
  Scalar,
  scalarFuzzyTypeOf,
  ScalarType,
  scalarTypeOf,
  unboxObject,
} from "./scalar.js";
import { uniqReducer } from "../../../util/uniq-reducer.js";

type DatumRepresentation = {
  patterns: Pattern[];
  type?: ScalarType;
  custom?: PatternBuilding;
  unboxed?: boolean;
};

const defaultScalarBuilding: PatternBuilding = {
  re: ({ hint }) => (isNonEmpty({ hint }) ? ".+" : ".*"),
};

function mergeRepresentation<T extends Scalar>(
  context: SchemaMergingContext<T>,
  rep: DatumRepresentation,
  info?: DatumSchematicInfo<T>,
): DatumRepresentation | undefined {
  if (info === undefined) {
    return rep;
  }

  let { patterns } = rep;
  const { template, literal } = info;
  const custom = rep.custom ?? info.custom;
  const type = rep.type ?? info.type;
  const unboxed = rep.unboxed || info.unboxed;

  if (template !== undefined) {
    const source = String(template);

    const pattern = literal
      ? patternLiteral(source)
      : patternize(source, custom ?? defaultScalarBuilding);

    if (
      context.mode === "meld" &&
      patterns.length &&
      !isPatternTrivial(pattern) &&
      !pattern.vars.some((param) => isMelding(param))
    ) {
      if (
        !patterns?.some((existing) =>
          arePatternsMeldable(context, existing, pattern),
        )
      ) {
        return;
      }
    }

    const templatePattern =
      context.mode === "match"
        ? patternLiteral(String(template))
        : patternize(String(template), custom);

    if (context.scope.parent) {
      if (
        !patterns.some((pattern) => patternsMatch(templatePattern, pattern))
      ) {
        patterns = [templatePattern, ...patterns];
      }
    } else {
      const match = context.environment.match(
        context.mode === "match"
          ? patternLiteral(String(template))
          : patternize(String(template), custom),
        patterns,
      );

      if (!match) {
        return;
      }
      patterns = match.patterns;
    }
  }

  return {
    custom,
    patterns,
    type,
    unboxed,
  };
}

// this is a bit rough, still:
// the idea is that {{a}} and {{b}} are different patterns which don't by-default conflate
// (we would conflate them if explicitly imply meldability by `{{~b}}` on the incoming pattern).
//
// But a value and a parameter are conflated if they can be.
// we might want to use to context to check/apply this better.
function arePatternsMeldable(
  _context: SchemaMergingContext<unknown>,
  existing: Pattern,
  pattern: PatternRegex,
) {
  if (isPatternTrivial(existing)) {
    return true;
  }

  if (existing.source === pattern.source) {
    return true;
  }

  if (isPatternSimple(existing) && isPatternSimple(pattern)) {
    return existing.vars[0].param == pattern.vars[0].param;
  }

  return false;
}

function defineScalar<T extends Scalar>(self: DatumRepresentation): Schema<T> {
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
          pattern.vars.find((v) => v.param === param)?.expression ||
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
            expression: null,
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

        pattern?.vars?.forEach(({ param, hint, source, expression }) => {
          if (!param) {
            return;
          }

          scope.declare(param, {
            context,
            expression:
              (exprPattern == pattern ? expression : undefined) ?? null,
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
      const info = extractDatumInfo(context);
      const mergedSelf = mergeRepresentation(context, self, info);

      if (!mergedSelf) {
        return;
      }

      const { patterns, type, unboxed } = mergedSelf;

      if (!patterns) {
        if (info?.template !== undefined) {
          diagnostic(
            context,
            `incompatible stub ${info.template} with ${self.patterns.map(({ source }) => JSON.stringify(source)).join(", ")}`,
          );
          return undefined;
        }

        // don't give up yet?
        return defineScalar(mergedSelf);
      }

      const resolved = patterns
        .map((pattern) => renderTrivialPattern(pattern))
        .filter((resolved) => resolved !== undefined)
        .reduce(...uniqReducer(String));

      if (resolved.length > 1) {
        diagnostic(
          context,
          `multiple values for patterns: ${patterns.map(({ source }) => source).join(", ")}`,
        );
        return undefined;
      }

      let appraised = resolved[0] ?? tryResolve(context, patterns);

      if (
        context.mode === "match" &&
        appraised !== undefined &&
        info?.template === undefined
      ) {
        const redact = patterns.some(
          (pattern) =>
            isPatternRegex(pattern) && pattern.vars.some((v) => isSecret(v)),
        );

        diagnostic(
          context,
          `expected value: ${redact ? "<redacted>" : appraised} = ${redact ? "<redacted>" : info?.template}`,
        );

        return undefined;
      }

      if (appraised !== undefined) {
        appraised = convertScalar(appraised, type, { unboxed }) as T;
      }

      if (appraised === undefined && context.mode === "match") {
        if (
          patterns.some(
            (pattern) =>
              isPatternRegex(pattern) && pattern.vars.some(isRequired),
          )
        ) {
          diagnostic(context, "required value");

          return undefined;
        }
      }

      if (appraised !== undefined) {
        const issue = defineMatchesInScope(context, patterns, appraised, {
          unboxed,
        });

        if (issue) {
          diagnostic(context, issue);
          return undefined;
        }
      }

      if (appraised === undefined && context.phase === "validate") {
        const requiredPattern = patterns.find(
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
                declaration?.expression ||
                declaration?.rendered ||
                patterns.some((pattern) => isPatternExpressive(pattern))
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
    render(context) {
      return renderScalar(context, self) as T | Promise<T>;
    },
    resolve(context) {
      return resolveScalar(context, self, false);
    },
  });
}

function renderScalar<T>(
  context: SchemaRenderContext,
  self: DatumRepresentation,
): Promise<T | undefined> | Exclude<T, undefined> {
  const { scope } = context;

  // TODO: resolve scalar here if possible (optimization)

  return scope.cached(context, () => doRenderScalar(context, self));
}

function resolveScalar<T extends Scalar>(
  context: SchemaContext<T>,
  self: DatumRepresentation,
  forScope?: boolean,
): T | undefined {
  const { patterns, unboxed } = self;

  const configuredPatterns =
    context.mode === "render" ||
    context.mode === "preview" ||
    context.mode === "prerender" ||
    context.mode === "postrender"
      ? context.environment.config(context, patterns)
      : patterns;
  //      : context.environment.match(patterns);

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
    const issue = defineMatchesInScope(context, configuredPatterns, result, {
      unboxed,
    });

    if (issue) {
      if (isMergingContext(context)) {
        diagnostic(context, `define: ${issue}`);
        return undefined;
      }

      throw diagnostic(context, `define: ${issue}`);
    }

    return convertScalar(result, self.type, { unboxed }) as T;
  }
}

async function doRenderScalar<T>(
  context: SchemaRenderContext,
  self: DatumRepresentation,
): Promise<T | undefined> {
  const { mode, environment } = context;
  const { patterns, type, unboxed } = self;

  // remap patterns against config
  const configuredPatterns = environment.config(context, patterns);

  // if we have exhausted the configuration space, fail.
  if (!configuredPatterns) {
    throw diagnostic(context, "no valid configurations");
  }

  let result: unknown | undefined;

  // if there's a pattern which is already defined, we can evaluate it
  const definition = resolveDefinedPattern(context, configuredPatterns);
  if (definition !== undefined) {
    result = convertScalar(definition, type, { unboxed });
  }

  if (mode === "render" || mode === "prerender" || mode === "postrender") {
    if (result === undefined) {
      result = convertScalar(
        (await evaluateScalar(context, configuredPatterns)) as Scalar,
        type,
        { unboxed },
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
  } else if (result !== undefined && isScalar(result)) {
    const issue = defineMatchesInScope(context, configuredPatterns, result, {
      unboxed,
    });

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
  self: DatumRepresentation,
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
  self: DatumRepresentation,
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

function defineMatchesInScope<T extends Scalar>(
  context: SchemaContext<T>,
  patterns: Pattern[],
  value: Scalar,
  { unboxed }: { unboxed?: boolean },
) {
  const { scope } = context;

  for (const pattern of patterns) {
    if (
      isPatternRegex(pattern) &&
      isPatternSimple(pattern) &&
      matchToPattern(pattern, String(value))
    ) {
      const key = pattern.vars[0].param;

      if (key) {
        scope.define(
          context,
          key,
          unboxed ? unboxObject(value as T | null) : (value as T | null),
        );
        scope.declare(key, {
          context,
          expression: null,
          source: pattern.vars[0].source ?? null,
          hint: pattern.vars[0].hint ?? null,
        });
      }

      continue;
    }

    const match = isPatternRegex(pattern)
      ? matchToPattern(
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

        scope.define(
          context,
          key,
          unboxed ? unboxObject(value) : (value as T | null),
        );
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
  expression: string | undefined,
) {
  const resolved = resolveIdentifier(context, identifier);

  return resolved !== undefined
    ? resolved
    : evaluateIdentifierWithExpression(context, identifier, expression);
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
      pattern.vars[0].expression,
    );
  } else {
    return patternRender(
      pattern,
      isPatternTrivial(pattern)
        ? []
        : await Promise.all(
            pattern.vars.map(async ({ param, expression }) => {
              return String(
                await resolveOrEvaluate(context, param, expression),
              );
            }),
          ),
    );
  }
}

type DatumSchematicInfo<T> = {
  template: T | string;
  anull?: true; // renders missing values as null instead of undefined.
  unboxed?: boolean;
  type?: ScalarType;
  literal?: boolean;
  custom?: PatternBuilding;
};

type DatumSchematicOps<T> = SchematicOps<T> & {
  datum(context?: SchemaMergingContext<T>): DatumSchematicInfo<T>;
};

function extractDatumInfo<T>(
  context: SchemaMergingContext<T>,
): DatumSchematicInfo<T> | undefined {
  const template = context.template;

  if (isSchema(template)) {
    throw diagnostic(
      context,
      `unexpected schema found where template was expected`,
    );
  }

  if (isSchematic(template)) {
    const ops = exposeSchematic<DatumSchematicOps<T>>(template);

    if (!ops.datum) {
      throw diagnostic(
        context,
        `merge scalar with unknown schematic (${Object.keys(ops).join("/")})`,
      );
    }

    return ops.datum(context);
  }

  return template === undefined
    ? undefined
    : {
        template: template as T,
        literal: context.mode === "match",
        type: scalarFuzzyTypeOf(context, template as T),
      };
}

function mergeSchematic<T extends Scalar>(
  template: string | T | Schematic<Scalar> | undefined,
  options: Omit<DatumSchematicInfo<T>, "template">,
): DatumSchematicInfo<any> {
  if (isSchematic(template)) {
    const schematicInfo = exposeSchematic<DatumSchematicOps<any>>(template);

    if (!schematicInfo.datum) {
      throw new Error("scalar type cannot be applied to non-scalar schematic");
    }

    const scalar = schematicInfo.datum();

    return {
      template: scalar.template,
      anull: options.anull ?? scalar.anull,
      custom: options.custom ?? scalar.custom,
      literal: options.literal ?? scalar.literal,
      type: options.type ?? scalar.type,
      unboxed: options.unboxed ?? scalar.unboxed,
    };
  }

  return {
    ...options,
    template,
  };
}

export function datumTemplate<T extends Scalar>(
  input: string | T | Schematic<Scalar> | undefined,
  options: Omit<DatumSchematicInfo<T>, "template">,
) {
  const { template, type, custom, literal, anull, unboxed } = mergeSchematic(
    input,
    options,
  );

  return defineSchematic<DatumSchematicOps<T>>({
    datum(context) {
      if (!context) {
        return {
          template: template,
          type,
          custom,
          literal,
          anull,
          unboxed,
        };
      }

      if (typeof template === "function") {
        throw diagnostic(context, "cannot expand scalar over schematic");
      }

      return {
        template: template,
        type:
          // this "as" cast is weird, but tsc lint is determining something weird here without it.
          type ??
          ((context && scalarFuzzyTypeOf(context, template)) as
            | ScalarType
            | undefined),
        custom,
        literal,
        anull,
        unboxed,
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
            template: template,
            type: type ?? scalarFuzzyTypeOf(context, template),
            custom,
            literal,
            unboxed,
          },
        )!,
      ) as Schema<T>;
    },
  });
}

export const datums = {
  datum: <T extends Scalar = Scalar>(
    source: T | string,
    options?: { unboxed?: boolean },
  ) => datumTemplate(source, options ?? {}),
  pattern: <T extends Scalar = Scalar>(
    source: string,
    {
      re,
      type = "string",
      unboxed,
    }: PatternBuilding & {
      type?: ScalarType;
      unboxed?: boolean;
    },
  ) => datumTemplate<T>(source, { type, unboxed, custom: { re } }),
  antipattern: <T extends Scalar = Scalar>(source: T) =>
    datumTemplate<T>(source, {
      type: scalarTypeOf(source),
      literal: true,
    }),
};

function tryResolve(
  context: SchemaMergingContext<unknown>,
  patterns: Pattern[],
) {
  if (isAbstractContext(context)) {
    return undefined;
  }

  for (const pattern of patterns) {
    if (isPatternTrivial(pattern)) {
      continue;
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
}
