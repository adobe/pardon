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
import { TracedResult } from "../../../features/trace.js";
import {
  HttpsFlowConfig,
  HttpsFlowScheme,
  HttpsRequestStep,
  HttpsResponseStep,
  HttpsScriptStep,
} from "../../formats/https-fmt.js";
import {
  PardonExecutionOutbound,
  PardonExecutionResult,
} from "../../pardon/pardon.js";
import { Schema } from "../../schema/core/types.js";
import { FlowContext } from "./data/flow-context.js";
import { FlowParamsDict } from "./flow-params.js";

export type SequenceReport = {
  type: "unit" | "flow";
  name: string;
  values: Record<string, any>;
  result?: Record<string, any>;
  error?: unknown;
  deps: SequenceReport[];
  steps: SequenceStepReport[];
  executions: TracedResult[];
};

export type SequenceStepReport = {
  outbound: Omit<PardonExecutionOutbound, "evaluationScope">;
  inbound: Omit<PardonExecutionResult["inbound"], "evaluationScope">;
  outcome?: { name: string; delay?: number };
  values: {
    send: Record<string, unknown>;
    recv: Record<string, unknown>;
    flow: Record<string, unknown>;
  };
  context: FlowContext;
};

type HttpInteractionCommon = {
  name?: string;
  retries?: number;
};

type HttpInteractionTypes = {
  script: {
    type: "script";
    script: HttpsScriptStep;
  };
  exchange: {
    type: "exchange";
    request: HttpsRequestStep;
    responses: HttpsResponseStep[];
  };
};

type HttpInteraction<type extends keyof HttpInteractionTypes> =
  HttpInteractionTypes[type] & HttpInteractionCommon;

export type HttpScriptInterraction = HttpInteraction<"script">;
export type HttpExchangeInterraction = HttpInteraction<"exchange">;

export type HttpsSequenceInteraction = HttpInteraction<
  keyof HttpInteractionTypes
>;

export type CompiledHttpsSequence = {
  scheme: HttpsFlowScheme;
  path: string;
  name: string;
  signature?: FlowParamsDict;
  schema: Schema<Record<string, unknown>>;
  interactionMap: Record<string, number>;
  interactions: HttpsSequenceInteraction[];
  tries: Record<number, number>;
  configuration: HttpsFlowConfig;
};
