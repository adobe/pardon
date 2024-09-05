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

import { jsonSchemaTransform, syncEvaluation } from "../expression.js";
import { Schematic, Template } from "../schema/core/types.js";
import { datums } from "../schema/definition/datum.js";
import { base64Encoding } from "../schema/definition/encodings/base64-encoding.js";
import { jsonEncoding } from "../schema/definition/encodings/json-encoding.js";
import { textTemplate } from "../schema/definition/encodings/text-encoding.js";
import { urlEncodedFormTemplate } from "../schema/definition/encodings/url-encoded.js";
import { createNumber } from "../schema/definition/scalar.js";
import { hiddenTemplate } from "../schema/definition/structures/hidden.js";
import { redact } from "../schema/definition/structures/redact.js";
import { referenceTemplate } from "../schema/definition/structures/reference.js";
import {
  muxTemplate,
  tuple,
  unwrapSingle,
  keyed,
  mixTemplate,
  matchTemplate,
} from "../schema/scheming.js";

const encodings = {
  json(value: unknown | Template<unknown>) {
    return jsonEncoding(value);
  },
  form(value: string | Record<string, string> | [string, string][]) {
    return urlEncodedFormTemplate(value);
  },
  base64(value: string | Template<string>) {
    return base64Encoding(value);
  },
  text(value: string) {
    return textTemplate(value);
  },
  raw(value: string) {
    return textTemplate(datums.antipattern<string>(value));
  },
} satisfies Record<string, (...args: any) => Schematic<string>>;

export type EncodingTypes = keyof typeof encodings;

export const bodyGlobals = {
  false: false,
  true: true,
  null: null,
  ...encodings,
  bigint: <T>(x: Template<T>) => referenceTemplate<bigint>({}).of(x).bigint,
  nullable: <T>(x: Template<T>) => referenceTemplate({}).of(x).nullable,
  string: <T>(x: Template<T>) => referenceTemplate<string>({}).of(x).string,
  number: <T>(x: Template<T>) => referenceTemplate<number>({}).of(x).number,
  bool: <T>(x: Template<T>) => referenceTemplate<boolean>({}).of(x).bool,
  redact,
  mux: muxTemplate,
  mix: mixTemplate,
  match: matchTemplate,
  hidden: hiddenTemplate,
  keyed,
  tuple,
  unwrapSingle,
  $$number(source: string) {
    return createNumber(source);
  },
};

export function evalTemplate(schemaSource: string): Schematic<unknown> {
  return syncEvaluation(`${schemaSource}`, {
    binding(identifier) {
      if (identifier in bodyGlobals) {
        return bodyGlobals[identifier];
      }

      if (identifier.startsWith("$")) {
        const ident = identifier.slice(1);

        return referenceTemplate({ ref: ident });
      }

      return undefined;
    },
    transform: jsonSchemaTransform,
  }) as Schematic<unknown>;
}

export function getContentEncoding(encoding: EncodingTypes) {
  return encodings[encoding]!;
}
