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

import { KV } from "../formats/kv-fmt.js";
import { createNumber, JSON } from "../raw-json.js";
import { isPatternSimple, patternize } from "../schema/core/pattern.js";
import { exposeSchematic, isSchematic } from "../schema/core/schema-ops.js";
import { Schematic, Template } from "../schema/core/types.js";
import { datums } from "../schema/definition/datum.js";
import { base64Encoding } from "../schema/definition/encodings/base64-encoding.js";
import {
  EncodingSchematicOps,
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
  ReferenceSchematicOps,
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
  blendEncoding,
} from "../schema/scheming.js";
import { evalTemplate } from "./eval-template.js";

export const encodings = {
  $json(value: unknown | Template<unknown>) {
    return blendEncoding(value, jsonEncoding);
  },
  $form(value?: string | Record<string, string> | [string, string][]) {
    return blendEncoding(value, (value) =>
      encodingTemplate(formEncodingType, mvKeyedTuples, parseForm(value)),
    ) as Template<string>;
  },
  $base64(value: string | Template<string>) {
    return blendEncoding(value, base64Encoding);
  },
  $text(value: string) {
    return blendEncoding(value, textTemplate);
  },
  $raw(value: string) {
    return blendEncoding(value, (value) =>
      textTemplate(datums.antipattern<string>(value)),
    );
  },
  $template(value: string) {
    if (
      (typeof value === "string" &&
        /^(?![0-9])[a-z0-9_-]+$/.test(value.trim())) ||
      isPatternSimple(patternize(value))
    ) {
      return textTemplate(value);
    }

    try {
      const template = evalBodyTemplate(value) as Template<string>;

      return blendEncoding(template, (template) => {
        if (isSchematic<string>(template)) {
          if (
            exposeSchematic<EncodingSchematicOps<string, unknown>>(
              template,
            )?.encoding?.().as === "string"
          ) {
            return template as Schematic<string>;
          }

          // don't accept top-level body aliases, assume it might be templated though.
          if (
            exposeSchematic<ReferenceSchematicOps<string>>(template).reference
          ) {
            return textTemplate(value);
          }
        }

        return jsonEncoding(template);
      });
    } catch (error) {
      void error;
      return textTemplate(value);
    }
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
  $flow: <T>(x: Template<T>) => referenceTemplate<T>({}).$of(x).$flow,
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
      if (mode === "match") {
        throw error;
      }

      // fallback to script evaluation (in non-match contexts)
      // if body doesn't parse
      return evalBodyTemplate(template);
    }
  },
  encode(output, context) {
    if (output === undefined) {
      return undefined;
    }

    if (context.environment.option("pretty-print")) {
      return KV.stringify(output, {
        indent: 2,
        limit: 80,
        mode: "json",
        split: true,
      });
    }

    return JSON.stringify(output, null, 0);
  },
};
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
