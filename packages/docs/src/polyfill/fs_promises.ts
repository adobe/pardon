/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.


@ts-no-check
*/

export async function stat(_path: string) {
  throw new Error("unimplemented");
}

export async function lstat(_path: string) {
  throw new Error("unimplemented");
}

export async function readdir(_path: string) {
  return [];
}

export async function realpath(path: string) {
  return path;
}

export async function readlink(_path: string) {
  throw new Error("unimplemented");
}

export async function readFile(_path: string) {
  throw new Error("unimplemented");
}

export default { readdir, lstat, realpath, readlink, readFile };
