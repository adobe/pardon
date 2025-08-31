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
import type { Schematic, SchematicOps, Template } from "../../core/types.js";
import { defineSchematic, merge } from "../../core/schema-ops.js";
import { expandTemplate } from "../../template.js";

type MergedSchematicOps<T> = SchematicOps<T> & {
  templates: [Template<T>, Template<T>];
};

export function mergedSchematic<T = any>(
  lhs: Template<T>,
  rhs: Template<T>,
): Schematic<T> {
  return defineSchematic<MergedSchematicOps<T>>({
    templates: [lhs, rhs],
    expand(context) {
      const lhsSchema = expandTemplate(lhs, context);
      return lhsSchema && merge(lhsSchema, { ...context, template: rhs });
    },
    blend(context, next) {
      const merged = next({ ...context, template: lhs });
      return merged && merge(merged, { ...context, template: rhs });
    },
  });
}
