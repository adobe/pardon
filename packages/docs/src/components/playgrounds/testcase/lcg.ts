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

import { KV } from "pardon";

// random color values by value, to show patterns in the table
export function lcg(seed = 69, a = 524287n, c = 1337n, m = 2n ** 29n) {
  let next = BigInt(seed);

  return (n?: number) => Number((next = (next * a + c * BigInt(n ?? 1)) % m));
}

export function color(value: unknown) {
  const array = new TextEncoder().encode(KV.stringify(value));
  const digest = [...array.values()].reduce(
    (digest, b) => (digest(b), digest),
    lcg(),
  )();
  return `light-dark(hsl(${digest % 360}, 60%, 87%), hsl(${digest % 360}, 20%, 17%))`;
}
