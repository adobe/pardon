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
export default function deferred<T = void>() {
  let resolution: {
    resolve: T extends void ? () => void : (value: T) => void;
    reject: (error: unknown) => void;
  };

  const promise = new Promise<T>(
    (resolve, reject) => (resolution = { resolve: resolve as any, reject }),
  );

  return { resolution: resolution!, promise };
}

export type Deferred<T> = ReturnType<typeof deferred<T>>;
