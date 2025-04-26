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

import { createNumber, JSON } from "../json.js";
import { Schematic, Template } from "../schema/core/types.js";
import { datums } from "../schema/definition/datum.js";
import { base64Encoding } from "../schema/definition/encodings/base64-encoding.js";
import {
  encodingTemplate,
  EncodingType,
} from "../schema/definition/encodings/encoding.js";
import { textTemplate } from "../schema/definition/encodings/text-encoding.js";
import {
  formEncodingType,
  parseForm,
} from "../schema/definition/encodings/url-encoded.js";
import { hiddenTemplate } from "../schema/definition/structures/hidden.js";
import { redact } from "../schema/definition/structures/redact.js";
import {
  ReferenceSchematic,
  referenceTemplate,
} from "../schema/definition/structures/reference.js";
import {
  muxTemplate,
  tuple,
  unwrapSingle,
  makeKeyed,
  mixTemplate,
  matchTemplate,
  mvKeyedTuples,
} from "../schema/scheming.js";
import { evalTemplate } from "./eval-template.js";

export const encodings = {
  $json(value: unknown | Template<unknown>) {
    return jsonEncoding(value);
  },
  $form(value?: string | Record<string, string> | [string, string][]) {
    return encodingTemplate(
      formEncodingType,
      mvKeyedTuples,
      parseForm(value),
    ) as Template<string>;
  },
  $base64(value: string | Template<string>) {
    return base64Encoding(value);
  },
  $text(value: string) {
    return textTemplate(value);
  },
  $raw(value: string) {
    return textTemplate(datums.antipattern<string>(value));
  },
  $template(value: string) {
    const template = evalBodyTemplate(value);
    if (typeof template === "function") {
      return template as Schematic<string>;
    }

    return jsonEncoding(template);
  },
} satisfies Record<string, (...args: any) => Template<string>>;

type InternalEncodingTypes = keyof typeof encodings;
export type EncodingTypes = InternalEncodingTypes extends `$${infer Pretty}`
  ? Pretty
  : never;

// error TS7056: The inferred type of this node exceeds the maximum length the compiler will serialize.
// An explicit type annotation is needed.
export const bodyGlobals: Record<string, any> = {
  false: false,
  true: true,
  null: null,
  ...encodings,
  $: $ref,
  $bigint: <T>(x: Template<T>) => referenceTemplate<bigint>({}).$of(x).$bigint,
  $nullable: <T>(x: Template<T>) => referenceTemplate({}).$of(x).$nullable,
  $string: <T>(x: Template<T>) => referenceTemplate<string>({}).$of(x).$string,
  $number: <T>(x: Template<T>) => referenceTemplate<number>({}).$of(x).$number,
  $bool: <T>(x: Template<T>) => referenceTemplate<boolean>({}).$of(x).$bool,
  $redact: redact,
  $mux: muxTemplate,
  $mix: mixTemplate,
  $match: matchTemplate,
  $hidden: hiddenTemplate,
  $keyed: makeKeyed,
  $keyed$mv: makeKeyed.mv,
  $tuple: tuple,
  $unwrapSingle: unwrapSingle,
  $$number(source: string) {
    return createNumber(source);
  },
};

export function evalBodyTemplate(source: string) {
  return evalTemplate(source, bodyGlobals);
}

export function getContentEncoding(encoding: InternalEncodingTypes) {
  return encodings[encoding]!;
}

export function jsonEncoding(template?: Template<unknown>): Template<string> {
  return encodingTemplate(jsonEncodingType, template);
}

function $ref(
  template: TemplateStringsArray,
  ...args: never[]
): ReferenceSchematic<unknown>;
function $ref(template: string): ReferenceSchematic<unknown>;
function $ref(ref: TemplateStringsArray | string) {
  if (typeof ref !== "string") {
    ref = String.raw(ref);
  }
  return referenceTemplate({ ref });
}

export const jsonEncodingType: EncodingType<string, unknown> = {
  as: "string",
  decode({ template, mode }) {
    if ((template ?? "") == "") {
      return undefined;
    }

    if (typeof template !== "string") {
      throw new Error("json cannot parse non-string");
    }

    try {
      return JSON.parse(template);
    } catch (error) {
      if (mode !== "match") {
        // fallback to script evaluation (in non-match contexts)
        // if body doesn't parse
        void error;
        return evalBodyTemplate(template);
      }
    }
  },
  encode(output, context) {
    if (output === undefined) {
      return undefined;
    }

    if (context.environment.option("pretty-print")) {
      return JSON.stringify(output, null, 2);
    }

    return JSON.stringify(output, null, 0);
  },
};
