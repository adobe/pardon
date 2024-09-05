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

import { BrowserWindow, ipcMain, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { preferences, savePreferences } from "./preferences";

function resolveRelative(path) {
  return new URL(import.meta.resolve(path)).pathname.replace(
    // be friendlier to windows /C:/xyz/... paths.
    /[/\\]([A-Z]):([/\\])/,
    "$1:$2",
  );
}

let currentPardonWorker: Promise<Worker>;

const inflight: Record<string, (arg: PromiseSettledResult<unknown>) => void> =
  {};

export async function recreatePardonWorker(
  webContents: WebContents,
  cwd?: string,
) {
  await (currentPardonWorker = createPardonWorker(webContents, cwd));
  return;
}

async function createPardonWorker(webContents: WebContents, cwd?: string) {
  const previousWorker = currentPardonWorker;
  currentPardonWorker = undefined;

  for (const abandon of Object.values(inflight)) {
    abandon({ status: "rejected", reason: "reset" });
  }

  const termination = await (await previousWorker)?.terminate();

  if (previousWorker !== undefined) {
    console.info(
      "createPardonWorker: terminated previous worker with exit code",
      termination,
    );
  }

  if (cwd) {
    console.log("createPardonWorker: updating preferences with cwd", cwd);
    savePreferences({ cwd });
  }

  const newWorker = new Worker(resolveRelative("./pardon-worker.js"), {
    name: "pardon-worker",
    argv: [preferences().cwd],
    resourceLimits: {
      stackSizeMb: 10,
    },
  });

  newWorker.on("message", ({ id, ...data }: any) => {
    if (id.startsWith("trace:")) {
      webContents.postMessage(id, data.trace);
      return;
    }

    if (id == "test:event") {
      webContents.postMessage(id, data);
      return;
    }

    inflight[id]?.(data);
  });

  const worker = await (currentPardonWorker = Promise.resolve(newWorker));

  webContents.postMessage("pardon:lifecycle", "worker");

  return worker;
}

export async function initPardonWorker(browser: BrowserWindow) {
  ipcMain.handle("repardon", (_event, cwd?: string) => {
    return recreatePardonWorker(browser.webContents, cwd);
  });

  ipcMain.handle("pardon", (_event, action: string, ...args: unknown[]) => {
    const id = randomUUID();

    const promise = new Promise((resolve, reject) => {
      inflight[id] = (result) => {
        if (result.status === "fulfilled") {
          resolve(result.value);
        } else {
          reject(result.reason);
        }
      };
    }).finally(() => {
      delete inflight[id];
    });

    promise.catch(() => {});

    currentPardonWorker?.then((worker) =>
      worker.postMessage({ id, action, args }),
    );

    return promise;
  });
}
