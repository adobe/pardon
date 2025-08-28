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

import { disarm } from "../../../util/promise.js";
import { FlowName, HTTPS, HttpsFlowScheme } from "../../formats/https-fmt.js";
import type { FlowContext } from "./flow-context.js";
import {
  Flow,
  currentFlowContext,
  FlowResult,
  runFlow,
  FlowFunction,
  FlowParams,
} from "./flow-core.js";
import { compileHttpsFlow, executeHttpsFlowInContext } from "./https-flow.js";
export type {
  FlowParam,
  FlowParamsDict,
  FlowParamsList,
  FlowParamsItem,
} from "./flow-params.js";

export type {
  Flow,
  FlowContext,
  FlowName,
  FlowResult,
  FlowFunction,
  FlowParams,
};

let flowHook: <T>(p: Promise<T>) => Promise<T> = (p) => p;

export function registerFlowHook(hook: typeof flowHook) {
  flowHook = hook;
}

export function flow(
  name: FlowName,
  input?: Record<string, unknown>,
  context?: FlowContext,
): Promise<Record<string, any>>;
export function flow(
  input?: Record<string, unknown>,
  context?: FlowContext,
): (
  template: TemplateStringsArray,
  ...args: any
) => Promise<Record<string, any>>;
export function flow(
  nameOrInput: FlowName | Record<string, unknown> | undefined,
  ...args: any
) {
  if (typeof nameOrInput === "string") {
    const [input, context] = args;
    return disarm(flowHook(__flow(nameOrInput, input, context)));
  }

  const [context] = args;

  return (template: TemplateStringsArray, ...args: any) => {
    const content = String.raw({ raw: template }, ...args);

    const scheme = HTTPS.parse(content, "flow") as HttpsFlowScheme;
    scheme.configuration ??= {};
    scheme.configuration.context ??= Object.keys(nameOrInput ?? {});

    const flow = compileHttpsFlow(scheme, {
      path: "inline",
      name: "inline.flow",
    });

    return disarm(
      flowHook(runFlow(flow, nameOrInput ?? {}, context)).then(
        ({ result }) => result,
      ),
    );
  };
}

async function __flow(
  name: FlowName,
  input?: Record<string, unknown>,
  context?: FlowContext,
) {
  context ??= await currentFlowContext(context);
  const { result } = await executeHttpsFlowInContext(
    name,
    input ?? {},
    context,
  );
  return result;
}
