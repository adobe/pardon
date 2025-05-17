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

import { mapObject } from "../../util/mapping.js";
import { JSON } from "../raw-json.js";
import { isValidNumberToken } from "../schema/definition/scalar.js";

/**
KV format is key=value where value can be in lenient JSON
(quoting strings is optional... only need to quote strings for
true, false, null, "", strings that look like numbers or
contain non identifier characters (a-z0-9$_)).

`=` can (and should) be used in place of `:` in objects.

As an extension, javascript expressions can either be parenthesized
or follow := assignments at the top level.
*/

// a kv token is:
//  whitespace
//  a single-quoted string
//  a double-quoted string
//  a backtick-quoted string. (without ${...} interpolations)
//  syntax characters, any of these: {}[]():,=
//  a word token, which can contain letters, digits, underscores, $, @, +, - (as a minus or hyphen), and can contain :
//  comment (starting with # till end of line)
//
// text following := or starting with "(" is retokenized as a javascript expression.
// only (), {}, [], and `` nesting is assured, and that the sequence does not
// end with something that can continue an expression.
const tokenizer =
  /(\s+|'(?:[^'\n\\]|\\[^\n])*'|"(?:[^"\n\\]|\\[^\n])*"|`(?:[^`\\$]|\\.|[$](?=[^{]))*`|[{}[\](),]|[a-z0-9~!@#$%^&|*_./:=?+-]+)|(?:#.*$)/im;
const kevsplitter = /^((?!['"])[^:=]+)(:=|:(?!=)|=)(.*)$/im;
const evsplitter = /^(:=|:(?!=)|=)(.*)$/im;

type ExpressionParseState = {
  stack: string[];
  token: string;
  strict: boolean;
};

function makeExpressionParseState(strict: boolean): ExpressionParseState {
  return { stack: [], token: "", strict: strict };
}

const EXPR_ONGOING = false;
const EXPR_END = true;

// understands just enough javascript to keep syntax together.
function addToExpression(
  tokens: string[],
  tokensAt: number,
  state: ExpressionParseState,
  followingToken?: string | null,
): typeof EXPR_ONGOING | typeof EXPR_END | (string & {}) {
  const { stack } = state;

  const token = tokens[tokensAt++];
  state.token += token;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    const top = stack[stack.length - 1] ?? ".";

    switch (top) {
      case ".":
      case "(":
      case "[":
      case "{": {
        const expected = ")]}".indexOf(c);

        if (expected !== -1) {
          if (top === "([{"[expected]) {
            stack.pop();
          } else {
            return `expected ${c}`;
          }
        }
        if ("([{'\"`".includes(c)) stack.push(c);
        break;
      }
      case "'":
        if (c === "\\") i++;
        else if (c === "'") stack.pop();
        break;
      case '"':
        if (c === "\\") i++;
        else if (c === '"') stack.pop();
        break;
      case "`":
        if (c === "\\") i++;
        else if (c === "$" && token[i + 1] === "{") {
          stack.push("{");
          i++;
        } else if (c === "`") stack.pop();
        break;
    }
  }

  while (tokensAt < tokens.length && !tokens[tokensAt]?.trim()) {
    tokensAt++;
  }

  if (stack.length === 0) {
    if (state.strict) {
      return EXPR_END;
    }

    const nextToken = tokens[tokensAt] ?? "";
    const lookahead = `${state.token.trim().slice(-1)[0] ?? " "}${nextToken[0]?.trim() || followingToken?.trim() || " "}`;

    // check for possible continuations of expressions here, using the
    // last character of the previous token and the first of the next.
    if (!/^(?:[-+*/.!?^|&<>=%:]|.[-+*/.!?^|&<>=%:`([])/.test(lookahead)) {
      return EXPR_END;
    }
  }

  return EXPR_ONGOING;
}

type TokenizationState = {
  retokenized: string[];
  ctx: string[];
  expression?: ExpressionParseState;
  exit?: boolean;
};

function tokenize(data: string, options?: { allowExpressions?: boolean }) {
  // returns strings that alternate between values that match the tokenizer and the
  // values in between (which should be empty strings until the end of the kv data).
  //
  // we use a two-pass tokenization to allow values with `=` and `:` in them.
  // first pass tokenizes without splitting on `=` and `:`, second pass splits them
  // unless the preceeding token was an `=` or `:`, in which case we don't (as we're in a value).

  return data.split(tokenizer).reduce<TokenizationState>(
    (state, tokenOrSplit, index, tokens) => {
      // if we're in expression state, keep it going...
      if (state.expression) {
        const result = addToExpression(tokens, index, state.expression);

        // we can keep going.
        if (result === EXPR_ONGOING) {
          return state;
        }

        // if the result is not false, we've hit the end, either successfully completing
        // the expression or failing to.
        const { token } = state.expression;
        state.expression = undefined;

        if (result === EXPR_END) {
          state.retokenized[state.retokenized.length - 1] = token;

          return state;
        }

        // on parse failure, move whole expression token to unmatched location.
        state.retokenized[state.retokenized.length - 2] += token;
        state.retokenized[state.retokenized.length - 1] = "";

        return state;
      }

      if (!(index & 1) || state.exit) {
        state.retokenized.push(tokenOrSplit);
        state.exit ||= Boolean(tokenOrSplit);
        return state;
      }

      if (options?.allowExpressions) {
        const reindex = state.retokenized.length - 2;
        const prevNonBlankTokenIndex = previousNonBlankIndex(
          state.retokenized,
          reindex - 2,
        );
        const prevNonBlankToken = previousNonBlankToken(
          state.retokenized,
          reindex,
        );

        if (
          prevNonBlankToken == ":=" &&
          !inValue(tokens, prevNonBlankTokenIndex)
        ) {
          const retokenizedColonEq = previousNonBlankToken(
            state.retokenized,
            state.retokenized.length - 2,
          );

          if (retokenizedColonEq === ":=") {
            const expression = makeExpressionParseState(false);
            if (addToExpression(tokens, index, expression) === true) {
              state.retokenized.push(expression.token);
              return state;
            } else {
              state.retokenized.push(tokens[index]);
              return { ...state, expression };
            }
          }
        }

        if (
          tokens[index] === "(" &&
          !inValue(state.retokenized, previousNonBlankIndex(tokens, index))
        ) {
          const expression = makeExpressionParseState(true);
          if (addToExpression(tokens, index, expression) === true) {
            state.retokenized.push(expression.token);
            return state;
          } else {
            state.retokenized.push("");
            return { ...state, expression };
          }
        }
      }

      if (
        !inValue(state.retokenized) &&
        state.ctx[state.ctx.length - 1] != "["
      ) {
        const ke = kevsplitter.exec(tokenOrSplit);
        if (ke) {
          const [, key, eq, value] = ke;
          state.retokenized.push(key, "", eq, "", value);

          if (options?.allowExpressions && eq === ":=" && value.trim()) {
            return startRetokenizedExpression(tokens, index, state);
          }

          return state;
        }

        const ev = evsplitter.exec(tokenOrSplit);
        if (ev) {
          const [, eq, value] = ev;
          state.retokenized.push(eq, "", value);
          if (options?.allowExpressions && eq === ":=" && value.trim()) {
            return startRetokenizedExpression(tokens, index, state);
          }
          return state;
        }
      }

      state.retokenized.push(tokenOrSplit);
      switch (tokenOrSplit) {
        case "[":
        case "{":
          state.ctx.push(tokenOrSplit);
          break;
        case "]":
        case "}":
          state.ctx.pop();
          break;
      }

      return state;
    },
    { retokenized: [], ctx: [] },
  ).retokenized;
}

function startRetokenizedExpression(
  tokens: string[],
  index: number,
  state: TokenizationState,
) {
  const expression = makeExpressionParseState(false);
  const expressionResult = addToExpression(
    state.retokenized,
    state.retokenized.length - 1,
    expression,
    nextNonBlankToken(tokens, index),
  );
  if (expressionResult === true) {
    state.retokenized[state.retokenized.length - 1] = expression.token;
    return state;
  } else {
    state.retokenized[state.retokenized.length - 1] = "";
    return { ...state, expression };
  }
}

// simple token should allow somewhat complex values like e.g., email addresses and paths without quotes
const simpleToken = /^[a-z0-9~!@#$%^&|*_./:=?+-]+$/i;
const simpleKey = /^[a-z0-9$@_.+-]*$/i;

const unparsed = Symbol("unparsed");
const eoi = Symbol("eoi");

export type ParseMode = "object" | "stream" | "value";

export type KeyValueStringifyOptions = {
  indent?: number;
  mode?: "kv" | "json";
  compact?: boolean;
  limit?: number;
  trailer?: string;
  split?: boolean;
  value?: boolean;
  quote?: "single" | "double" | "auto";
};

const ExpressionTag = Symbol("kv-expr");
export type ExpressionValue = (() => string) & { [ExpressionTag]: true };

function makeExprValue(token: string): ExpressionValue {
  return Object.assign(() => token, { [ExpressionTag]: true as const });
}

function loadExprValue(expr: ExpressionValue) {
  return expr();
}

function isExprValue(expr: any): expr is ExpressionValue {
  return typeof expr === "function" && expr[ExpressionTag];
}

export const KV: {
  parse(data: string, mode: "value"): unknown;
  parse(data: string, mode: "object"): Record<string, unknown>;
  parse(
    data: string,
    mode: "stream",
    options?: { allowExpressions?: boolean },
  ): Record<string, unknown> & {
    [unparsed]?: string;
  };
  parse(data: string): unknown;
  stringify(data: unknown, options?: KeyValueStringifyOptions): string;
  stringifyKey(key: string, options?: KeyValueStringifyOptions): string;
  isSimpleKey(key: string): boolean;
  tokenize(
    data: string,
  ): { token: string; key?: string; value?: unknown; span?: number }[];
  isExprValue(value: any): value is ExpressionValue;
  loadExprValue(value: ExpressionValue): string;
  makeExprValue(value: string): ExpressionValue;
  unparsed: typeof unparsed;
} = {
  parse(
    data: string,
    parseMode?: ParseMode,
    { allowExpressions }: { allowExpressions?: boolean } = {},
  ): any {
    const result: Record<string, unknown> & {
      [unparsed]?: string;
    } = {};

    if (parseMode === "value") {
      data = "value=" + data;
    }

    const tokens = tokenize(data ?? "", { allowExpressions });
    const stack: { (token: string): void }[] = [];
    let parsed = 0;

    function decode(token: string) {
      switch (true) {
        case /^".*"$/.test(token):
        case isValidNumberToken(token):
          return JSON.parse(token);
        case /^'.*'$/.test(token):
          return JSON.parse(
            `"${token.slice(1, -1).replace(/\\.|\\'|"|\\/g, (match) => ({ [`\\'`]: `'`, [`"`]: `\\"` })[match] ?? match)}"`,
          );
        case /^`.*`$/s.test(token):
          return JSON.parse(
            `"${token.slice(1, -1).replace(/\\.|\\'|"|\n/g, (match) => ({ [`\\'`]: `'`, [`"`]: `\\"`, ["\n"]: "\\n" })[match] ?? match)}"`,
          );
        case allowExpressions && /^[(].*[)]$/.test(token):
          return makeExprValue(token);
        default:
          if (token === "null") {
            return null;
          }

          return (
            {
              true: true,
              false: false,
            }[token] ?? token
          );
      }
    }

    const expect =
      (expected: string | RegExp, next: (token: string) => void) =>
      (token: string) => {
        if (
          typeof expected === "string"
            ? expected === token
            : expected.exec(token)?.[0] === token
        ) {
          return next(token);
        }
        throw new Error(`expected ${expected}, got ${token}`);
      };

    const object =
      (obj: Record<string, unknown>, consumer: (obj: unknown) => void) =>
      (token: string) => {
        switch (true) {
          case "}" === token:
            return consumer(obj);
          case /^[:={[\],]/.test(token):
            throw new Error(`unexpected token in object: ${token}`);
          default:
            stack.push(
              (token) => {
                switch (true) {
                  case "," == token:
                    return stack.push(object(obj, consumer));
                  default:
                    return object(obj, consumer)(token);
                }
              },
              expect(/[:=]/, () => {
                stack.push(
                  value((field: unknown) => {
                    obj[decode(token)] = field;
                  }),
                );
              }),
            );
        }
      };

    const array =
      (list: unknown[], consumer: (list: unknown[]) => void) =>
      (token: string) => {
        switch (true) {
          case "]" === token:
            return consumer(list);
          case "," === token:
            list.push(undefined);
            return stack.push(array(list, consumer));
          default:
            stack.push((token) => {
              switch (true) {
                case "," === token:
                  return stack.push(array(list, consumer));
                default:
                  return array(list, consumer)(token);
              }
            });

            value((element: unknown) => {
              list.push(element);
            })(token);
        }
      };

    const value =
      (consumer: (token: unknown | typeof eoi) => void | boolean) =>
      (token: string) => {
        switch (true) {
          case "{" === token:
            return stack.push(object({}, consumer));
          case "[" === token:
            return stack.push(array([], consumer));
          default:
            return consumer(decode(token));
        }
      };

    const expr =
      (consumer: (token: string | typeof eoi) => void | boolean) =>
      (token: string) => {
        switch (true) {
          default:
            return consumer(token);
        }
      };

    const key = (token: string) => {
      switch (true) {
        case !simpleKey.test(token) && !/^['"]/.test(token):
          throw new Error(`unexpected ${token}: expected key for key=value`);
        default:
          stack.push(
            expect(/=|:=/, (assignment) =>
              stack.push(
                assignment === "="
                  ? value((value: unknown) => {
                      if (value === eoi) {
                        return;
                      }

                      //token = token.replace(/^@/, "");
                      result[decode(token)] = value;
                      stack.push(key);
                    })
                  : expr((value) => {
                      if (value === eoi) {
                        return;
                      }

                      result[decode(token)] = makeExprValue(value);
                      stack.push(key);
                    }),
              ),
            ),
          );
      }
    };

    if (
      (!parseMode && nextNonBlankToken(tokens, 1) !== "=") ||
      (parseMode === "stream" && data.trim().startsWith("{"))
    ) {
      let result: unknown = undefined;
      stack.push(
        value((value: unknown) => {
          result = value;
        }),
      );

      for (let i = 0; i < tokens.length - 1; i += 2) {
        if (
          parseMode === "stream" &&
          result &&
          typeof result === "object" &&
          stack.length === 0
        ) {
          result[unparsed] = tokens.slice(i).join("");
          return result;
        }

        if (tokens[i] !== "") {
          throw new Error(`unexpected ${tokens[i]} in k=v format`);
        }

        const token = tokens[i + 1];
        if (token?.trim()) {
          stack.pop()!(token);
        }
      }

      if (stack.length !== 0) {
        throw new Error(`incomplete/wrong k=v value structure`);
      }

      return result;
    }

    if (parseMode && !data.trim()) {
      if (parseMode === "value") {
        return null;
      }

      return {};
    }

    let i = 0;

    stack.push(key);

    for (; i < tokens.length; i += 2) {
      if (tokens[i] !== "") {
        if (parseMode === "stream") {
          if (stack.length !== 1 || !stack.pop()![eoi]?.()) {
            // result[upto] = tokens.slice(parsed).join("").length;
          }

          if (tokens[i] === "*") {
            i++;
          }

          result[unparsed] = tokens.slice(i).join("");
          return result;
        }

        throw new Error(`unexpected ${tokens[i]} in k=v format`);
      }

      const token = tokens[i + 1];

      if (stack.length === 1 && stack[0] === key) {
        parsed = i + 1;
      }

      if (!token?.trim()) {
        if (
          parseMode === "stream" &&
          token?.includes("\n") &&
          stack.length === 1 &&
          stack[0] !== key &&
          stack[0][eoi]
        ) {
          result[unparsed] = tokens.slice(i).join("");
          return result;
        }
        continue;
      }

      if (parseMode === "stream") {
        if (
          stack.length === 1 &&
          stack[0] === key &&
          !/^(?:=|:=)$/.test(nextNonBlankToken(tokens, i + 1)!)
        ) {
          if (tokens[i + 1] === "*") {
            i += 2;
          }

          result[unparsed] = tokens.slice(i).join("");
          return result;
        }
      }

      stack.pop()!(token);
    }

    if (stack.length !== 1 || stack[0] !== key) {
      if (parseMode !== "stream" && parseMode !== "value") {
        throw new Error("failed to parse entire text as kv format");
      }

      if (tokens[parsed] === "*") {
        parsed++;
      }

      result[unparsed] = tokens.slice(parsed).join("");
      return;
    }

    if (parseMode === "value") {
      return result.value;
    }

    return result;
  },

  stringify(values: unknown, options?: KeyValueStringifyOptions) {
    const text = wrappedStringify(
      values,
      options?.mode === "json"
        ? (options?.compact === undefined ? options?.indent : !options?.compact)
          ? JSONEncoding
          : JSONEncodingCompact
        : (options?.compact === undefined ? options?.indent : !options?.compact)
          ? KeyValueEncoding
          : KeyValueEncodingCompact,
      {
        indent: options?.indent ?? 0,
        limit: options?.limit ?? 0,
        quote: options?.quote,
      },
      {
        split: options?.split ?? false,
        unwrap: !options?.value && options?.mode !== "json",
      },
    );

    if (text.length) {
      return `${text}${options?.trailer ?? ""}`;
    }

    return "";
  },

  stringifyKey,

  tokenize(data: string) {
    const tokens = tokenize(data)
      .filter((_, i) => i & 1)
      .reduce<string[]>((tokens, token) => {
        switch (true) {
          case /^\s*$/.test(token):
          case token === ",":
          case token === "[":
          case token === "]":
          case token === "{":
          case token === "}":
            tokens.push(token);
            break;
          case inValue(tokens) &&
            ![":", "=", ":="].includes(tokens[tokens.length - 2]):
            tokens[tokens.length - 2] += token;
            break;
          default:
            tokens.push(token);
            break;
        }

        return tokens;
      }, [])
      .map<{ token: string; key?: string; value?: unknown; span?: number }>(
        (token) => {
          switch (token) {
            case "[":
            case "]":
            case "{":
            case "}":
            case ",":
            case "=":
            case ":":
              return { token };
          }

          if (!token.trim()) {
            return { token };
          }

          return { token, value: KV.parse(token, "value") };
        },
      );

    const stack: { type: "=" | "[" | "{"; at: number }[] = [];

    const filteredIndexed = tokens
      .map((t, oi) => ({ ...t, oi }))
      .filter(({ token }) => token.trim());

    filteredIndexed.forEach(({ token }, idx) => {
      switch (token) {
        case "=":
        case ":":
          stack.unshift({ type: "=", at: filteredIndexed[idx - 1].oi });
          break;
        case ",":
          break;
        case "[":
        case "{":
          stack.unshift({ type: token, at: filteredIndexed[idx].oi });
          break;
        case "]":
        case "}":
        default:
          for (;;) {
            const top = stack[0];
            if (!top) {
              break;
            }
            if (top.type === "[" && token !== "]") {
              break;
            }
            if (top.type === "{" && token !== "}") {
              break;
            }
            tokens[top.at].span = filteredIndexed[idx].oi - top.at;
            stack.shift();
            if (top.type === "=") {
              tokens[top.at].key = String(tokens[top.at].value);

              const value = tokens
                .slice(top.at + 2, filteredIndexed[idx].oi + 1)
                .map(({ token }) => token)
                .join("");

              tokens[top.at].value = KV.parse(value, "value");

              break;
            } else {
              if (token === "]" || token === "}") {
                tokens[top.at].value = KV.parse(
                  tokens
                    .slice(top.at, filteredIndexed[idx].oi + 1)
                    .map(({ token }) => token)
                    .join(""),
                );
              }
              token = "*";
            }
          }
          break;
      }
    });

    return tokens;
  },

  isSimpleKey(key: string) {
    return key ? simpleKey.test(key) : false;
  },

  isExprValue,
  loadExprValue,
  makeExprValue,

  unparsed,
};

type Preformatted =
  | string
  | string[]
  | { [_: string]: Preformatted }
  | undefined;

function isJsonUnit(
  v: unknown,
  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
): v is null | number | bigint | Number | string {
  return (
    v === null ||
    typeof v !== "object" ||
    v instanceof Number ||
    typeof (v as any)?.toJSON === "function"
  );
}

type KeyValueEncodingRules = {
  key(key: string, options: KeyValueStringifyOptions | undefined): string;
  value(
    value: unknown,
    options: KeyValueStringifyOptions | undefined,
  ): string | undefined;
  objects: {
    wrapped: { entrysep: string };
    inline: {
      start: string;
      end: string;
      entrysep: string;
    };
    empty: string;
    fieldsep: string;
  };
  arrays: {
    inline: { start: string; end: string };
    itemsep: string;
    empty: string;
  };
};

function toRawJson(value: any): JSON.RawJSON | undefined {
  if (typeof value?.toJSON === "function") {
    value = value.toJSON();
  }

  if (typeof value === "bigint") {
    return JSON.rawJSON(String(value));
  }

  if (typeof value === "function") {
    return undefined;
  }

  return JSON.isRawJSON(value) ? value : JSON.rawJSON(JSON.stringify(value));
}

const KeyValueEncoding: KeyValueEncodingRules = {
  key: stringifyKey,
  value: (value, options?: KeyValueStringifyOptions) =>
    dequoteJson(
      JSON.stringify(value, (_, value) => toRawJson(value)),
      true,
      options,
    ),
  arrays: {
    inline: { start: "[ ", end: " ]" },
    itemsep: " ",
    empty: "[]",
  },
  objects: {
    inline: {
      start: "{ ",
      end: " }",
      entrysep: " ",
    },
    wrapped: {
      entrysep: "",
    },
    fieldsep: "=",
    empty: "{}",
  },
};

const KeyValueEncodingCompact: KeyValueEncodingRules = {
  key: stringifyKey,
  value: (value, options?: KeyValueStringifyOptions) =>
    dequoteJson(
      JSON.stringify(value, (_, value) => toRawJson(value)),
      true,
      options,
    ),
  arrays: {
    inline: { start: "[", end: "]" },
    itemsep: ",",
    empty: "[]",
  },
  objects: {
    inline: {
      start: "{",
      end: "}",
      entrysep: " ",
    },
    wrapped: {
      entrysep: "",
    },
    fieldsep: "=",
    empty: "{}",
  },
};

const JSONEncoding: KeyValueEncodingRules = {
  key: (key) => JSON.stringify(key),
  value: (value) => toRawJson(value)?.rawJSON,
  arrays: {
    inline: { start: "[", end: "]" },
    itemsep: ", ",
    empty: "[]",
  },
  objects: {
    inline: {
      start: "{ ",
      end: " }",
      entrysep: ", ",
    },
    wrapped: {
      entrysep: ",",
    },
    fieldsep: ": ",
    empty: "{}",
  },
};

const JSONEncodingCompact: KeyValueEncodingRules = {
  key: (key) => JSON.stringify(key),
  value: (value) => toRawJson(value)?.rawJSON,
  arrays: {
    inline: { start: "[", end: "]" },
    itemsep: ",",
    empty: "[]",
  },
  objects: {
    inline: {
      start: "{",
      end: "}",
      entrysep: ",",
    },
    wrapped: {
      entrysep: ",",
    },
    fieldsep: ":",
    empty: "{}",
  },
};

function wrappedStringify(
  v: unknown,
  encoding: KeyValueEncodingRules,
  options: KeyValueStringifyOptions,
  toplevel?: { split?: boolean; unwrap: boolean },
) {
  const { indent = 0, limit = 0 } = options ?? {};

  return doFormat(
    preformat(v, options),
    { nobreak: toplevel?.unwrap },
    toplevel,
  ).text;

  function needsWrap(
    value: Preformatted,
    dent: number,
    toplevel?: { split?: boolean; unwrap?: boolean },
  ) {
    const length = inlineLength(value, dent, toplevel);
    return length > limit;
  }

  function inlineLength(
    value: Preformatted,
    dent: number,
    toplevel?: { split?: boolean; unwrap?: boolean },
  ): number {
    switch (true) {
      case typeof value === "string":
        return dent + value.length;
      case Array.isArray(value): {
        dent += encoding.arrays.inline.start.length; // "[ "
        for (const item of value) {
          dent = inlineLength(item, dent) + encoding.arrays.itemsep.length; // "{item}, "
          if (dent > limit) {
            return dent;
          }
        }

        dent += encoding.arrays.inline.end.length; // " ]"
        return dent;
      }
      default: {
        dent += toplevel?.unwrap ? 0 : encoding.objects.inline.start.length; // "{ "
        for (const [key, field] of Object.entries(
          value as Record<string, Preformatted>,
        )) {
          if (typeof field === "string") {
            dent +=
              key.length +
              encoding.objects.fieldsep.length +
              field.length +
              encoding.objects.inline.entrysep.length; // `"key": {value},`
          } else {
            dent += key.length + encoding.objects.fieldsep.length; // `"key": `
            dent = inlineLength(field, dent); // {value}
            dent += encoding.objects.inline.entrysep.length; // `, `
          }

          if (dent > limit) {
            return dent;
          }
        }

        dent += toplevel?.unwrap ? 0 : encoding.objects.inline.end.length; // " }"
        return dent;
      }
    }
  }

  function preformat(
    value: unknown,
    options: KeyValueStringifyOptions | undefined,
  ) {
    switch (true) {
      case typeof value !== "object" || isJsonUnit(value):
        return encoding.value(value, options);
      case Array.isArray(value):
        if (value.length === 0) {
          return encoding.arrays.empty;
        }
        return value.map((item) => preformat(item, options));
      default:
        if (!toplevel?.unwrap && Object.keys(value).length === 0) {
          return encoding.objects.empty;
        }

        return mapObject(value as Record<string, unknown>, {
          select(value) {
            return value !== undefined;
          },
          values(value) {
            return preformat(value, options);
          },
          keys(key) {
            return encoding.key(key, options);
          },
        });
    }
  }

  function doFormat(
    value: Preformatted,
    {
      dent: dent = 0,
      depth = 0,
      nobreak,
    }: {
      dent?: number;
      depth?: number;
      nobreak?: boolean;
    },
    toplevel?: { split?: boolean; unwrap?: boolean },
  ): { text: string; dent: number } {
    switch (true) {
      case typeof value === "string": {
        return { text: value, dent: dent + value.length };
      }
      case Array.isArray(value): {
        if (
          indent &&
          (limit == 0
            ? value.some((item) => !isJsonUnit(item))
            : needsWrap(value, dent, toplevel))
        ) {
          dent = depth + indent;

          let separator = "";
          let nextseparator = "";

          const text = value
            .map((item, index, list) => {
              separator = nextseparator;

              if (
                needsWrap(
                  item,
                  dent +
                    separator.length +
                    (index < list.length - 1 ? separator.trimEnd().length : 0),
                  toplevel,
                )
              ) {
                const { text, dent: next } = doFormat(item, {
                  dent: depth + indent,
                  depth: depth + indent,
                });

                dent = next;

                if (text.includes("\n")) {
                  // line wrap after split {...} objects
                  dent = Infinity;
                }

                if (index === 0) {
                  nextseparator = encoding.arrays.itemsep;
                  return text;
                }

                nextseparator = encoding.arrays.itemsep;
                return `${separator.trimEnd()}\n${" ".repeat(depth + indent)}${text}`;
              }

              const { text, dent: next } = doFormat(item, {
                dent: dent + separator.length,
                depth: depth + indent,
              });

              nextseparator = encoding.arrays.itemsep;

              if (next > limit) {
                dent = depth + indent;
                return `${separator.trimEnd()}\n${" ".repeat(depth + indent)}${text}`;
              } else if (next <= limit) {
                dent = next;
                return `${separator}${text}`;
              }

              dent = depth + indent + text.length;

              return `${separator.trimEnd()}\n${" ".repeat(depth + indent)}${text}`;
            })
            .join("");

          return {
            text: `[\n${" ".repeat(depth + indent)}${text}\n${" ".repeat(depth)}]`,
            dent: depth + 1,
          };
        }

        dent += encoding.arrays.inline.start.length;
        const text = value
          .map((item, index, list) => {
            const { text, dent: next } = doFormat(item, {
              dent:
                dent +
                (index < list.length - 1 ? encoding.arrays.itemsep.length : 0),
              depth: depth + indent,
            });

            dent = next;
            return text;
          })
          .join(encoding.arrays.itemsep);

        return {
          text:
            encoding.arrays.inline.start + text + encoding.arrays.inline.end,
          dent: dent + encoding.arrays.inline.end.length,
        };
      }
      default: {
        const objectindent = toplevel?.unwrap ? 0 : indent;

        if (indent && (toplevel?.split || needsWrap(value, dent, toplevel))) {
          dent = depth;

          const text = Object.entries(value as Record<string, Preformatted>)
            .filter(([, value]) => value !== undefined)
            .map(([key, value], index) => {
              const { text, dent: next } = doFormat(value, {
                dent: depth + key.length + objectindent,
                depth: depth + objectindent,
              });
              dent = next;
              return `${index === 0 && nobreak ? "" : `\n${" ".repeat(depth + objectindent)}`}${key}${encoding.objects.fieldsep}${text}`;
            }, [])
            .join(encoding.objects.wrapped.entrysep);

          return {
            text: toplevel?.unwrap ? text : `{${text}\n${" ".repeat(depth)}}`,
            dent: toplevel?.unwrap ? 0 : depth + 1,
          };
        }

        const text = Object.entries(value as Record<string, Preformatted>)
          .map(([key, value]) => {
            const { text, dent: next } = doFormat(value, {
              dent: dent + key.length + encoding.objects.fieldsep.length,
              depth: toplevel?.unwrap ? depth : depth + objectindent,
            });
            dent = next;
            return `${key}${encoding.objects.fieldsep}${text}`;
          }, [])
          .join(encoding.objects.inline.entrysep);
        return {
          text: toplevel?.unwrap
            ? text
            : encoding.objects.inline.start +
              text +
              encoding.objects.inline.end,
          dent: toplevel?.unwrap
            ? dent
            : dent +
              encoding.objects.inline.start.length +
              encoding.objects.inline.end.length,
        };
      }
    }
  }
}

function inValue(tokens: string[], i = tokens.length) {
  while (tokens[--i] === "") {
    const prev = tokens[--i];

    if (prev?.trim()) {
      if (["=", ":", ":="].includes(tokens[i])) {
        return !inValue(tokens, i);
      }

      return false;
    }
  }

  return false;
}

function nextNonBlankToken(tokens: string[], i: number) {
  while (tokens[++i] === "") {
    const next = tokens[++i];

    if (next?.trim()) {
      return tokens[i];
    }
  }

  return null;
}

function previousNonBlankIndex(tokens: string[], i: number) {
  while (i >= 2 && tokens[--i] === "") {
    const prev = tokens[--i];

    if (prev?.trim()) {
      return i;
    }
  }

  return -1;
}

function previousNonBlankToken(tokens: string[], i: number) {
  return tokens[previousNonBlankIndex(tokens, i)] ?? null;
}

function dequoteJson(
  text: string,
  inValue: boolean,
  options: KeyValueStringifyOptions | undefined,
) {
  if (text === "") {
    return '""';
  }

  if (typeof text !== "string") {
    return text;
  }

  const tokens = tokenize(text);
  const output: string[] = [];

  for (let i = 0; i < tokens.length - 1; i += 2) {
    if (tokens[i] !== "") {
      throw new Error(`unexpected ${tokens[i]} in k=v format`);
    }

    const token = tokens[i + 1];
    if (token.startsWith('"')) {
      output.push(dequoteText(token, inValue, options));
    } else {
      output.push(token);
    }
  }

  return output.join("");
}

function dequoteText(
  token: string,
  inValue: boolean,
  options?: KeyValueStringifyOptions,
) {
  const text = JSON.parse(token);
  switch (true) {
    case text === "null":
    case text === "false":
    case text === "true":
    case text === "":
      return token;
    case (inValue ? simpleToken : simpleKey).test(text):
      return text;
    default:
      return requote(token, options);
  }
}

function stringifyKey(
  key: string,
  options: KeyValueStringifyOptions | undefined,
) {
  return key && simpleKey.test(key)
    ? key
    : requote(JSON.stringify(key), options);
}

function requote(
  quotedValue: string,
  { quote }: KeyValueStringifyOptions = {},
) {
  if (
    quote === "single" ||
    (quote === "auto" &&
      quotedValue.includes('"') &&
      !quotedValue.includes("'"))
  ) {
    const decoded: string = JSON.parse(quotedValue);

    return `'${decoded.replace(/['\\]/g, (match) => (match === "'" ? "\\'" : match === "\\" ? "\\\\" : match))}'`;
  }

  return quotedValue;
}
