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
import { type Alternation, type Generation, generalteration } from "./core.js";

export const robin = Object.assign(
  generalteration((...options: Generation[] | [Alternation] | unknown[]) => {
    if (options.length === 0) {
      throw new Error("empty round robin");
    }

    let i = 0;
    return async () => {
      if (i === options.length) i = 0;
      return [options[i++]];
    };
  }),
  {
    apply: generalteration(
      (
        args:
          | Promise<Generation[] | [Alternation] | unknown[]>
          | Generation[]
          | [Alternation]
          | unknown[],
      ) => {
        let i = 0;
        return async () => {
          const options = await args;

          if (options.length === 0) {
            throw new Error("empty round robin");
          }

          if (i === options.length) i = 0;
          return [options[i++]];
        };
      },
    ),
  },
);
