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
import { Schema, Template } from "../../core/schema.js";
import {
  encodingSchema,
  encodingTrampoline,
  EncodingType,
} from "./encoding-schema.js";

const textEncoder: EncodingType<string, string> = {
  decode({ stub, mode }) {
    if (mode === "match") {
      return stub;
    }

    return stub;
  },
  encode(source) {
    return source;
  },
};

export function textEncoding(schema: Schema<string>) {
  return encodingSchema(textEncoder, schema);
}

export function textTrampoline(template: Template<string>) {
  return encodingTrampoline(textEncoder, template);
}
