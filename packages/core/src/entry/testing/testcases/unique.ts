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
import { valueId } from "../../../util/value-id.js";
import { fi } from "./core.js";

export function unique(hash: (value: Record<string, any>) => string = valueId) {
  const seen = new Set<string>();

  return fi((env) => {
    const key = hash(env);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
