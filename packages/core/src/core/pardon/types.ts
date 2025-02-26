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

import { PardonDatabase } from "../../db/sqlite.js";
import { PardonCompiler } from "../../runtime/compiler.js";
import { type PardonExecution } from "../execution/pardon-execution.js";
import {
  PardonExecutionContext,
  PardonExecutionInbound,
  PardonExecutionInit,
  PardonExecutionMatch,
  PardonExecutionOutbound,
  PardonExecutionResult,
} from "./pardon.js";
import { PardonCollection, Workspace } from "../../runtime/init/workspace.js";

export type PardonRuntime = {
  config: {
    root: string;
    collections: string[];
  };
  database?: PardonDatabase;
  collection: PardonCollection;
  compiler: PardonCompiler;

  samples?: string[];
  example?: Workspace["example"];
  execution: PardonExecution<
    PardonExecutionInit,
    PardonExecutionContext,
    PardonExecutionMatch,
    PardonExecutionOutbound,
    PardonExecutionInbound,
    PardonExecutionResult
  >;
};
