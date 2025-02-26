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
import { createIpcReceiver } from "./ipc.js";
import createCompiler from "../../compiler.js";
import { PardonRuntime } from "../../../core/pardon/types.js";

let localPort: MessagePort;

// hack that allows the unit tests to work.
// TODO: file issue on nodejs
export function unregisterPardonLoader() {
  localPort.onmessage = null;
}

export async function registerPardonLoader(
  appContext: Omit<PardonRuntime, "execution">,
) {
  const { Module } = await import("node:module");

  if (!Module.register) {
    throw new Error(
      `the node runtime is missing "node:module".register, please the legacy-rpc-loader instead`,
    );
  }

  const { port1, port2 } = new MessageChannel();

  localPort = port2;

  const receiverReady = createIpcReceiver(port2, createCompiler(appContext));

  /** registers src/modules/loader.ts */
  Module.register("./loader.js", import.meta.url, {
    parentURL: import.meta.url,
    data: { port: port1 },
    transferList: [port1],
  });

  await receiverReady;
}
