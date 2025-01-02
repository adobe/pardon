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

export * as promises from "./fs_promises.js";

export function stat(_path: string, options: any, cb: (err: Error) => void) {
  (typeof cb === "function" ? cb : options)(new Error("unimplemented"));
}

export function lstat(_path: string, options: any, cb: (err: Error) => void) {
  (typeof cb === "function" ? cb : options)(new Error("unimplemented"));
}

export function readlink(_path: string, cb: (err: Error) => void) {
  cb(new Error("unimplemented"));
}

export function realpath(_path: string, cb: (err: Error) => void) {
  cb(new Error("unimplemented"));
}

export function realpathSync(_path: string) {
  throw new Error("unimplemented");
}

export function statSync() {
  throw new Error("unimplemented");
}

export function lstatSync() {
  throw new Error("unimplemented");
}

export function readlinkSync() {
  throw new Error("unimplemented");
}

export function readFile(cb: (err: Error) => void) {
  cb(new Error("unimplemented"));
}

export function readFileSync() {
  throw new Error("unimplemented");
}

export function readdirSync() {
  return [];
}

export function readdir(
  _path: string,
  cb: (err: never | undefined, result: never[]) => void,
) {
  cb(undefined!, []);
}

export function createReadStream(_path: string, _options?: any) {
  throw new Error("createReadStream unsupported");
}

export default {
  readFile,
  readFileSync,
  lstat,
  lstatSync,
  stat,
  statSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  realpath,
  realpathSync,
  createReadStream,
};
