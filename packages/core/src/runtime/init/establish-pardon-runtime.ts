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
  type PardonAppContextOptions,
  loadPardonRuntime,
} from "./workspace.js";
import { registerCompiler } from "../../modules/loader.js";

export async function establishPardonRuntime(
  options?: PardonAppContextOptions,
) {
  const { cleanup, ...runtime } = await loadPardonRuntime(options);
  const registration = registerCompiler(runtime);

  return {
    ...runtime,
    cleanup() {
      cleanup?.();
      registration.deregister();
    },
  };
}
