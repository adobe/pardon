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
import { HttpsSequenceScheme } from "../core/formats/https-fmt.js";
import { ScriptEnvironment } from "./schema/core/script-environment.js";
import { PardonCompiler } from "../runtime/compiler.js";
import { shared } from "./async.js";
import { resolveDefaults, resolveImport } from "./endpoint-environment.js";
import { dirname } from "node:path";

export function createSequenceEnvironment({
  compiler,
  sequenceScheme,
  sequencePath,
  values = {},
}: {
  compiler: PardonCompiler;
  sequenceScheme: HttpsSequenceScheme;
  sequencePath: string;
  values?: Record<string, string>;
}) {
  const scriptEnv = new ScriptEnvironment({
    name: sequencePath,
    config: {},
    input: {},
    runtime: {
      false: false,
      true: true,
      null: null,
      undefined: null,
      String,
      Number,
      Math,
      Date,
    },
    resolve(name, context) {
      return (
        values[name] ||
        resolveDefaults(name, sequenceScheme?.configuration?.defaults, context)
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
    express({ source, ident, evaluation }) {
      void source;
      void ident;

      return shared(() => evaluation());
    },
  });

  return scriptEnv;
}
