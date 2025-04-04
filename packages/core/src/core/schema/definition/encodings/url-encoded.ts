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
import { intoSearchParams } from "../../../request/search-pattern.js";
import { EncodingType } from "./encoding.js";

export const queryEncodingType: EncodingType<
  URLSearchParams,
  string | Record<string, string> | [string, string][]
> = {
  as: "string",
  encode(output) {
    return output !== undefined
      ? intoSearchParams(output as string)
      : undefined;
  },
  decode({ template }) {
    return template !== undefined
      ? [...(template as URLSearchParams).entries()]
      : undefined;
  },
};

export function parseForm(
  template?: string | Record<string, string> | [string, string][],
) {
  return template === undefined
    ? undefined
    : [
        ...intoSearchParams(
          typeof template === "string"
            ? `?${template ?? ""}`
            : (template as Record<string, string> | [string, string][]),
        ).entries(),
      ];
}

export const formEncodingType: EncodingType<
  string | Record<string, string> | [string, string][],
  [string, string][]
> = {
  as: "string",
  decode({ template }) {
    return template
      ? parseForm(
          template as string | Record<string, string> | [string, string][],
        )
      : undefined;
  },
  encode(output) {
    return String(
      intoSearchParams(
        typeof output === "string"
          ? `?${output}`
          : (output as Record<string, string> | [string, string][]),
      ),
    ).slice(1);
  },
};
