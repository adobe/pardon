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

import { JSON } from "../json.js";
import {
  createNumber,
  isScalar,
  isValidNumberToken,
  scalarTypeOf,
} from "../schema/definition/scalar.js";

/**
KV format is key=value where value can be in lenient JSON
(quoting strings is optional... only need to quote strings for
true, false, null, "", strings that look like numbers or
contain non identifier characters (a-z0-9$_)).
*/

// a kv token is:
//  whitespace
//  a single-quoted string
//  a double-quoted string
//  a backtick-quoted string. (with out ${...} interpolations)
//  syntax characters, any of these: {}[]:,=
//  a word token, which can contain letters, digits, underscores, $, @, +, - (as a minus or hyphen), and can contain :
//  comment (starting with # till end of line)
const tokenizer =
  /(\s+|'(?:[^'\n\\]|\\[^\n])*'|"(?:[^"\n\\]|\\[^\n])*"|`(?:[^`\\$]|\\.|[$](?=[^{]))*`|[{}[\],]|[a-z0-9~!@#$%^&|*_./:=?+-]+)|(?:#.*$)/im;
const kesplitter = /^((?!['"])[^:=]+)([:=])(.*)$/im;
const evsplitter = /^([:=])(.*)$/im;

function tokenize(data: string) {
  // returns strings that alternate between values that match the tokenizer and the
  // values in between (which should be empty strings until the end of the kv data).
  //
  // we use a two-pass tokenization to allow values with `=` and `:` in them.
  // first pass tokenizes without splitting on `=` and `:`, second pass splits them
  // unless the preceeding token was an `=` or `:`, in which case we don't (as we're in a value).
  return data
    .split(tokenizer)
    .reduce<string[]>((retokenized, tokenOrSplit, index) => {
      if (!(index & 1)) {
        retokenized.push(tokenOrSplit);
        return retokenized;
      }

      if (!inValue(retokenized)) {
        const ke = kesplitter.exec(tokenOrSplit);
        if (ke) {
          const [, key, eq, value] = ke;
          retokenized.push(key, "", eq, "", value);
          return retokenized;
        }

        const ev = evsplitter.exec(tokenOrSplit);
        if (ev) {
          const [, eq, value] = ev;
          retokenized.push(eq, "", value);
          return retokenized;
        }
      }

      retokenized.push(tokenOrSplit);
      return retokenized;
    }, []);
}

// simple token should allow somewhat complex values like e.g., email addresses and paths without quotes
const simpleToken = /^[a-z0-9~!@#$%^&|*_./:=?+-]+$/i;
const simpleKey = /^[a-z0-9$@_.-]*$/i;

const unparsed = Symbol("unparsed");
const upto = Symbol("upto");
const eoi = Symbol("end-of-input");

export type ParseMode = "object" | "stream";

export const KV: {
  parse(data: string, mode: "object"): Record<string, unknown>;
  parse(
    data: string,
    mode: "stream",
  ): Record<string, unknown> & {
    [unparsed]?: string;
    [eoi]?: string;
    [upto]?: number;
  };
  parse(data: string): unknown;
  stringify(
    data: unknown,
    join?: string,
    indent?: number,
    trailer?: string,
  ): string;
  stringifyKey(key: string): string;
  stringifyValue(v: unknown, limit: number, indent?: number): string;
  isSimpleKey(key: string): boolean;
  tokenize(
    data: string,
  ): { token: string; key?: string; value?: unknown; span?: number }[];
  unparsed: typeof unparsed;
  eoi: typeof eoi;
  upto: typeof upto;
} = {
  parse(data: string, parseMode?: ParseMode): any {
    const result: Record<string, unknown> & {
      [unparsed]?: string;
      [eoi]?: string;
      [upto]?: number;
    } = {};

    const tokens = tokenize(data ?? "");
    const stack: { (token: string): void; [eoi]?(): void | boolean }[] = [];
    let parsed = 0;

    function decode(token: string) {
      switch (true) {
        case /^".*"$/.test(token):
          return JSON.parse(token);
        case /^'.*'$/.test(token):
          return JSON.parse(
            `"${token.slice(1, -1).replace(/\\.|\\'|"|\\/g, (match) => ({ [`\\'`]: `'`, [`"`]: `\\"` })[match] ?? match)}"`,
          );
        case /^`.*`$/s.test(token):
          return JSON.parse(
            `"${token.slice(1, -1).replace(/\\.|\\'|"|\n/g, (match) => ({ [`\\'`]: `'`, [`"`]: `\\"`, ["\n"]: "\\n" })[match] ?? match)}"`,
          );
        case isValidNumberToken(token):
          return createNumber(token);
        case /^[+-]/.test(token):
          throw new Error("invalid numeric: " + token);
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
            : expected.test(token)
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

    const value = (consumer: (token: unknown | typeof eoi) => void | boolean) =>
      Object.assign(
        (token: string) => {
          switch (true) {
            case "{" === token:
              return stack.push(object({}, consumer));
            case "[" === token:
              return stack.push(array([], consumer));
            default:
              return consumer(decode(token));
          }
        },
        {
          [eoi]: () => consumer(eoi),
        },
      );

    const key = Object.assign(
      (token: string) => {
        switch (true) {
          case !simpleKey.test(token) && !/^['"]/.test(token):
            throw new Error(`unexpected ${token}: expected key for key=value`);
          default:
            stack.push(
              expect("=", () =>
                stack.push(
                  value((value: unknown) => {
                    if (value === eoi) {
                      result[eoi] = decode(token);
                      return;
                    }

                    token = token.replace(/^@/, "");
                    result[decode(token)] = value;
                    stack.push(key);
                  }),
                ),
              ),
            );
        }
      },
      {
        [eoi]() {
          return true;
        },
      },
    );

    if (!parseMode && nextNonBlankToken(tokens, 1) !== "=") {
      let result: unknown = undefined;
      stack.push(
        value((value: unknown) => {
          result = value;
        }),
      );

      for (let i = 0; i < tokens.length - 1; i += 2) {
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
      return {};
    }

    stack.push(key);

    for (let i = 0; i < tokens.length; i += 2) {
      if (tokens[i] !== "") {
        if (parseMode === "stream") {
          if (stack.length !== 1 || !stack.pop()![eoi]?.()) {
            result[upto] = tokens.slice(parsed).join("").length;
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
          if (!stack.pop()![eoi]?.()) {
            result[upto] = tokens.slice(parsed).join("").length;
          }

          result[unparsed] = tokens.slice(i).join("");
          return result;
        }
        continue;
      }

      if (parseMode === "stream") {
        if (
          stack.length === 1 &&
          stack[0] === key &&
          nextNonBlankToken(tokens, i + 1) !== "="
        ) {
          result[unparsed] = tokens.slice(i).join("");
          return result;
        }
      }

      stack.pop()!(token);
    }

    if (stack.length !== 1 || stack[0] !== key) {
      if (parseMode !== "stream") {
        throw new Error("failed to parse entire text as kv format");
      }

      if (!stack.pop()![eoi]?.()) {
        result[unparsed] = tokens.slice(parsed).join("");
        return;
      }
    }

    return result;
  },

  stringify(
    values: unknown,
    join: string = " ",
    indent?: number,
    trailer?: string,
  ) {
    const text = stringify_(values, join, indent);

    if (text.length) {
      return `${text}${trailer ?? ""}`;
    }

    return "";
  },

  stringifyKey,
  stringifyValue,
  tokenize(data) {
    const tokens = tokenize(data)
      .filter((_, i) => i & 1)
      .map<{ token: string; key?: string; value?: unknown; span?: number }>(
        (token) => {
          switch (token) {
            case "[":
            case "]":
            case "{":
            case "}":
            case ",":
            case "=":
              return { token };
            case ":":
              return { token: "=" };
          }

          if (!token.trim()) {
            return { token };
          }

          return { token, value: KV.parse(token) };
        },
      );

    const stack: { type: "=" | "[" | "{"; at: number }[] = [];

    const filteredIndexed = tokens
      .map((t, oi) => ({ ...t, oi }))
      .filter(({ token }) => token.trim());

    filteredIndexed.forEach(({ token }, idx) => {
      switch (token) {
        case "=":
          stack.unshift({ type: "=", at: filteredIndexed[idx - 1].oi });
          break;
        case ":":
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
              tokens[top.at].value = KV.parse(
                tokens
                  .slice(top.at + 2, filteredIndexed[idx].oi + 1)
                  .map(({ token }) => token)
                  .join(""),
              );
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

  unparsed,
  eoi,
  upto,
};

function kvTypeof(value: unknown) {
  return isScalar(value) ? scalarTypeOf(value) : typeof value;
}

function stringify_(values: unknown, join: string = " ", indent?: number) {
  if (values === "") {
    return '""';
  }

  return values && kvTypeof(values) === "object" && !Array.isArray(values)
    ? Object.entries(values)
        .filter(([, v]) => v !== undefined && typeof v !== "function")
        .map(([k, v]) => {
          return `${stringifyKey(k)}=${stringifyValue(v, indent)}`;
        })
        .join(join || " ")
    : stringifyValue(values, indent);
}

function stringifyValue(v: unknown, jindent?: number) {
  if (
    typeof v !== "string" ||
    !v ||
    ["null", "true", "false", ""].includes(v) ||
    !simpleToken.test(v)
  ) {
    return linewrappedStringify(v, jindent);
  }

  return v;
}

function linewrappedStringify(v: unknown, jindent?: number) {
  const text = JSON.stringify(v, (_key, value) => {
    if (typeof value === "bigint") {
      return JSON.rawJSON(String(value));
    }

    if (value instanceof BigInt || value instanceof Number) {
      return JSON.rawJSON(value["source"]);
    }

    return value;
  });

  const tokens = tokenize(text);

  function dent(indent: number) {
    return typeof jindent === "number"
      ? `\n${" ".repeat(jindent * indent)}`
      : "";
  }

  const space = jindent ? " " : "";

  return tokens
    .reduce<{
      stack: any[];
      output: (() => string)[];
    }>(
      (acc, token) => {
        switch (true) {
          case token === "[":
          case token === "{":
            {
              const container = {
                type: token,
                split: false,
                indent: acc.stack.length,
              };
              acc.stack[0].split = true;
              acc.stack.unshift(container);
              acc.output.push(
                () =>
                  token +
                  (container.split
                    ? dent(container.indent)
                    : token === "{"
                      ? space
                      : ""),
              );
            }
            break;
          case token === "]":
          case token === "}":
            {
              const container = acc.stack.shift();
              acc.output.push(() =>
                container.split
                  ? `${dent(container.indent - 1)}${token}`
                  : `${token === "}" ? space : ""}${token}`,
              );
            }
            break;
          case token === ":":
            acc.output.push(() => "=");
            break;
          case token === ",":
            {
              const container = acc.stack[0];
              acc.output.push(
                () =>
                  token +
                  (container.split
                    ? `${dent(container.indent)}`
                    : jindent
                      ? " "
                      : ""),
              );
            }
            break;
          default:
            {
              const next = dequoteJson(token);
              acc.output.push(() => {
                return next;
              });
            }
            break;
        }
        return acc;
      },
      { stack: [{ indent: 0, split: false }], output: [] },
    )
    .output.reduce((text, fn) => text + fn(), "");
}

function inValue(tokens: string[], i = tokens.length) {
  while (tokens[--i] === "") {
    const next = tokens[--i];

    if (next?.trim()) {
      if (["=", ":"].includes(tokens[i])) {
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

function dequoteJson(text: string) {
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
      output.push(dequoteText(token));
    } else {
      output.push(token);
    }
  }

  return output.join("");
}

function dequoteText(token: string) {
  const text = JSON.parse(token);
  switch (true) {
    case text === "null":
    case text === "false":
    case text === "true":
    case text === "":
      return token;
    case simpleToken.test(text):
      return text;
    default:
      return token;
  }
}

function stringifyKey(key: string) {
  return key && simpleKey.test(key) ? key : JSON.stringify(key);
}
