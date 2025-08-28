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
  PardonExecutionContext,
  PardonFetchExecution,
} from "../core/pardon/pardon.js";
import { Id } from "../db/sqlite.js";
import { hookExecution } from "../core/execution/execution-hook.js";
import { HTTP } from "../core/formats/http-fmt.js";
import { valueOps } from "../db/entities/value-entity.js";
import { httpOps } from "../db/entities/http-entity.js";
import { scopedScalarValues } from "../core/schema/core/schema-utils.js";
import { PardonTraceExtension } from "./trace.js";

export type PardonHttpExecutionContext = { http: Id } & PardonExecutionContext &
  Partial<PardonTraceExtension<{ http: Id }>>;

function onceFilter(seen?: string[]) {
  const once = new Set(seen);

  return (name: string) => {
    if (once.has(name)) return false;
    once.add(name);
    return true;
  };
}

export default function persist(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution<PardonHttpExecutionContext, typeof PardonFetchExecution>(
    execution,
    {
      async fetch(info, next) {
        const {
          context,
          match,
          egress: { redacted, evaluationScope: scope },
        } = info;
        const { app, ask } = context;
        const { database } = app();

        if (!database) {
          return next(info);
        }

        const req = HTTP.stringify(redacted);

        const { insertValue } = valueOps(database);
        const { insertHttp } = httpOps(database);

        context.http = database.sqlite
          .transaction(() => {
            const http = insertHttp({
              req,
              ask: ask ?? req,
            });

            const {
              endpoint: {
                configuration: { name: endpoint },
                service,
                action,
              },
            } = match;

            for (const [name, value] of Object.entries({
              endpoint,
              service,
              action,
            })) {
              if (value === undefined) {
                continue;
              }

              insertValue({
                http,
                type: "endpoint",
                scope: "",
                name,
                value: String(value),
              });
            }

            const once = onceFilter(["endpoint", "service", "action"]);

            const { values = {} } = HTTP.parse(ask ?? req);
            for (const [name, value] of Object.entries(values)) {
              if (!once(name)) continue;

              insertValue({
                http,
                type: "ask",
                scope: "",
                name,
                value,
              });
            }

            for (const [name, value] of Object.entries(match.values)) {
              if (!once(name)) continue;

              insertValue({
                http,
                type: "match",
                scope: "",
                name,
                value,
              });
            }

            const requestValues = scope.resolvedValues({
              secrets: false,
            });

            const outputRequestValues = scope.resolvedValues({
              exportsOnly: true,
            });

            for (const [name, value] of Object.entries(outputRequestValues)) {
              if (!once(name)) continue;

              insertValue({
                http,
                type: "req+out",
                scope: "",
                name,
                value,
              });
            }

            for (const [name, value] of Object.entries(requestValues)) {
              if (!once(name)) continue;

              insertValue({
                http,
                type: "req",
                scope: "",
                name,
                value,
              });
            }

            const definitions = scopedScalarValues(scope);
            for (const { name: name, value, scope } of definitions) {
              if (scope === "" && !once(name)) {
                continue;
              }

              insertValue({
                http,
                type: "req",
                scope,
                name,
                value,
              });
            }

            return http;
          })
          .default();

        return next(info);
      },
      async result({
        context: { http, app },
        result: { egress, ingress },
        error,
      }) {
        if (!ingress) {
          throw error;
        }

        const { database } = app();
        if (!database) {
          return;
        }

        const { updateWithResponse } = httpOps(database);
        const { insertValue } = valueOps(database);

        database.sqlite
          .transaction(() => {
            if (ingress.redacted) {
              updateWithResponse({
                http,
                res: HTTP.responseObject.stringify(ingress.redacted),
              });
            }

            const outputRequestValues = egress.evaluationScope.resolvedValues({
              exportsOnly: true,
            });

            const once = onceFilter([
              "endpoint",
              "service",
              "action",
              ...Object.keys(outputRequestValues),
            ]);

            const responseValues = ingress.evaluationScope.resolvedValues({
              secrets: false,
            });

            const outputResponseValues = ingress.evaluationScope.resolvedValues(
              {
                exportsOnly: true,
              },
            );

            for (const [name, value] of Object.entries(outputResponseValues)) {
              if (!once(name)) continue;
              insertValue({
                http,
                type: "res+out",
                scope: "",
                name,
                value,
              });
            }

            for (const [name, value] of Object.entries(responseValues)) {
              if (!once(name)) continue;
              insertValue({
                http,
                type: "res",
                scope: "",
                name,
                value,
              });
            }

            for (const { name: name, scope, value } of scopedScalarValues(
              ingress.evaluationScope,
            )) {
              if (scope === "" && !once(name)) {
                continue;
              }

              insertValue({
                type: "res",
                http,
                name,
                scope,
                value,
              });
            }
          })
          .default();
      },
    },
  );
}
