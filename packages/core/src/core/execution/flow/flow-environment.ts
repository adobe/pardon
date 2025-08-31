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
import type { HttpsFlowScheme } from "../../formats/https-fmt.js";
import type { PardonCompiler } from "../../../runtime/compiler.js";
import { ScriptEnvironment } from "../../schema/core/script-environment.js";
import { shared } from "../../tracking.js";
import { resolveDefaults, resolveImport } from "../../endpoint-environment.js";
import { dirname } from "node:path";

export function createSequenceEnvironment({
  compiler,
  flowScheme: sequenceScheme,
  flowPath: sequencePath,
  values = {},
}: {
  compiler: PardonCompiler;
  flowScheme: HttpsFlowScheme;
  flowPath: string;
  values?: Record<string, unknown>;
}) {
  const scriptEnv = new ScriptEnvironment({
    name: sequencePath,
    config: [{}],
    input: {},
    runtime: {
      false: false,
      true: true,
      null: null,
      undefined: null,
      String,
      Number,
      BigInt(n: any) {
        if (n instanceof Number) {
          return BigInt(n["source"]);
        }
        return BigInt(n);
      },
      Math,
      Date,
    },
    resolve(context, { name, scoped }) {
      // todo: check if scoped should skip resolution here in any cases.
      void scoped;
      const value = values[name];

      return value !== undefined
        ? value
        : resolveDefaults(
            name,
            sequenceScheme?.configuration?.defaults,
            context,
          );
    },
    async evaluate(name) {
      return await resolveImport(
        name,
        sequenceScheme.configuration,
        compiler,
        dirname(sequencePath),
      );
    },
    redact(value) {
      return value;
    },
    express({ source, identifier, evaluation }) {
      void source;
      void identifier;

      return shared(() => evaluation());
    },
  });

  return scriptEnv;
}
