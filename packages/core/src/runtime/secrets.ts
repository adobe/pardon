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
import { SchemaRenderContext } from "../core/schema/core/types.js";
import { isScalar } from "../core/schema/definition/scalar.js";
import { secretOps } from "../db/entities/secrets-entity.js";
import { mapObject } from "../util/mapping.js";

const memory: [Record<string, string>, Record<string, any>][] = [];

export function makeSecretsProxy(context: SchemaRenderContext) {
  const { database } = context.environment.app ?? {};

  function lookup(scope: Record<string, any>, ...secrets: string[]) {
    scope = scalars(scope);

    if (database) {
      return secretOps(database).rememberSecrets(scope)(...secrets);
    }

    const found = memory.reduce((found, [ctx, values]) => {
      if (Object.entries(ctx).every(([k, v]) => scope[k] === v)) {
        Object.assign(found, values);
      }
      return found;
    }, {});

    if (secrets.length === 1) {
      return found[secrets[0]];
    }

    return found;
  }

  function scopedSecrets(scope: Record<string, any>) {
    return new Proxy(
      {},
      {
        set(_, secret, value) {
          if (typeof secret !== "string") {
            return false;
          }

          const secrets = secret === "*" ? value : { [secret]: value };
          if (database) {
            secretOps(database).memorizeSecret(scope, secrets);
          } else {
            memory.push([scope, secrets]);
          }
          return true;
        },
        get(target, secret) {
          if (typeof secret !== "string") {
            return target[secret];
          }

          return lookup(
            {
              ...context.environment.contextValues,
              ...context.evaluationScope.resolvedValues(),
              ...scope,
            },
            secret,
          );
        },
      },
    );
  }

  return new Proxy(() => {}, {
    apply(_target, _this, args) {
      return scopedSecrets(args[0]);
    },
    get(target, secret) {
      if (secret === "then") {
        return undefined;
      }

      if (secret === Symbol.toPrimitive) {
        return () => undefined;
      }

      if (typeof secret !== "string") {
        return target[secret];
      }

      return lookup(
        {
          ...context.environment.contextValues,
          ...context.evaluationScope.resolvedValues(),
        },
        secret,
      );
    },
    set() {
      return false;
    },
  });
}

function scalars(object: Record<string, any>): Record<string, string> {
  return mapObject(
    mapObject(object, {
      select: (value) => isScalar(value),
    }),
    String,
  );
}
