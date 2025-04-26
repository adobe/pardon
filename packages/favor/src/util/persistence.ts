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

import { type PersistenceOptions } from "@solid-primitives/storage";
import { JSON } from "pardon/formats";

export const persistJson: Pick<
  PersistenceOptions<any, any>,
  "serialize" | "deserialize"
> = {
  serialize(data) {
    return JSON.stringify(data);
  },
  deserialize(data) {
    return JSON.parse(data);
  },
};
