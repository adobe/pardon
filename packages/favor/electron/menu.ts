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
  type MenuItemConstructorOptions,
  app,
  BrowserWindow,
  dialog,
  Menu,
} from "electron";
import { recreatePardonWorker } from "./pardon-worker-runner";

export function createMainMenu() {
  // https://www.electronjs.org/docs/latest/api/menu
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...((isMac
        ? ([
            {
              label: app.name,
              submenu: [
                { role: "about" },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ] as const)
        : []) as MenuItemConstructorOptions[]),
      {
        label: "File",
        submenu: [
          isMac ? { role: "close" } : { role: "quit" },
          { type: "separator" },
          {
            label: "Set Pardon Workspace",
            accelerator: "CommandOrControl+;",
            async click(_menuItem, browserWindow) {
              try {
                const { canceled, filePaths } = await dialog.showOpenDialog(
                  browserWindow,
                  {
                    properties: ["openDirectory"],
                  },
                );

                if (canceled) {
                  return;
                }

                const workspaceDirectory = filePaths[0];
                if (!workspaceDirectory) {
                  throw new Error("no directory selected!");
                }

                await recreatePardonWorker(
                  (browserWindow as BrowserWindow).webContents,
                  workspaceDirectory,
                );
              } catch (error) {
                console.error("error opening directory", error);
              }
            },
          },
        ],
      },
      {
        //role: 'editMenu',
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "delete" },
          { type: "separator" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
          {
            label: "Zen Mode",
            accelerator: "Meta+Option+Z",
            type: "checkbox",
            id: "zen-mode",
            click(menuItem, window) {
              (window as BrowserWindow).webContents.send(
                "pardon:zen-mode",
                menuItem.checked,
              );
            },
          },
        ],
      },
    ] as const),
  );
}
