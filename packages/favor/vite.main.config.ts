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
import { extendMainConfig } from "./vite.base.config.ts";

// https://vitejs.dev/config
export default extendMainConfig({
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    sourcemap: "inline",
    minify: false,
    rollupOptions: {
      external: ["better-sqlite3"],
      input: {
        main: "./electron/main.ts",
        "pardon-worker": "./electron/pardon-worker.ts",

        // pardon's compiler resolves 'pardon' to ./api,
        // but the package exports that as 'pardon'
        // map the "pardon" import back to api to simulate the runtime.
        api: "pardon",
        loader: "pardon/loader",
        runtime: "pardon/runtime",
        running: "pardon/running",
        testing: "pardon/testing",
      },
      output: {
        exports: "named",
        sourcemap: true,
      },
    },
  },
});
