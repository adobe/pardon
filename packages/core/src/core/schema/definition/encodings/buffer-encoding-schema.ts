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
import { EncodingType } from "./encoding-schema.js";

export type TextBufferEncoding = Exclude<BufferEncoding, "binary">;

type EncodingOptions = {
  inner: TextBufferEncoding;
  outer: TextBufferEncoding;
};

export function bufferEncoding({
  inner,
  outer,
}: EncodingOptions): EncodingType<string, string> {
  return {
    encode(output) {
      return output && Buffer.from(output, inner).toString(outer);
    },
    decode({ stub: input }) {
      return input && Buffer.from(input, outer).toString(inner);
    },
  };
}
