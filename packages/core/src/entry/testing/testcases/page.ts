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
import { local } from "./core.js";
import { counter } from "./counter.js";
import { stop } from "./stop.js";

export function take(n: number): void {
  local(counter("taking")).export(stop(({ taking }) => taking >= n));
}

export function skip(n: number): void {
  local(counter("skipping")).export(stop(({ skipping }) => skipping < n));
}

export function page(n: number, { size }: { size: number }): void {
  skip((n - 1) * size);
  take(size);
}
