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
import { valueId } from "../../../../util/value-id.js";
import { diagnostic } from "../../core/context-util.js";
import { defineSchema, isSchematic } from "../../core/schema-ops.js";
import { expandTemplate } from "../../template.js";

export function valueSchema<T>(value: T) {
  return defineSchema<T>({
    scope() {},
    merge(context) {
      const { template } = context;

      if (isSchematic(template)) {
        return expandTemplate(template, { ...context, template: value });
      }

      if (valueId(template) === valueId(value)) {
        return valueSchema(value);
      }

      throw diagnostic(context, "value merge unsupported with different value");
    },
    render() {
      return value;
    },
  });
}
