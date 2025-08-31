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
declare module "core-js-pure/actual/json/index.js" {
  type RawJSONType = { rawJSON: string };
  const defaults: {
    rawJSON(raw: string): RawJSONType;
    isRawJSON(value: any): value is RawJSONType;
    parse(
      value: string,
      deserializer?: (key: string, value: any, info: { source: string }) => any,
    ): any;
    stringify(
      value: unknown,
      replacer: undefined | null | ((key: string, value: any) => any),
      indent?: number | string,
    ): string;
  };
  export default defaults;
}
