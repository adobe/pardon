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
import { evalSchema } from "../../../request/https-schema.js";
import { Schema, Template } from "../../core/schema.js";
import {
  EncodingType,
  encodingSchema,
  encodingTrampoline,
} from "./encoding-schema.js";

const jsonEncodingType: EncodingType<
  string,
  object | number | string | boolean | null
> = {
  decode({ mode, stub }) {
    if (mode === "match") {
      return JSON.parse(stub!);
    }

    return stub !== undefined ? evalSchema(stub) : undefined;
  },
  encode(output, context) {
    if (output === undefined) {
      return undefined;
    }

    if (context.environment.option("pretty-print")) {
      return JSON.stringify(output, null, 2);
    }

    return JSON.stringify(output);
  },
};

export function jsonEncoding(schema: Schema<unknown>): Schema<string> {
  return encodingSchema(jsonEncodingType, schema);
}

export function jsonTrampoline(template?: Template<unknown>) {
  return encodingTrampoline(jsonEncodingType, template);
}
