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
import { JSON } from "../../../json.js";
import { evalTemplate } from "../../../request/body-template.js";
import { Schematic, Template } from "../../core/types.js";
import { createNumber } from "../scalar.js";
import { EncodingType, encodingTemplate } from "./encoding.js";

const jsonEncodingType: EncodingType<string, unknown> = {
  as: "string",
  decode({ mode, template }) {
    if ((template ?? "") == "") {
      return undefined;
    }

    if (typeof template !== "string") {
      throw new Error("json cannot parse non-string");
    }

    if (mode === "match") {
      return JSON.parse(template, (_, value, { source }) => {
        if (typeof value === "number") {
          return createNumber(source, value);
        }

        return value;
      });
    }

    return evalTemplate(template);
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

export function jsonEncoding(template?: Template<unknown>): Schematic<string> {
  return encodingTemplate(jsonEncodingType, template);
}
