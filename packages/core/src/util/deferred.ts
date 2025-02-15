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
export default function deferred<T = void>(): Deferred<T> {
  let resolution: any;

  const promise = new Promise<T>(
    (resolve, reject) => (resolution = { resolve: resolve, reject }),
  );

  return { promise, resolution } as Deferred<T>;
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolution: {
    // Thanks @Andarist for the [T] extends [void] hint.
    // https://github.com/microsoft/TypeScript/issues/61186
    resolve: [T] extends [void] ? () => void : (result: T) => void;
    reject(error: unknown): void;
  };
};
