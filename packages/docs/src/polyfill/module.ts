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

import * as async_hooks from "./async_hooks.ts";
import * as buffer from "./buffer.ts";
import * as events from "events";
import * as fs_promises from "./fs_promises.ts";
import * as fs from "./fs.ts";
import * as os from "./os.ts";
import * as util_types from "./util-types.ts";
import * as util from "./util.ts";
import * as path from "./path.ts";
import * as url from "./url.ts";
import * as string_decoder from "./string_decoder.ts";
import * as stream from "stream-browserify";
import * as net from "./net.ts";

const polyfills = {
  async_hooks,
  buffer,
  events,
  "fs/promises": fs_promises,
  fs,
  os,
  "util/types": util_types,
  util,
  path,
  url,
  string_decoder,
  stream,
  net,
  "source-map-support": undefined,
};

export function createRequire(_basePath: string) {
  return (path: string) => {
    path = path.replace(/^node:/, "");

    if (path in polyfills) {
      return polyfills[path as keyof typeof polyfills];
    }

    throw new Error("could not require: " + path);
  };
}
