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

import { HTTP } from "../../formats/http-fmt.js";
import { HttpsRequestStep } from "../../formats/https-fmt.js";
import { PardonRuntime } from "../../pardon/types.js";
import { FlowFunction, makeFlow } from "./flow-core.js";
import { compileHttpsFlow } from "./https-flow.js";

export async function loadFlows({
  collection: { scripts, flows, endpoints, assets, errors },
}: PardonRuntime<"loading">) {
  for (const [name, sources] of Object.entries(scripts.resolutions).filter(
    ([name]) => name.endsWith(".flow"),
  )) {
    const module = await import(name);
    const funEntries = Object.entries(module).filter(
      ([, v]) => typeof v === "function",
    ) as [string, FlowFunction][];

    for (const [flowKey, flowFn] of funEntries) {
      const flow = makeFlow(flowFn);

      const prefix = name.replace(/^pardon:/, "");
      const flowName =
        flowKey === "default"
          ? prefix
          : `${prefix.replace(/[.]flow$/, "")}/${flowKey}.flow`;

      if (flows[flowName]) {
        errors.push(
          ...sources.map(({ path }) => ({
            error: `flow ${flowName}: already defined`,
            path,
          })),
        );
      }

      flows[flowName] = flow;
    }
  }

  for (const [name, endpoint] of Object.entries(endpoints)) {
    if (!endpoint.configuration.flow) {
      continue;
    }

    const flowName = `${name.replace(/[.]https$/, "")}.flow`;

    if (flows[flowName]) {
      errors.push(
        ...(
          assets[endpoint.configuration.name]?.sources ?? [{ path: "?" }]
        ).map(({ path }) => ({
          error: `flow ${flowName}: already defined`,
          path,
        })),
      );
    }

    flows[flowName] = compileHttpsFlow(
      {
        configuration: endpoint.configuration.flow,
        mode: "flow",
        steps: [
          {
            type: "request",
            values: {
              endpoint: endpoint.configuration.name,
            },
            request: { headers: new Headers() },
            computations: {},
            variant: "",
            source: `
>>> inline ${endpoint.configuration.name}
${HTTP.stringify((endpoint.layers[0].steps[0] as HttpsRequestStep).request)}
`.trim(),
          },
        ],
      },
      { name, path: "#" },
    );
  }
}
