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
import { arrayIntoObject } from "../../../util/mapping.js";
import { re } from "../../../util/re.js";
import { JSON } from "../../raw-json.js";

export type Pattern = PatternLiteral | PatternRegex;

export type PatternLiteral = {
  source: string;
  literal: true;
  rewrite(from: Pattern, to: Pattern): Pattern | undefined;
};

export type PatternRegex = {
  source: string;
  literal: false;
  template: string;
  re: RegExp;
  vars: PatternVar[];
  rerex(partial: unknown[]): RegExp;
  repattern(partial: (string | undefined | null)[]): Pattern;
  rewrite(from: Pattern, to: Pattern): Pattern | undefined;
};

export function isPatternLiteral(pattern: Pattern): pattern is PatternLiteral {
  return pattern.literal;
}

export function isPatternRegex(pattern: Pattern): pattern is PatternRegex {
  return !pattern.literal;
}

export type PatternMaker = (_: {
  hint: string | undefined;
  spec: string;
  prefix: string;
  suffix: string;
}) => RegExp | string;

export type PatternVar = {
  param: string;
  hint?: string;
  expression?: string;
  re?: RegExp;
  source?: string;
};

// patterns look, in general, like {{<flags> x.y = ...expression... % /regex/ }}
// where flags can be any pattern of these characters: "?!@#:*~/-",
// the "% /regex/" and "= ...expression..." parts are optional.
// and the variable name can be dashed or dotted or have a dollarsigns,
// but must start with letters, dollarsign or underscore.
const paramPattern =
  /^([.?!@#:~*/+-]+)?((?:[a-z$_][a-z0-9_$-]*)(?:[.][@a-z$_][a-z0-9_$]*)*)?\s*(?:=\s*((?:[^%]|%\s*[^/\s])*)?)?(?:%\s*([/].*))?$/i;

const literal = /(?:[^{]|[{][^{])+/;
const squote = /['](?:(?:[^'\\]|[\\].)*)[']/;
const dquote = /["](?:(?:[^"\\]|[\\].)*)["]/;

function parseRex(rex?: string) {
  if (!rex) return;

  const [, re, flags] = /^[/](.*)[/]([imsg]*)$/.exec(rex.trim())!;

  if (flags) {
    throw new Error("pattern regex flags are unsupported");
  }

  return new RegExp(re, flags);
}

const exprMatcher = re`[$][$]expr[(](${dquote})[)]`;

export function parseVariable(source: string) {
  const match = paramPattern.exec(source.trim());

  if (!match) {
    return null;
  }

  let [, hint, param, expression, rex] = match;
  const exprMatch = expression && exprMatcher.exec(expression); // $$expr("...") encodes source with possible }}
  if (exprMatch) {
    expression = JSON.parse(exprMatch[1]);
  }

  return {
    param: param || "",
    variable: {
      source,
      expression,
      hint,
      re: parseRex(rex),
    } as PatternVar,
  };
}

export function depatternize(template: string, pattern: Pattern) {
  if (!isPatternRegex(pattern)) {
    return template;
  }

  return patternRender(
    { ...pattern, template },
    pattern.vars.map(({ source }) => `{{${source}}}`),
  );
}

export type PatternBuilding = {
  re: PatternMaker;
};

const defaultBuilding: PatternBuilding = {
  re: () => ".*",
};

export function patternize(
  source: string,
  building: PatternBuilding = defaultBuilding,
): PatternRegex {
  const vars: PatternRegex["vars"] = [];
  const hints: (string | undefined)[] = [];

  const template = replace(source, {
    lit: (s) => s,
    pattern: ({ index, spec }) => {
      const match = parseVariable(spec);

      if (!match) {
        console.error(`weird pattern in ${source}`);

        throw new Error("weird pattern");
      }

      const { param, variable } = match;

      vars.push({ ...variable, param });
      hints.push(variable.hint);

      return `@@~~${index}~~@@`;
    },
  });

  const patterns: string[] = [];

  function build(index: number, ...args: Parameters<PatternMaker>) {
    const pattern = vars[index].re ?? building.re(...args);
    const rex = typeof pattern === "string" ? pattern : pattern.source;
    patterns.push(rex);

    return rex;
  }

  let i = 0;
  const re = new RegExp(
    `^(?:${replace(source, {
      lit: litre,
      pattern: ({ index, matchlen, spec }) =>
        `(${build(i++, {
          hint: hints.shift(),
          spec,
          prefix: source.slice(0, index),
          suffix: source.slice(index + matchlen),
        })})`,
    })})$`,
    "m",
  );

  return {
    source: String(source),
    literal: false,
    re,
    template,
    vars,
    repattern(partial) {
      const template = patternRender(
        this,
        vars.map(({ source }, i) => partial[i] ?? `{{${source}}}`),
      );

      return patternize(template, building);
    },
    rerex(values: unknown[]) {
      if (values.every((value) => value === undefined)) {
        return re;
      }

      return new RegExp(
        `^(?:${replace(source, {
          lit: litre,
          pattern: ({ index }) => {
            const value = values[index - 1];
            const pattern = patterns[index - 1];

            if (value !== undefined) {
              if (!new RegExp(`^(?:${pattern})$`).test(String(value))) {
                return `($never)`;
              }

              return `(${litre(String(value))})`;
            }
            return `(${pattern})`;
          },
        })})$`,
        "m",
      );
    },

    // two cases: matched and parallel construction
    // this : "/aa/b/cc", from: "/{{a}}/b/{{c}}", to "/{{c}}/q/{{a}}" -> "/cc/q/aa"
    // this : "/{{v}}/b/{{x}}", from: "/{{a}}/b/{{c}}", to "/{{c}}/q/{{a}}" -> "/{{x}}/q/{{v}}"
    rewrite(from: Pattern, to: Pattern) {
      if (!isPatternRegex(from) || !isPatternRegex(to)) {
        throw new Error("rewrite from / to not regexes");
      }

      let unnamedFrom = 0;
      let unnamedTo = 0;
      const fromParamsList = from.vars.map(
        ({ param }) => param ?? `[${unnamedFrom++}]`,
      );
      const fromParamsMap = arrayIntoObject(fromParamsList, (name, idx) => ({
        [name]: idx,
      }));
      const toParamsList = to.vars.map(
        ({ param }) => param ?? `[${unnamedTo++}]`,
      );

      const toParamsNames = new Set(toParamsList);

      // return undefined for non-matching from/to pairs.
      if (
        from.vars.length !== to.vars.length ||
        ![...fromParamsList].every((param) => toParamsNames.has(param))
      ) {
        return undefined;
      }

      if (this.vars.length) {
        if (to.re.source !== re.source) {
          return undefined;
        }

        return patternize(
          patternRender(
            to,
            toParamsList.map(
              (param) => `{{${vars[fromParamsMap[param]].source}}}`,
            ),
          ),
          building,
        );
      }

      const values = patternValues(from, patternRender(this, []));
      if (!values) {
        return undefined;
      }

      return patternize(
        patternRender(
          to,
          toParamsList.map((name, idx) => {
            const fromIdx = fromParamsMap[name];
            if (fromIdx === undefined) {
              return `{{${to.vars[idx].source}}}`;
            }

            const value = values[fromIdx];
            return value.includes("{{")
              ? `{{${JSON.stringify(value)}}}`
              : value;
          }),
        ),
        building,
      );
    },
  };
}

export function patternRender(
  pattern: PatternRegex | PatternLiteral,
  input: string[],
) {
  if (isPatternLiteral(pattern)) {
    return pattern.source;
  }

  const { template } = pattern;

  return template.replace(/@@~~(\d+)~~@@/g, (_, index) => {
    return input[Number(index) - 1] ?? "";
  });
}

export function isPatternExpressive(pattern: Pattern) {
  return (
    isPatternRegex(pattern) && pattern.vars.some(({ expression }) => expression)
  );
}

export function arePatternsCompatible(a: Pattern, b: Pattern) {
  if (isPatternTrivial(a)) {
    return matchToPattern(b, patternRender(a, []));
  }
  if (isPatternTrivial(b)) {
    return matchToPattern(a, patternRender(b, []));
  }

  const aps = patternEnds(a);
  const bps = patternEnds(b);

  return (
    (aps.start.startsWith(bps.start) || bps.start.startsWith(aps.start)) &&
    (aps.end.endsWith(bps.end) || bps.end.endsWith(aps.end))
  );
}

function patternEnds(pattern: Pattern) {
  if (isPatternLiteral(pattern)) {
    return { start: pattern.source, end: pattern.source };
  }

  const { template } = pattern;

  const start = template.replace(/@@~~(\d+)~~@@.*$/g, "");
  const end = template.replace(/^.*@@~~(\d+)~~@@/g, "");

  return { start, end };
}

export function patternValues(
  pattern: Pattern,
  proto: string,
  partial?: unknown[],
) {
  if (isPatternLiteral(pattern)) {
    return proto === pattern.source ? [] : undefined;
  }

  const { re, rerex } = pattern;
  const match = (partial ? rerex(partial) : re).exec(proto);

  if (!match) {
    return;
  }

  const [, ...values] = match;
  return values;
}

export function patternsMatch(a: Pattern, b: Pattern) {
  if (isPatternLiteral(a) && isPatternLiteral(b)) {
    return a.source === b.source;
  }

  if (isPatternRegex(a) && isPatternRegex(b)) {
    return a.re.source === b.re.source && a.source === b.source;
  }

  if (isPatternTrivial(a) && isPatternTrivial(b)) {
    return renderTrivialPattern(a) === renderTrivialPattern(b);
  }
}

export function matchToPattern(
  pattern: Pattern,
  proto: string,
  partial?: unknown[],
) {
  const values = patternValues(pattern, proto, partial);

  if (!values) {
    return;
  }

  if (isPatternLiteral(pattern)) {
    return {};
  }

  const { vars } = pattern;

  return arrayIntoObject(
    values,
    (value, index) =>
      vars[index].param && {
        [vars[index].param]: value,
      },
  );
}

// --- internal helpers ---

type Replacer = {
  lit(literal: string): string;
  pattern(_: {
    spec: string;
    index: number;
    offset: number;
    matchlen: number;
  }): string;
};

function litre(literal: string) {
  return literal.replace(/[[\]()|\\.*^$+&?{]/g, (match) => "\\" + match);
}

// this matches
// - any amount of "not a {", or "{" followed by "not a {" text, to be included literally,
// - "{{...}}" with potentially quoted strings inside, if the entire pattern is a quoted
//   string, treat it as a literal.
const patternmatcher = re.g`(${literal})|[{][{]((?:${squote}|${dquote}|[^"'}]|[}][^"'}])*)[}][}]`;
const squotematcher = re`^\s*${squote}\s*$`;
const dquotematcher = re`^\s*${dquote}\s*$`;

function replace(text: string, replacer: Replacer) {
  let index = 0;

  return String(text ?? "").replace(
    patternmatcher,
    (match, literal, spec, offset: number) => {
      if (squotematcher.test(spec)) {
        literal = new Function(`return ${spec}`)(); // JSON.parse doesn't handle single-quotes
        spec = null;
      } else if (dquotematcher.test(spec)) {
        literal = JSON.parse(spec);
        spec = null;
      }

      return literal != null
        ? replacer.lit(literal)
        : replacer.pattern({
            spec,
            index: ++index,
            offset,
            matchlen: match.length,
          });
    },
  );
}

const simplePattern = patternize("{{simple}}", {
  re: () => ".*",
});

export function isPatternSimple(
  pattern: Pattern,
): pattern is PatternRegex & { vars: [PatternRegex["vars"][number]] } {
  return isPatternRegex(pattern) && pattern.template === simplePattern.template;
}

export function patternLiteral(literal: string): PatternLiteral {
  return {
    literal: true,
    source: String(literal),
    rewrite(from, to) {
      if (!isPatternRegex(from) || !isPatternRegex(to)) {
        throw new Error("rewrite from / to not regexes");
      }

      const values = patternValues(from, patternRender(this, []));
      if (!values) {
        return undefined;
      }

      return to.repattern(values);
    },
  };
}

export function isPatternTrivial(
  pattern: Pattern,
): pattern is PatternLiteral | (PatternRegex & { vars: [] }) {
  return isPatternLiteral(pattern) || pattern.vars.length == 0;
}

export function renderTrivialPattern(pattern: Pattern) {
  return isPatternLiteral(pattern)
    ? pattern.source
    : pattern.vars.length == 0
      ? patternRender(pattern, [])
      : undefined;
}
