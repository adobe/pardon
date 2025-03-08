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

import { contextBridge, ipcRenderer } from "electron";
import { type PardonWorkerHandlers } from "./pardon-worker.js";

type TestStepPayloads = any;
type TracingHookPayloads = any;

const initialSettings = new Promise<Preferences>((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject("timeout");
  }, 5000);

  ipcRenderer.on("settings", (_event, settings: { cwd?: string }) => {
    clearTimeout(timeout);
    resolve(settings);
  });
});

const pardonWorkerApi: PardonWorkerHandlers = {
  async preview(http, input, options) {
    if (!http && !input?.endpoint) {
      throw "";
    }
    return await invokePardonWorker("preview", http, input, options);
  },
  async render(http, input, options) {
    if (!http && !input?.endpoint) {
      throw "";
    }
    return await invokePardonWorker("render", http, input, options);
  },
  async continue(handle) {
    return await invokePardonWorker("continue", handle);
  },
  async dispose(handle) {
    return invokePardonWorker("dispose", handle);
  },
  async manifest() {
    return invokePardonWorker("manifest");
  },
  async samples() {
    return invokePardonWorker("samples");
  },
  async resolvePath(path) {
    return invokePardonWorker("resolvePath", path);
  },
  async archetype(httpsMaybe) {
    return invokePardonWorker("archetype", httpsMaybe);
  },
  async recall(keys, other, limit) {
    return invokePardonWorker("recall", keys, other, limit);
  },
  async flow(name, input) {
    return invokePardonWorker("flow", name, input);
  },
};

let updateManifestCb: (
  manifest: ReturnType<PardonWorkerHandlers["manifest"]>,
) => void | Promise<void>;

// THIS IS BRIDGE
const pardonElectronApi = {
  ...pardonWorkerApi,
  async reload() {
    try {
      await ipcRenderer.invoke("repardon");

      return updateManifestCb(pardonWorkerApi.manifest());
    } catch (cause) {
      console.error("invoke error", cause);
      ipcRenderer.invoke("error", {
        flow: "loading collection",
        cause,
      });
      throw cause;
    }
  },
  async shellShowFile(file: string) {
    const resolvedFile = await pardonWorkerApi.resolvePath(file);
    console.info("showing file", resolvedFile);
    return await ipcRenderer.invoke("shell:show-file", resolvedFile);
  },
  async setConfig(path: string) {
    console.info("preload:setConfig", path);
    await ipcRenderer.invoke("pardon:set-config", path);
    return invokePardonWorker("manifest");
  },
  async saveFile(path: string, content: string, reload?: boolean) {
    console.info("preload:saveFile", path);
    await ipcRenderer.invoke("pardon:save-file", path, content);
    if (reload) {
      await pardonElectronApi.reload();
    }
  },
  resetManifestWith(updateManifest: typeof updateManifestCb) {
    updateManifestCb = updateManifest;
  },
  settings: initialSettings,
  registerHistoryForwarder(forwarder: typeof pardonHistoryFowarder) {
    pardonHistoryFowarder = forwarder;
  },
  registerTestSystemForwarder(forwarder: typeof pardonTestSystemFowarder) {
    pardonTestSystemFowarder = forwarder;
  },
};

export type PardonElectronApi = typeof pardonElectronApi;

contextBridge.exposeInMainWorld("pardon", pardonElectronApi);

let pardonHistoryFowarder:
  | undefined
  | {
      [Callback in keyof TracingHookPayloads]: (
        trace: number,
        data: TracingHookPayloads[Callback]["trace"],
      ) => void;
    };

let pardonTestSystemFowarder:
  | undefined
  | {
      [Id in keyof TestStepPayloads]: (data: TestStepPayloads[Id]) => void;
    };

ipcRenderer.addListener("trace:rendering", (_event, data) => {
  pardonHistoryFowarder?.onRenderStart(data.trace, data);
});

ipcRenderer.addListener("trace:rendered", (_event, data) => {
  pardonHistoryFowarder?.onRenderComplete(data.trace, data);
});

ipcRenderer.addListener("trace:sent", (_event, data) => {
  pardonHistoryFowarder?.onSend(data.trace, data);
});

ipcRenderer.addListener("trace:completed", (_event, data) => {
  pardonHistoryFowarder?.onResult(data.trace, data);
});

ipcRenderer.addListener("trace:error", (_event, message) => {
  pardonHistoryFowarder?.onError(message.trace, message);
});

ipcRenderer.addListener("test:event", (_event, message) => {
  pardonTestSystemFowarder?.[
    (message as TestStepPayloads[keyof TestStepPayloads]).type
  ]?.(message as any);
});

ipcRenderer.addListener("pardon:lifecycle", async (_event, message) => {
  switch (message) {
    case "worker":
      return updateManifestCb?.(pardonWorkerApi.manifest());
  }
});

// typesafety
function invokePardonWorker<Action extends keyof PardonWorkerHandlers>(
  action: Action,
  ...args: Parameters<PardonWorkerHandlers[Action]>
): ReturnType<PardonWorkerHandlers[Action]> {
  return ipcRenderer.invoke("pardon", action, ...args) as any;
}
