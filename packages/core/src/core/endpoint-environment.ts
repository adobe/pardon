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
import { Configuration, LayeredEndpoint } from "../config/collection-types.js";
import {
  Pattern,
  isPatternLiteral,
  isPatternRegex,
  patternRender,
  patternValues,
} from "./schema/core/pattern.js";
import { resolveIdentifier } from "./schema/core/evaluate.js";
import { ScriptEnvironment } from "./schema/core/script-environment.js";
import { PardonCompiler } from "../runtime/compiler.js";
import { ConfigMapping } from "./schema/core/config-space.js";
import { arrayIntoObject, mapObject } from "../util/mapping.js";
import { HttpsRequestObject } from "./request/https-template.js";
import { PardonError } from "./error.js";
import { SchemaContext, SchemaMergingContext } from "./schema/core/types.js";
import { isSecret } from "./schema/definition/hinting.js";

function simpleValues(values: Record<string, unknown>): Record<string, string> {
  return mapObject(values, {
    filter(_key, mapped) {
      return typeof mapped === "string" || typeof mapped === "number";
    },
    values: String,
  });
}

export function createEndpointEnvironment({
  endpoint,
  values = {},
  runtime = {},
  compiler,
  secrets,
  options,
  context,
}: {
  endpoint: LayeredEndpoint;
  values?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  compiler: PardonCompiler;
  secrets?: boolean;
  options?: Record<string, boolean>;
  context?: SchemaMergingContext<HttpsRequestObject>;
}) {
  const environment = new ScriptEnvironment({
    name: endpoint.configuration.name,
    config: endpoint.configuration.config,
    input: values,
    runtime: {
      false: false,
      true: true,
      null: null,
      String,
      Number,
      Math,
      Date,
      Boolean,
      ...runtime,
    },
    resolve(name, context) {
      return (
        values[name] ||
        resolveDefaults(name, endpoint?.configuration?.defaults, context)
      );
    },
    resolvedDefaults(context) {
      return resolvedDefaults(context, endpoint?.configuration?.defaults);
    },
    async evaluate(name, context) {
      context.scope.imported(name, context);

      return await resolveImport(
        name,
        endpoint.configuration,
        compiler,
        `pardon:${endpoint.configuration.path}`,
      );
    },
    redact(value, patterns) {
      if (secrets) {
        return value;
      }

      if (patterns) {
        const pattern = patterns?.find(isPatternRedacted);

        if (!pattern) {
          return value;
        }

        const values = patternValues(pattern, String(value));
        if (!values) {
          return value;
        }

        if (isPatternLiteral(pattern)) {
          return pattern.source;
        }

        return patternRender(
          pattern,
          values.map((part, i) => {
            const variable = pattern.vars[i];
            const { param } = variable;

            if (isSecret(variable)) {
              return `{{@${param}}}`;
            }

            return part;
          }),
        );
      }

      return "{{redacted}}";
    },
    async express({ source, identifier, evaluation }) {
      void source;
      void identifier;

      return evaluation();
    },
    options(key) {
      return options?.[key];
    },
  });

  environment.choose(environment.implied(simpleValues(values), context));

  return environment;
}

export function resolveDefaults(
  name: string,
  defaults: Record<string, ConfigMapping> | undefined,
  context: SchemaContext<unknown>,
) {
  let defaulting = defaults?.[name];
  const path = [name];

  while (defaulting && typeof defaulting === "object") {
    const [key, ...rest] = Object.keys(defaulting);
    if (rest.length) {
      throw new Error(`invalid defaults: ${path.join("/")}`);
    }
    const mapping = defaulting[key];
    const keyvalue = resolveIdentifier(context, key);

    path.push(
      `${key}=${mapping?.[String(keyvalue)] ? (keyvalue as string) : "default"}`,
    );

    defaulting =
      mapping?.[(keyvalue ?? "default") as string] ?? mapping?.["default"];

    // allow null defaults successfully resolve to undefined defaults
    if (defaulting === null) {
      return undefined;
    }

    if (defaulting !== undefined) {
      continue;
    }

    if (context.mode === "render") {
      throw new PardonError(`unresolved default: ${path.join("/")}`);
    }

    break;
  }

  return defaulting;
}

export async function resolveImport(
  name: string,
  configuration: Pick<Configuration, "import">,
  compiler: PardonCompiler,
  parentSpecifier: string,
) {
  const importRef = findImport(name, configuration);

  if (importRef) {
    const module = await compiler.import(importRef.specifier, parentSpecifier);

    if (importRef.import === "*") {
      return module;
    }

    return module[importRef.import];
  }
}

function findImport(
  name: string,
  { import: imports = {} }: Pick<Configuration, "import">,
) {
  for (const [specifier, declaration] of Object.entries(imports)) {
    if (typeof declaration == "string") {
      if (declaration === name) {
        return { specifier, import: "*" };
      }

      continue;
    }

    for (const itemized of declaration) {
      let [importName, asName] = itemized.split(/\s+as\s+/, 2);
      asName ??= importName;
      if (asName.trim() === name) {
        return { specifier, import: importName.trim() };
      }
    }
  }

  return null;
}

function isPatternRedacted(pattern: Pattern) {
  return isPatternRegex(pattern) && pattern.vars.some(isSecret);
}

function resolvedDefaults(
  context: SchemaMergingContext<unknown>,
  defaults: Configuration["defaults"] | undefined,
) {
  return arrayIntoObject(Object.keys(defaults ?? {}), (key) => {
    const value = resolveDefaults(key, defaults, context) ?? null;

    return typeof value !== "object" && { [key]: value };
  });
}
