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
  type Pattern,
  patternMatch,
  patternize,
  patternLiteral,
  isPatternRegex,
  patternsSimilar,
  PatternRegex,
  trivialPatternMatch,
  arePatternsCompatible,
} from "./pattern.js";
import { arrayIntoObject, mapObject } from "../../../util/mapping.js";
import { SchemaMergingContext } from "./schema.js";
import { isScalar } from "../definition/scalars.js";

export type ConfigMapping =
  | string
  | {
      [key: string]: Record<string, ConfigMapping>;
    };

export class ConfigSpace {
  options: Record<string, string>[];
  possibilities: Record<string, string>[];
  mapping: Record<string, ConfigMapping>;

  constructor(mapping: Record<string, ConfigMapping>) {
    this.options = this.possibilities = enumerateConfigs(
      (this.mapping = mapping),
    );
  }

  keys() {
    return new Set(this.options.flatMap(Object.keys));
  }

  choose(config: Record<string, unknown>) {
    this.possibilities = this.possibilities.filter((possibility) =>
      compatible(possibility, config),
    );

    return this;
  }

  exhausted(): boolean {
    return this.possibilities.length == 0;
  }

  implied(override?: Record<string, string>) {
    const implications = implied(this.possibilities);

    if (!override) {
      return implications;
    }

    const inferred = implied(
      this.options.filter((option) => compatible(option, override)),
    );
    const merged = {
      ...implications,
      ...inferred,
    };

    return {
      ...implied(this.options.filter((option) => compatible(option, merged))),
      ...override,
    };
  }

  match(
    patterns: Pattern[],
    {
      context,
      patternize,
      resolve,
    }: {
      context: SchemaMergingContext<string>;
      patternize(s: string): PatternRegex;
      resolve(p: Pattern): string | undefined;
    },
  ) {
    const space = this.configurations(patterns);
    const { stub } = context;

    // if there's no related configuration for these patterns,
    // mix in the stub pattern and bail.
    if (!space) {
      if (stub === undefined || !isScalar(stub)) {
        return patterns;
      }

      const stubPattern =
        context.mode === "match" ? patternLiteral(stub) : patternize(stub);

      if (
        patterns.some((pattern) => !arePatternsCompatible(stubPattern, pattern))
      ) {
        return undefined;
      }

      return [stubPattern, ...patterns];
    }

    const {
      // all the possible configuration patterns and what they imply
      possible,
      // other patterns (that may be useful in defining the value)
      other,
      // the patterns/options that are related to the current value
      naturally,
      // the implied options of the current value
      nature,
    } = space;

    if (stub !== undefined) {
      const stubPattern =
        context.mode === "match" ? patternLiteral(stub) : patternize(stub);
      const stubValue = resolve(stubPattern);

      if (stubValue) {
        other.unshift(patternLiteral(stubValue));
      } else {
        other.unshift(stubPattern);
      }

      const matchings = possible.filter(({ pattern }) =>
        stubValue !== undefined
          ? patternMatch(pattern, stubValue)
          : patternsSimilar(pattern, stubPattern),
      );

      this.possibilities = this.possibilities.filter((possibility) =>
        matchings.some(({ option }) => compatible(possibility, option)),
      );
    } else {
      this.possibilities = this.possibilities.filter((possibility) =>
        compatible(possibility, nature),
      );
    }

    const selected = possible
      .filter(({ option }) =>
        this.possibilities.some((possibility) =>
          compatible(possibility, option),
        ),
      )
      .filter(
        ({ pattern }) =>
          !other.some((other) => trivialPatternMatch(pattern, other)),
      );

    const rewritten = other
      .flatMap((pattern) =>
        naturally.flatMap(({ pattern: from }) =>
          selected.flatMap(({ pattern: to }) => {
            const rewritten = pattern.rewrite(from, to);
            return rewritten;
          }),
        ),
      )
      .filter(Boolean)
      .filter(
        (rewrittenPattern) =>
          !other.some((otherPattern) =>
            trivialPatternMatch(otherPattern, rewrittenPattern),
          ),
      );

    const selectedOrRewrittenPatterns = [
      ...selected.map(({ pattern }) => pattern),
      ...rewritten,
    ];

    // check for incompatible configured patterns
    // (do we need to check any other pairs?)
    if (
      other.some((otherPattern) =>
        selectedOrRewrittenPatterns.some(
          (pattern) => !arePatternsCompatible(otherPattern, pattern),
        ),
      )
    ) {
      return undefined;
    }

    return [...selectedOrRewrittenPatterns, ...other];
  }

  reconfigurePatterns(patterns: Pattern[]) {
    const space = this.configurations(patterns);

    if (!space) {
      return patterns;
    }

    const { possible, naturally, other } = space;

    const compatibleNature = implied(
      naturally.map(({ option }) =>
        compatibleSubset(option, this.possibilities),
      ),
    );

    const selected = possible.filter(({ option }) =>
      this.possibilities.some(
        (possibility) =>
          compatible(compatibleNature, option) &&
          compatible({ ...option, ...compatibleNature }, possibility),
      ),
    );

    const rewritten = other.flatMap((pattern) =>
      naturally.flatMap(({ pattern: from }) =>
        selected.flatMap(
          ({ pattern: to }) => pattern.rewrite(from, to) ?? pattern,
        ),
      ),
    );

    return [...selected.map(({ pattern }) => pattern), ...rewritten];
  }

  configurations(patterns: Pattern[]) {
    const { configurable, all } = patterns.reduce(
      (acc, pattern) => {
        if (isPatternRegex(pattern)) {
          const configurable = pattern.vars.some(({ param }) =>
            this.options.some((option) => option[param] !== undefined),
          );

          if (configurable) {
            acc.configurable.push(pattern);
          }
        }

        acc.all.push(pattern);

        return acc;
      },
      { configurable: [] as PatternRegex[], all: [] as Pattern[] },
    );

    if (configurable.length === 0) {
      return;
    }

    // all possible patterns based on configurable options.
    const possible = configurable.flatMap((pattern) =>
      this.options
        .filter((option) =>
          pattern.vars.some(({ param }) => option[param] !== undefined),
        )
        .map((option) => ({
          option,
          pattern: pattern.repattern(
            pattern.vars.map(({ param }) => option[param]),
          ),
        })),
    );

    const same = possible.filter(({ pattern: possibility }) =>
      all.some((pattern) => trivialPatternMatch(pattern, possibility)),
    );

    const other = all.filter(
      (pattern) =>
        !possible.some(({ pattern: possibility }) =>
          trivialPatternMatch(pattern, possibility),
        ),
    ) as Pattern[];

    const nature = implied(same.map(({ option }) => option));
    const naturally = possible.filter(({ option }) =>
      compatible(option, nature),
    );

    return { possible, nature, naturally, other };
  }

  update(name: string, value: unknown): unknown {
    if (!this.options.some((option) => name in option)) {
      return value;
    }

    const potential = this.possibilities.filter((possibility) => {
      const pi = possibility[name];
      if (pi === undefined) {
        return true;
      }
      const sv = String(value ?? "");
      return pi == sv || matchesPattern(pi, sv);
    });

    const choices = new Set(potential.map((option) => option[name] ?? value));

    if (choices.size >= 1) {
      this.possibilities = potential;
      if (potential.length === 0) {
        return undefined;
      }

      return value;
    }

    return undefined;
  }

  reset() {
    this.possibilities = this.options;
    return this;
  }
}

function matchesPattern(pattern: string, value: string) {
  return patternMatch(patternize(pattern), value);
}

function enumerateConfig(
  name: string,
  configMapping: ConfigMapping,
): Record<string, string>[] {
  function enumerate(mapping: ConfigMapping) {
    if (typeof mapping === "string") {
      return [{ [name]: mapping }];
    }

    if (Object.keys(mapping).length > 1) {
      throw new Error("irredeemable config mapping");
    }

    return Object.entries(mapping).flatMap(([key, submapping]) => {
      return Object.entries(submapping).flatMap(([value, next]) =>
        enumerate(next).map((option: object) => ({ [key]: value, ...option })),
      );
    });
  }

  return enumerate(configMapping);
}

function enumerateConfigs(configs: Record<string, ConfigMapping> = {}) {
  const values = Object.values(
    mapObject(configs, (value, key) => enumerateConfig(key, value)),
  );

  return values.reduce(
    (options, values) =>
      options.flatMap((option) =>
        values
          .filter(
            (value) =>
              compatible(option, value) &&
              (Object.keys(value).some((k) => option[k] === undefined) ||
                Object.keys(option).some((k) => value[k] === undefined)),
          )
          .map((value) => ({ ...option, ...value })),
      ),
    [{} as Record<string, string>],
  );
}

function implied(options: Record<string, string>[]): Record<string, string> {
  return arrayIntoObject([...new Set(options.flatMap(Object.keys))], (key) => {
    let value: string | undefined;
    for (const option of options) {
      const opt = option[key];
      if (value === undefined) {
        value = opt;
      } else if (
        value !== undefined &&
        (opt !== value || !matchesPattern(opt, value))
      ) {
        return;
      }
    }

    if (value !== undefined) {
      return { [key]: value };
    }
  });
}

function compatible(
  possibility: Record<string, string>,
  config: Record<string, unknown>,
) {
  return Object.entries(possibility).every(([k, v]) => {
    const ck = config[k];

    // TODO: this v === ck || matchesPattern system is a bit sloppy.
    // (replicated in update as well).
    return (
      ck === undefined || v === String(ck) || matchesPattern(v, String(ck))
    );
  });
}

function compatibleSubset(
  config: Record<string, unknown>,
  possibilities: Record<string, string>[],
) {
  return arrayIntoObject(Object.entries(config), ([key, value]) => {
    if (
      possibilities.some(
        ({ [key]: possibility }) =>
          possibility === undefined || String(value) === possibility,
      )
    ) {
      return { [key]: String(value) };
    }
  });
}
