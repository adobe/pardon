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
import { Schema } from "../../core/schema.js";
import { keyed } from "../structures/keyed-list-schema.js";
import { stubSchema } from "../structures/stub-schema.js";
import { EncodingType, encodingSchema } from "./encoding-schema.js";
import { arrays } from "../arrays.js";
import { objects } from "../objects.js";
import { scalars } from "../scalars.js";

const headersEncodingType: EncodingType<Headers, [string, string][]> = {
  decode({ stub }) {
    return stub !== undefined ? [...stub] : undefined;
  },
  encode(output) {
    return output !== undefined ? new Headers(output) : undefined;
  },
};

export function headersSchema(
  schema: Schema<[string, string][]> = keyed.mv<[string, string]>(
    arrays.tuple([scalars.string("{{key}}"), stubSchema()]) as Schema<
      [string, string]
    >,
    objects.object(
      {},
      arrays.multivalue([], arrays.tuple([stubSchema(), stubSchema()])),
    ) as Schema<Record<string, [string, string][]>>,
  ),
): Schema<Headers> {
  return encodingSchema(headersEncodingType, schema);
}
