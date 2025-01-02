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

export function join(...parts: string[]) {
  return normalize(parts.join("/"));
}

function normalizeParts(path: string): string[] {
  const absolute = path.startsWith("/");

  const parts = path.split("/").reduce<string[]>((parts, part) => {
    if (part == "..") {
      if (parts.length && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else {
        parts.push("..");
      }
    } else if (part !== ".") {
      parts.push(part);
    }

    return parts;
  }, []);

  return parts.length || absolute ? parts : ["."];
}

export function relative(from: string, to: string) {
  if (!from.startsWith("/") != !to.startsWith("/")) {
    console.warn("cannot correlate absolute and relative paths");

    return to;
  }

  const base = normalizeParts(from);
  const target = normalizeParts(to);

  while (base.length && target.length && base[0] === target[0]) {
    base.shift();
    target.shift();
  }

  const relative = [...base.map(() => ".."), ...target].join("/");

  return relative;
}

export function resolve(...paths: string[]) {
  const resolved = paths.reduce((current, path) => {
    const parts = normalizeParts(path);
    if (parts.length > 1 && parts[0] == "") {
      return parts.join("/");
    }

    return [current, ...parts].join("/");
  }, ".");

  return normalizeParts(resolved).join("/");
}

export function dirname(path: string) {
  return path.replace(/[/]([^/]*([/]$)?)$/, "");
}

export function normalize(path: string) {
  return resolve(path);
}

export function basename(path: string) {
  return path.replace(/^.*[/]/, "");
}

export const sep = "/";

export const posix = {
  join,
  resolve,
  relative,
  normalize,
  basename,
  sep,
};

export const win32 = {};

export default {
  join,
  relative,
  resolve,
  win32,
  posix,
  sep,
  normalize,
  basename,
};
