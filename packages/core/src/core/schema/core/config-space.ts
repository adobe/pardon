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
  type Pattern,
  matchToPattern,
  patternize,
  isPatternRegex,
  PatternRegex,
  arePatternsCompatible,
  patternsMatch,
} from "./pattern.js";
import { arrayIntoObject, mapObject } from "../../../util/mapping.js";
import { uniqReducer } from "../../../util/uniq-reducer.js";

export type ConfigMap = Record<string, ConfigMapping>;

type ConfigMapping =
  | string
  | string[]
  | {
      [key: string]: ConfigMap;
    };

export type DefaultsMap = Record<string, DefaultsMapping>;

type DefaultsMapping =
  | string
  | {
      [key: string]: DefaultsMap;
    };

export class ConfigSpace {
  options: Record<string, string>[];
  possibilities: Record<string, string>[];
  mapping: ConfigMap;
  defaults: DefaultsMap;
  chosen: Record<string, string> = {};

  constructor(mapping: ConfigMap, defaults?: DefaultsMap) {
    this.options = enumerateConfigs((this.mapping = mapping));
    this.defaults = defaults ?? {};

    this.possibilities = this.options.slice();
  }

  keys() {
    return new Set(this.options.flatMap(Object.keys));
  }

  choose(config: Record<string, unknown>) {
    Object.assign(this.chosen, config);
    this.possibilities = this.possibilities.filter((possibility) =>
      compatible(possibility, config),
    );

    return this;
  }

  exhausted(): boolean {
    return this.possibilities.length == 0;
  }

  implied(override?: Record<string, string>) {
    const implications = implied(...this.possibilities);

    if (!override) {
      return implications;
    }

    const inferred = implied(
      ...this.options.filter((option) => compatible(option, override)),
    );
    const merged = {
      ...implications,
      ...inferred,
    };

    return {
      ...implied(
        ...this.options.filter((option) => compatible(option, merged)),
      ),
      ...override,
    };
  }

  /**
   * matches patterns against the current configuration options.
   */
  match(
    template: Pattern,
    patterns: Pattern[],
  ): undefined | { patterns: Pattern[]; related: string[] } {
    const space = this.configurations(patterns, template);

    // if there's no related configuration for these patterns, bail
    if (!space) {
      if (patterns.some((pattern) => patternsMatch(pattern, template))) {
        return { patterns, related: [] };
      }

      return { patterns: [template, ...patterns], related: [] };
    }

    const {
      // all the possible configuration patterns and what they imply
      alternatives,
      // other patterns (that may be useful in defining the value)
      other,
      // the patterns/options that are related to the current value
      naturally,
      // which config keys are potentially implied by values for these patterns
      related,
    } = space;

    // reduce the options for this schema merge pass down to whatever
    // is compatible with the current natural set.
    this.possibilities = this.possibilities.filter((possibility) =>
      alternatives.some(
        ({ pattern, option }) =>
          compatible(possibility, option) &&
          arePatternsCompatible(template, pattern),
      ),
    );

    const selected = alternatives
      .filter(({ option }) =>
        this.possibilities.some((possibility) =>
          compatible(possibility, option),
        ),
      )
      .filter(
        ({ pattern }) => !other.some((other) => patternsMatch(pattern, other)),
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
            patternsMatch(otherPattern, rewrittenPattern),
          ),
      );

    const selectedOrRewrittenPatterns = [
      ...selected.map(({ pattern }) => pattern),
      ...rewritten,
    ];

    patterns = [...selectedOrRewrittenPatterns, ...other].reduce(
      ...uniqReducer<Pattern>((p) => p.source),
    );

    if (!patterns.some((pattern) => patternsMatch(pattern, template))) {
      patterns = [template, ...patterns];
    }

    return {
      patterns,
      related,
    };
  }

  config(patterns: Pattern[]) {
    const space = this.configurations(patterns);

    if (!space) {
      return patterns;
    }

    const { alternatives, naturally, other } = space;

    // determine additional compatible configurations info from the
    // natural mapping. (the current possibilities restricts us here)
    const compatibleNature = {
      ...implied(
        ...naturally.map(({ option }) =>
          compatibleSubset(option, this.possibilities),
        ),
      ),
      ...implied(...this.possibilities),
    };

    // reduce alternatives down to those that are compatible with the
    // current possibilities and don't override any data in the natural interpretation.
    let selected = alternatives.filter(
      ({ option }) =>
        compatible(option, compatibleNature) &&
        this.possibilities.some((possibility) =>
          compatible({ ...option, ...compatibleNature }, possibility),
        ),
    );

    if (selected.length > 1) {
      const inferred = {
        ...this.chosen,
        ...implied(...selected.map(({ option }) => option)),
      };

      selected = selected.filter(({ option }) =>
        Object.entries(option).every(
          ([k, v]) =>
            inferred[k] ??
            (resolveDefault(this.defaults[k], inferred) ?? v) == v,
        ),
      );
    }

    // rewrite any other mappings from the natural interpretation to the selected one.
    const rewritten = other.flatMap((pattern) =>
      naturally.flatMap(({ pattern: from }) =>
        selected.flatMap(
          ({ pattern: to }) => pattern.rewrite(from, to) ?? pattern,
        ),
      ),
    );

    return [...selected.map(({ pattern }) => pattern), ...rewritten].reduce(
      ...uniqReducer<Pattern>((pattern) => pattern.source),
    );
  }

  /**
   * Given a group of patterns with config-mapped parameters:
   * determine
   *  - `alternatives: { pattern, option }[]` which config options are possible (enumerating _all_ options).
   *  - `naturally: typeof possible` the subset of possibilities which are compatible the given patterns.
   *  - `other: Pattern[]` other patterns, these are maintained as potential sources of info.
   */
  configurations(patterns: Pattern[], template?: Pattern) {
    const { configurable, configuration } = [...patterns, template]
      .filter(Boolean)
      .reduce<{ configurable: PatternRegex[]; configuration: Pattern[] }>(
        (acc, pattern) => {
          if (isPatternRegex(pattern)) {
            const configurable = pattern.vars.some(({ param }) =>
              this.options.some((option) => option[param] !== undefined),
            );

            if (configurable) {
              acc.configurable.push(pattern);
              return acc;
            }
          }

          acc.configuration.push(pattern);
          return acc;
        },
        { configurable: [], configuration: [] },
      );

    if (configurable.length === 0) {
      return;
    }

    // all possible patterns based on configurable options.
    const alternatives = configurable.flatMap((pattern) =>
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

    const { same, other } = [...patterns, template].filter(Boolean).reduce(
      (acc, pattern) => {
        if (
          !alternatives.some(({ pattern: alternate, option }) => {
            if (patternsMatch(alternate, pattern)) {
              acc.same.push(option);

              return true;
            }
          })
        ) {
          acc.other.push(pattern);
        }
        return acc;
      },
      { same: [] as Record<string, string>[], other: [] as Pattern[] },
    );

    const current = implied(
      ...alternatives.flatMap(({ pattern, option }) =>
        configuration.some((info) => patternsMatch(info, pattern))
          ? [option]
          : [],
      ),
    );

    const nature = implied(
      ...same
        .filter((option) => compatible(current, option))
        .map((option) => option),
    );

    const naturally = alternatives.filter(({ option }) =>
      compatible(option, nature),
    );

    return {
      alternatives,
      naturally,
      other,
      related: related(Object.keys(nature), this.options),
    };
  }

  hint(values: Record<string, string>) {
    return mapObject(values, {
      filter(key, value) {
        return this.options.some(
          (option) => option[key] === value || option[key] === undefined,
        );
      },
    });
  }

  reset() {
    this.possibilities = this.options;
    return this;
  }
}

function matchesPattern(pattern: string, value: string) {
  return matchToPattern(patternize(pattern), value);
}

function enumerateConfig(
  name: string,
  configMapping: ConfigMapping,
): Record<string, string>[] {
  function enumerate(mapping: ConfigMapping) {
    if (typeof mapping === "string") {
      return [{ [name]: mapping }];
    }

    if (Array.isArray(mapping)) {
      return mapping.map((value) => ({ [name]: value }));
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

function enumerateConfigs(configs: ConfigMap = {}) {
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

function implied(...options: Record<string, string>[]): Record<string, string> {
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

function related(keys: string[], options: Record<string, string>[]) {
  void options;

  return keys;
}

function resolveDefault(
  defaulted: ConfigMapping,
  values: Record<string, string>,
): string | undefined {
  while (defaulted !== undefined) {
    if (typeof defaulted === "string") {
      return defaulted;
    }

    const [k, v] = Object.entries(defaulted)[0];
    defaulted = v[values[k] ?? "default"];
  }
}
