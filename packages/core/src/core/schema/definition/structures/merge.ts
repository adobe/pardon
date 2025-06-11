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
import {
  defineSchematic,
  exposeSchematic,
  isSchematic,
  merge,
} from "../../core/schema-ops.js";
import { Schema, SchematicOps, Template } from "../../core/types.js";
import { expandTemplate } from "../../template.js";

type MergedSchematicOps<T> = SchematicOps<T> & {
  templates: [Template<T>, Template<T>];
};

export function mergedSchematic<T = any>(
  lhs: Template<T>,
  rhs: Template<T>,
): Template<T> {
  return defineSchematic<MergedSchematicOps<T>>({
    templates: [lhs, rhs],
    expand(context) {
      const lhsSchema = expandTemplate(lhs, context);
      if (!lhsSchema) {
        return undefined;
      }

      return merge(lhsSchema, { ...context, template: rhs });
    },
    blend(context, next) {
      let blended: Schema<T> | undefined = undefined;

      if (isSchematic(lhs)) {
        const lhss = exposeSchematic<SchematicOps<T>>(lhs);
        if (lhss.blend) {
          blended = lhss.blend(context, next);
          if (blended) {
            return merge(blended, { ...context, template: rhs });
          } else {
            return undefined;
          }
        }
      }

      const expanded = next({ ...context, template: lhs });
      if (expanded) {
        if (isSchematic(rhs)) {
          const rhss = exposeSchematic<SchematicOps<T>>(rhs);
          if (rhss.blend) {
            return rhss.blend(context, (context) => merge(expanded, context));
          }
        }

        return merge(expanded, { ...context, template: rhs });
      }
    },
  });
}
