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
import { type Alternation, type Generation, reputed } from "./core.js";

import { set } from "./set.js";

// formats %% as %, -- as -, and %hypenated keys
function formatter(format: Format): FormatFn {
  if (typeof format === "function") {
    return format;
  }

  return (env) =>
    format.replace(
      /%([a-z0-9_]+)|%\{([^{}]+)\}|%\(([^()]+)\)|%%/gi,
      (match, key, bkey, pkey) => {
        if (match === "%%") {
          return "%";
        }

        return String(env[pkey ?? bkey ?? key]);
      },
    );
}

type FormatFn = (env: Record<string, any>) => string;
type Format = string | FormatFn;

export function format(format: Format | Alternation): Alternation;
export function format(key: string, format: Format | Alternation): Generation;
export function format(
  keyOrFormat: Format | Alternation | string,
  formatValue?: Format | Alternation,
): Alternation | Generation {
  if (formatValue && typeof keyOrFormat !== "string") {
    throw new Error("invalid format()");
  }

  if (formatValue) {
    return set(() => ({
      [keyOrFormat as string]: format(formatValue),
    }));
  }

  return reputed((context, format) => {
    return [formatter(format as Format)(context.environment)];
  }, keyOrFormat as Alternation);
}
