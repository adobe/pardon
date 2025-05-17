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

interface BufferShimConstructor {
  new (value: string, format: "base64" | "utf-8"): BufferShim;
}

interface BufferShim {
  toString(format: "base64" | "utf-8"): string;
}

export const Buffer = function Buffer(
  this: BufferShim & { value: string; format: string },
  value: string,
  format: "base64" | "utf-8",
) {
  this.value = value;
  this.format = format;
} as any as BufferShimConstructor;

Object.assign(Buffer, {
  from(value: string, format: "base64" | "utf-8") {
    return new Buffer(value, format);
  },
});

Buffer.prototype.toString = function (format: "base64" | "utf-8") {
  if (this.format === format) {
    return this.value;
  } else if (format === "base64") {
    return btoa(this.value);
  } else {
    return atob(this.value);
  }
};
