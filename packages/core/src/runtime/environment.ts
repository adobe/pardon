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
import { tracking } from "../core/tracking.js";

export async function initTrackingEnvironment() {
  const { awaited: environmentUpdates, track: trackEnvironmentUpdate } =
    tracking<Record<string, unknown> | null>();

  await Promise.resolve();

  const values = () => {
    const stack = environmentUpdates();
    const nullIndex = stack.lastIndexOf(null);

    return Object.assign(
      {},
      ...(nullIndex !== -1 ? stack.slice(nullIndex + 1) : stack),
    );
  };

  const environmentProxy = new Proxy(
    {},
    {
      ownKeys() {
        return Object.getOwnPropertyNames(values());
      },
      getOwnPropertyDescriptor(_, p) {
        return Object.getOwnPropertyDescriptor(values(), p);
      },
      has(_, p) {
        return p in values();
      },
      get(_, key) {
        return values()[key];
      },
      set(_, p, value) {
        if (typeof p === "symbol") {
          return false;
        }

        (globalThis as any).environment = { [p]: value };
        return true;
      },
      deleteProperty(_, p) {
        if (typeof p === "symbol") {
          return false;
        }
        (globalThis as any).environment = { [p]: undefined };
        return true;
      },
    },
  );

  Object.defineProperty(globalThis, "environment", {
    configurable: false,
    enumerable: true,
    get() {
      return environmentProxy;
    },
    set(values: Record<string, unknown> | null) {
      if (values && (Array.isArray(values) || values[0])) {
        throw new Error("unexpected array assignment to environment");
      }

      trackEnvironmentUpdate(values ? { ...values } : null);
    },
  });
}
