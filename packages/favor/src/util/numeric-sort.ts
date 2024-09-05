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

export function numericKeySort(
  [k]: [string, ...unknown[]],
  [m]: [string, ...unknown[]],
) {
  const kn = k.split(/(\d+)/);
  const mn = m.split(/(\d+)/);

  while (kn.length && mn.length) {
    const ki = kn.shift();
    const mi = mn.shift();
    let d = ki.localeCompare(mi);
    if (d) {
      return d;
    }

    if (kn.length && mn.length) {
      const kd = Number(kn.shift());
      const md = Number(mn.shift());
      d = kd - md;
      if (d) return d;
    }
  }

  return (kn.shift() ?? "").localeCompare(mn.shift() ?? "");
}
