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

export const AsyncResource = {
  bind(fn: any) {
    return fn;
  },
};

export function createHook() {
  return {
    enable() {
      // throw new Error("unsupported");
    },
  };
}

export class AsyncLocalStorage<T> {
  readonly stack: T[] = [];

  run<X>(value: T, fn: () => X): X {
    this.stack.unshift(value);

    let asPromise = false;
    try {
      const result = fn();

      if (typeof (result as Promise<unknown>)?.then === "function") {
        asPromise = true;
        return (result as Promise<unknown>).finally(() => {
          this.stack.shift();
        }) as X;
      }

      return result;
    } finally {
      if (!asPromise) {
        this.stack.shift();
      }
    }
  }

  getStore() {
    return this.stack[0];
  }
}
