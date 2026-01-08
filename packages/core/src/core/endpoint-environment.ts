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
  type Pattern,
  type PatternRegex,
  isPatternRegex,
  isPatternSimple,
  patternRender,
  patternValues,
} from "./schema/core/pattern.js";
import type {
  Configuration,
  LayeredEndpoint,
} from "../config/collection-types.js";
import type { PardonCompiler } from "../runtime/compiler.js";
import type { DefaultsMap } from "./schema/core/config-space.js";
import type { HttpsRequestObject } from "./request/https-template.js";
import type {
  SchemaContext,
  SchemaMergingContext,
} from "./schema/core/types.js";
import type { PardonAppContext } from "./pardon/pardon.js";
import { resolveIdentifier } from "./schema/core/evaluate.js";
import { ScriptEnvironment } from "./schema/core/script-environment.js";
import { arrayIntoObject, mapObject } from "../util/mapping.js";
import { PardonError } from "./error.js";
import { isSecret } from "./schema/definition/hinting.js";
import { isScalar } from "./schema/definition/scalar.js";
import { makeSecretsProxy } from "../runtime/secrets.js";

function simpleValues(values: Record<string, any>): Record<string, string> {
  return mapObject(values, {
    filter(_key, mapped) {
      return typeof mapped === "string" || typeof mapped === "number";
    },
    values: String,
  });
}

export function createEndpointEnvironment({
  app,
  endpoint,
  values = {},
  secrets = {},
  runtime = {},
  options,
  context,
}: {
  app: ScriptEnvironment["app"] & Pick<PardonAppContext, "compiler">;
  endpoint: LayeredEndpoint;
  values?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  options?: Record<string, boolean>;
  context?: SchemaMergingContext<HttpsRequestObject>;
}) {
  const environment = new ScriptEnvironment({
    app,
    name: endpoint.configuration.name,
    config: endpoint.configuration.config,
    defaults: endpoint.configuration.defaults,
    input: values,
    runtime: {
      false: false,
      true: true,
      null: null,
      String,
      Number,
      Math,
      Date,
      Boolean(x: any) {
        if (x instanceof Number) {
          return Boolean(Number(x));
        }
        return Boolean(x);
      },
      BigInt(n: any) {
        if (n instanceof Number) {
          return BigInt(n["source"] ?? n);
        }
        return BigInt(n);
      },
      ...runtime,
    },
    resolve(context, { name, scoped }) {
      // todo - revisit use of scoped here
      void scoped;
      return (
        values[name] ??
        secrets[name] ??
        resolveDefaults(name, endpoint?.configuration?.defaults, context)
      );
    },
    resolvedDefaults(context) {
      return resolvedDefaults(context, endpoint?.configuration?.defaults);
    },
    evaluate(name, context) {
      if (name === "secrets" && context.environment.app?.secrets) {
        return makeSecretsProxy(context);
      }

      context.evaluationScope.imported(name, context);

      return importFromConfiguration(
        name,
        endpoint.configuration,
        app.compiler,
      );
    },
    async redact(value, patterns) {
      if (options?.secrets) {
        return value;
      }

      if (patterns) {
        const pattern = patterns?.find(isPatternRedacted);

        if (!pattern) {
          return value;
        }

        if (!isScalar(value) && !isPatternSimple(pattern)) {
          return "{{redacted}}";
        }

        const parts =
          isScalar(value) && !isPatternSimple(pattern)
            ? patternValues(pattern, String(value))
            : [value];

        if (!parts) {
          return "{{redacted}}";
        }

        const render = await Promise.all(
          parts.map(async (part: string | typeof value, index: number) => {
            const variable = pattern.vars[index];
            const { param, redactor } = variable;

            if (isSecret(variable) || redactor) {
              if (redactor) {
                const redactorFunction =
                  (await importFromConfiguration(
                    redactor,
                    endpoint.configuration,
                    app.compiler,
                  )) ?? runtime[redactor];

                return redactorFunction(part, variable.param, value);
              }

              const maybeRedactor =
                (await importFromConfiguration(
                  `redact$${param}`,
                  endpoint.configuration,
                  app.compiler,
                )) ?? runtime[`redact$${param}`];

              if (typeof maybeRedactor === "function") {
                return maybeRedactor(part, variable.param, value);
              }

              return `{{ @${param ?? ""} }}`;
            }

            return part;
          }),
        );

        if (isPatternSimple(pattern)) {
          return render[0];
        }

        return patternRender(pattern, render);
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
    get extendedContext() {
      const {
        service,
        action,
        configuration: { name },
      } = endpoint;

      return {
        service,
        action,
        endpoint: name,
      };
    },
  });

  environment.choose(environment.implied(simpleValues(values), context));

  return environment;
}

export function resolveDefaults(
  name: string,
  defaults: DefaultsMap | undefined,
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
    const keyvalue =
      resolveIdentifier(context, key) ?? context.environment.implied({})[key];

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

function importFromConfiguration(
  name: string,
  configuration: Configuration,
  compiler: PardonCompiler,
) {
  return resolveImport(
    name,
    configuration,
    compiler,
    `pardon:${configuration.path}`,
  );
}

export async function resolveImport(
  name: string,
  configuration: Pick<Configuration, "import"> | undefined,
  compiler: PardonCompiler,
  parentSpecifier: string,
) {
  const importRef = findImport(name, configuration ?? {});

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

function isPatternRedacted(pattern: Pattern): pattern is PatternRegex {
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
