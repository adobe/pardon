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
  arePatternsCompatible,
} from "../core/pattern.js";
import {
  isNonEmpty,
  isOptional,
  isRequired,
  isSecret,
  isMelding,
  isHidden,
} from "./hinting.js";
import {
  resolveIdentifier,
  evaluateIdentifierWithExpression,
} from "../core/evaluate.js";
import { isMergingContext } from "../core/schema.js";
import { isLookupValue } from "../core/scope.js";
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
import {
  diagnostic,
  isAbstractContext,
  rescope,
} from "../core/context-util.js";
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
import { JSON } from "../../raw-json.js";

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

    const templatePattern =
      context.mode === "match" || literal
        ? patternLiteral(source)
        : patternize(source, custom ?? defaultScalarBuilding);

    if (
      context.mode === "meld" &&
      patterns.length &&
      !isPatternTrivial(templatePattern) &&
      !templatePattern.vars.some((param) => isMelding(param))
    ) {
      if (
        !patterns?.some((existing) =>
          arePatternsMeldable(context, existing, templatePattern),
        )
      ) {
        return;
      }
    }

    if (context.evaluationScope.path.length) {
      if (
        !patterns.every((pattern) =>
          arePatternsCompatible(pattern, templatePattern),
        )
      ) {
        return;
      }

      if (
        !patterns.some((pattern) => patternsMatch(templatePattern, pattern))
      ) {
        patterns = [templatePattern, ...patterns];
      }
    } else {
      const match = context.environment.match(
        context.mode === "match" || literal
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
      const { evaluationScope: scope } = context;
      const { patterns } = self;

      // only consider expressions for the last-merged expressive definition.
      const exprPattern = patterns?.find(isPatternExpressive);

      function renderedTrigger(
        param: string,
      ): ExpressionDeclaration["rendered"] {
        // setup a triggered render for a value if the
        // the pattern could be resolved via evaluation.
        //
        // we avoid some cases because it makes things break
        if (
          patterns.length === 1 &&
          !patterns.some(isPatternExpressive) &&
          patterns.every(isPatternSimple)
        ) {
          return;
        }

        return (context) => {
          return renderAndLookup(rescope(context, scope), self, param);
        };
      }

      for (const pattern of patterns) {
        if (!isPatternRegex(pattern)) {
          continue;
        }

        for (const { param, hint, source, expression } of pattern.vars) {
          if (!param) {
            return;
          }

          scope.declare(param, {
            context,
            expression:
              (exprPattern == pattern ? expression : undefined) ?? null,
            hint: hint ?? null,
            source: source ?? null,
            rendered: renderedTrigger(param),
            resolved(context) {
              return resolveAndLookup(
                rescope(context, scope) as SchemaContext<Scalar>,
                self,
                param,
              );
            },
          });
        }
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
        return defineScalar<T>(mergedSelf);
      }

      const resolvedPatterns = patterns
        .map((pattern) => renderTrivialPattern(pattern))
        .filter((resolved) => resolved !== undefined)
        .reduce(...uniqReducer(String));

      if (resolvedPatterns.length > 1) {
        diagnostic(
          context,
          `multiple values for patterns: ${patterns.map(({ source }) => source).join(", ")}`,
        );
        return undefined;
      }

      let resolved = resolvedPatterns[0] ?? tryResolve(context, patterns);

      if (
        (context.mode === "match" || info?.literal) &&
        resolved !== undefined &&
        info?.template === undefined &&
        context.phase === "validate"
      ) {
        const redact = patterns.some(
          (pattern) =>
            isPatternRegex(pattern) && pattern.vars.some((v) => isSecret(v)),
        );

        diagnostic(
          context,
          `expected value: ${redact ? "<redacted>" : resolved} = ${redact ? "<redacted>" : info?.template}`,
        );

        return undefined;
      }

      if (resolved !== undefined) {
        resolved = convertScalar(resolved, type, { unboxed }) as T;
      }

      if (
        resolved === undefined &&
        (context.mode === "match" || info?.literal)
      ) {
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

      if (resolved !== undefined) {
        const issue = defineMatchesInScope(context, patterns, resolved, {
          unboxed,
        });

        if (issue) {
          diagnostic(context, issue);
          return undefined;
        }
      }

      if (resolved === undefined && context.phase === "validate") {
        const requiredPattern = patterns.find(
          (pattern) =>
            isPatternRegex(pattern) &&
            pattern.vars.some((variable) => {
              if (!isRequired(variable)) {
                return false;
              }

              const { param } = variable;

              if (!param) {
                return true;
              }

              if (
                resolveAndLookup(
                  context,
                  self /* or mergedSelf, configuredSelf? */,
                  param,
                ) !== undefined
              ) {
                return false;
              }

              const declaration = context.evaluationScope.lookup(param) as
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
    async render(context) {
      const result = await renderScalar(context, self);
      return datumPreviewExpression(context, result) as T;
    },
    resolve(context) {
      return resolveScalar(context, self, false);
    },
  });
}

function renderScalar<T>(
  context: SchemaRenderContext,
  self: DatumRepresentation,
): Exclude<T, undefined> | Promise<T | undefined> {
  return doRenderScalar(context, self);
}

function resolveScalar<T extends Scalar>(
  context: SchemaContext<T>,
  self: DatumRepresentation,
  forScope?: boolean,
): T | undefined {
  const { patterns, unboxed, type } = self;

  const configuredPatterns =
    context.mode === "render" ||
    context.mode === "preview" ||
    context.mode === "prerender" ||
    context.mode === "postrender"
      ? context.environment.config(context, patterns)
      : patterns;

  if (!configuredPatterns && forScope) {
    return;
  }

  if (!configuredPatterns) {
    throw diagnostic(context, `configuration exhausted`);
  }

  let result = resolveDefinedPattern(context, configuredPatterns);

  if (result !== undefined) {
    result = convertScalar(result, type, { unboxed }) as T;

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

    return result as T;
  }
}

async function doRenderScalar<T>(
  context: SchemaRenderContext,
  self: DatumRepresentation,
): Promise<T | undefined> {
  const { mode, environment } = context;
  const { type, unboxed } = self;

  const patterns = environment.config(context, self.patterns);

  // if we have exhausted the configuration space, fail.
  if (!patterns) {
    throw diagnostic(context, "no valid configurations");
  }

  const hidden = patterns
    .filter(isPatternRegex)
    .some(({ vars }) => vars.length && vars.every(isHidden));

  const resolution = resolveScalar(context, self, false) as
    | Exclude<T, undefined>
    | undefined;

  if (resolution !== undefined) {
    if (hidden) return undefined;

    return environment.redact({
      value: resolution as T,
      context,
      patterns: patterns,
    }) as Promise<T> | T;
  }

  let result: unknown | undefined;

  // if there's a pattern which is already defined, we can evaluate it
  const definition = resolveDefinedPattern(context, patterns);

  if (definition !== undefined) {
    result = convertScalar(definition, type, { unboxed });
  }

  if (mode === "render" || mode === "prerender" || mode === "postrender") {
    if (result === undefined) {
      result = convertScalar(
        (await evaluateScalar(context, patterns as PatternRegex[])) as Scalar,
        type,
        { unboxed },
      );
    }

    if (result === undefined) {
      if (
        mode === "prerender" ||
        mode === "postrender" ||
        patterns.every(
          (pattern) =>
            isPatternLiteral(pattern) || pattern.vars.every(isOptional),
        )
      ) {
        return undefined;
      }

      throw diagnostic(context, `unevaluated: ${patterns[0]?.source}`);
    }
  }

  if (mode === "preview" && result === undefined) {
    // TODO: this unfortunately discards any known type here.
    return patterns[0]?.source as T;
  } else if (result !== undefined && isScalar(result)) {
    const issue = defineMatchesInScope(context, patterns, result, {
      unboxed,
    });

    if (issue) {
      throw diagnostic(context, issue);
    }
  }

  if (result == null) {
    return result as T;
  }

  if (hidden) return undefined;

  return environment.redact({
    value: result as T,
    context,
    patterns: patterns,
  }) as Promise<T> | T;
}

async function renderAndLookup(
  context: SchemaRenderContext,
  self: DatumRepresentation,
  param: string,
) {
  await renderScalar(context, self);

  const { evaluationScope: scope } = context;

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

  const { evaluationScope: scope } = context;

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
    const { resolutions } = context.evaluationScope;
    if (param in resolutions) {
      return resolutions[param];
    }

    // prevent resolution cycles
    resolutions[param] = undefined;
    return (resolutions[param] = resolveIdentifier(context, param));
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
  const { evaluationScope: scope } = context;

  for (const pattern of patterns) {
    if (isPatternSimple(pattern) && matchToPattern(pattern, String(value))) {
      const { param } = pattern.vars[0];

      if (param) {
        scope.define(
          context,
          param,
          unboxed ? unboxObject(value as T | null) : (value as T | null),
        );
        scope.declare(param, {
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
  patterns: PatternRegex[],
) {
  // otherwise, we find the first pattern with expressions.
  let pattern = patterns.find(isPatternExpressive);

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

  if (!pattern) {
    // find the first pattern that has named parameters
    pattern = patterns.find((pattern) =>
      pattern.vars.every(({ param }) => param),
    );
  }

  // try all patterns for resolving this value.
  for (const pattern of patterns) {
    const result = await evaluatePattern(context, pattern);
    if (result === undefined) {
      continue;
    }

    return result;
  }

  return undefined;
}

async function evaluatePattern(context: SchemaRenderContext, pattern: Pattern) {
  if (isPatternSimple(pattern)) {
    const { param, expression } = pattern.vars[0];

    return await resolveOrEvaluate(context, param, expression);
  } else {
    if (isPatternTrivial(pattern)) {
      return patternRender(pattern, []);
    }

    const params = await Promise.all(
      pattern.vars.map(async ({ param, expression, re }) =>
        param || expression
          ? resolveOrEvaluate(context, param, expression)
          : re?.test("")
            ? ""
            : undefined,
      ),
    );

    if (params.some((value) => value === undefined)) {
      return undefined;
    }

    return patternRender(
      pattern,
      params.map((p) => String(p)),
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
        literal: context.mode === "match" ? true : undefined,
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
          template,
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
        template,
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
      const rep = mergeRepresentation(
        context,
        {
          patterns: [],
        },
        {
          template,
          type: type ?? scalarFuzzyTypeOf(context, template),
          custom,
          literal,
          unboxed,
        },
      );

      return rep && defineScalar<T>(rep);
    },
  });
}

function datumPreviewExpression<T>(
  context: SchemaRenderContext,
  data: T,
): T | string {
  if (typeof data == "string" && context.mode === "preview") {
    const pattern = patternize(data);
    const exprs = pattern.vars.map(({ expression, source, param, hint }) =>
      expression && source?.includes("$$expr(")
        ? `{{ ${hint ?? ""}${param ?? ""} = ${expression} }}`
        : source
          ? `{{${source}}}`
          : "?",
    );
    return patternRender(pattern, exprs);
  }
  return data;
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
