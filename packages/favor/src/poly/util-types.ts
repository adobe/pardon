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

export function isNumberObject(n: any) {
  return n && typeof n === "object" && n instanceof Number;
}

export function isBigIntObject(n: any) {
  return n && typeof n === "object" && n instanceof BigInt;
}

export function isBoxedPrimitive(n: any) {
  return (
    n &&
    typeof n === "object" &&
    (n instanceof Number ||
      n instanceof BigInt ||
      n instanceof Boolean ||
      n instanceof String)
  );
}
