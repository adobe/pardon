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
import { keyed } from "../structures/keyed-list.js";
import { EncodingType, encodingTemplate } from "./encoding.js";
import { arrays } from "../arrays.js";
import { objects } from "../objects.js";
import { Template } from "../../core/types.js";

const headersEncodingType: EncodingType<Headers, [string, string][]> = {
  as: "Headers",
  decode({ template }) {
    return template !== undefined ? [...(template as Headers)] : undefined;
  },
  encode(output) {
    return output !== undefined ? new Headers(output) : undefined;
  },
};

export function headersTemplate(): Template<Headers> {
  const template = keyed.mv<[string, string]>(
    arrays.tuple(["{{key}}", undefined!]) as Template<[string, string]>,
    objects.object<Record<string, [string, string][]>>(
      {},
      arrays.multivalue(
        [],
        arrays.tuple([undefined! as string, undefined!] as [string, string]),
      ),
    ),
  );
  return encodingTemplate(headersEncodingType, template);
}
