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

import "source-map-support/register";

import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

import { app, BrowserWindow, dialog, ipcMain, shell, screen } from "electron";
import {
  initPardonWorker,
  recreatePardonWorker,
} from "./pardon-worker-runner.js";
import { createMainMenu } from "./menu.js";
import { preferences } from "./preferences.js";
import { createComputed, createRoot } from "solid-js";

createMainMenu();

// trying to get better stacks
app.commandLine.appendSwitch("js-flags", "--stack_trace_limit=100");

let mainWindow: BrowserWindow | null;

function resolveRelative(path: string) {
  return new URL(import.meta.resolve(path)).pathname.replace(
    // be friendlier to windows /C:/xyz/... paths.
    /[/\\]([A-Z]):([/\\])/,
    "$1:$2",
  );
}

const PUBLIC = resolveRelative(`../renderer/${MAIN_WINDOW_VITE_NAME}/`);

function createWindow() {
  const { bounds } = screen.getPrimaryDisplay();

  mainWindow = new BrowserWindow({
    icon: join(PUBLIC, "electron-vite.svg"),
    minWidth: 600,
    minHeight: 400,
    width: ((bounds.width * 4) / 5) | 0,
    height: ((bounds.height * 4) / 5) | 0,
    webPreferences: {
      contextIsolation: true,
      preload: resolveRelative("./preload.cjs"),
    },
  });

  initPardonWorker(mainWindow);

  // Test active push message to Renderer-process.
  mainWindow.webContents.on("did-finish-load", () => {
    createRoot((dispose) => {
      createComputed(() => {
        mainWindow.webContents.send("settings", preferences());
      });

      mainWindow.on("closed", () => {
        dispose();
      });
    });
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    mainWindow.loadFile(join(PUBLIC, "index.html"));
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    mainWindow = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function initBindings() {
  ipcMain.handle("shell:show-file", (_event, href: string) => {
    console.info("ipc-main: shell:show-file", href);
    const { pathname } = new URL(href);
    return shell.showItemInFolder(pathname.replace(/^[/\\]([A-Z]:)/, "$1"));
  });

  ipcMain.handle("pardon:set-config", (_event, path: string) => {
    console.info("ipc-main: pardon:set-config", path);
    return recreatePardonWorker(_event.sender, path);
  });

  ipcMain.handle(
    "pardon:save-file",
    (_event, path: string, content: string) => {
      console.info(
        "ipc-main: pardon:save-file",
        path,
        `${content.slice(0, 10).split("\n").join("")}...`,
      );
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf-8");
    },
  );

  ipcMain.handle("error", async (_event, { flow, cause }) => {
    dialog.showErrorBox(`Error ${flow}`, cause.stack);
  });
}

app
  .whenReady()
  .then(() => initBindings())
  .then(() => createWindow());
