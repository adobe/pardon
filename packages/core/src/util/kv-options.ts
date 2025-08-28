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
import { KV } from "../core/formats/kv-fmt.js";

function simpleKV(arg: string) {
  const match = /^([a-z0-9_]+)=(.*)$/i.exec(arg);

  if (match) {
    const [, field, value] = match;
    return [field, value] as const;
  }
}

export function extractKVs(
  args: string[],
  permissive?: boolean,
): (readonly [string, unknown])[] {
  const kvs: (readonly [string, unknown])[] = [];

  for (let i = 0; i < args.length; i++) {
    try {
      // try to parse json K=V arguments if possible
      const data =
        /^@?[a-z0-9_-]+=/i.test(args[i]) && KV.parse(args[i], "object");

      if (data) {
        args.splice(i--, 1);
        kvs.push(Object.entries(data)[0]);
      }
    } catch (error) {
      // since this is a commandline,
      // try simple string-assignment KVs as well.
      if (!permissive) {
        throw error;
      }

      const kv = simpleKV(args[i]);

      if (kv) {
        args.splice(i--, 1);
        kvs.push(kv);
      }
    }
  }

  return kvs;
}

function decode(token: string) {
  if (token.startsWith("'")) {
    return token.slice(1, -1);
  } else if (token.startsWith('"')) {
    return token.slice(1, -1).replace(/\\(.)/g, "$1");
  } else if (token.startsWith("\\")) {
    if (token[1] === "\n") {
      return "";
    }
    return token[1];
  }

  return token;
}

export function intoArgs(command: string) {
  const tokens = command
    .trim()
    .split(/(\s+|"(?:\\.|[^"\\])*"|'(?:[^'])*'|[^\\'"\s]+|\\.)/s);

  const args: string[] = [];

  for (let i = 1, argx = -1; i < tokens.length; i += 2) {
    if (argx >= 0 && !tokens[i].trim()) {
      args[++argx] = "";
      continue;
    }
    if (tokens[i - 1].length) {
      throw new Error(
        "unparsable shell-like command: unexpected " + tokens[i - 1],
      );
    }
    if (argx < 0) {
      args[(argx = 0)] = "";
    }
    args[argx] += decode(tokens[i]);
  }

  if (tokens[tokens.length - 1].length) {
    throw new Error(
      "unparsable shell-like command - unclosed quote or escape sequence",
    );
  }

  return args;
}
