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
import { runFlow } from "../core/execution/flow/flow-core.js";
import { compileHttpsFlow } from "../core/execution/flow/https-flow.js";
import { HTTP } from "../core/formats/http-fmt.js";
import { HttpsFlowScheme } from "../core/formats/https-fmt.js";

import {
  PardonExecutionContext,
  PardonExecutionInit,
} from "../core/pardon/pardon.js";
import { PardonRuntime } from "../core/pardon/types.js";
import type { SimpleRequestInit } from "../core/request/fetch-object.js";
import { intoURL } from "../core/request/url-object.js";
import { FlowContext } from "../modules/api.js";
import { HTTPS } from "../modules/formats.js";
import { pardonRuntime } from "../runtime/runtime-deferred.js";

export type PardonOptions = {
  unmatched?: boolean;
  pretty?: boolean;
  parsecurl?: boolean;
};

let runtime: PardonRuntime;
pardonRuntime().then((runtime_) => (runtime = runtime_));

type FetchArgs =
  | [URL | string]
  | [URL | string, SimpleRequestInit | undefined]
  | [
      URL | string,
      SimpleRequestInit | undefined,
      Partial<PardonExecutionContext> | undefined,
    ];

export function pardon(
  values: Record<string, any> = {},
  executionContext?: Omit<Partial<PardonExecutionContext>, "values">,
) {
  if (!runtime) {
    throw new Error("pardon: no pardon runtime context loaded");
  }

  return pardonExecutionHandle({
    context: {
      app: () => runtime,
      durations: {},
      timestamps: {},
      values,
      ...executionContext,
    },
    execution: runtime.execution,
  });
}

// const { ... } = pardon.flow`....`({ ... })
Object.assign(pardon, {
  flow: (template: TemplateStringsArray, ...args: unknown[]) => {
    const https = String.raw(template, ...args);
    const flowScheme = HTTPS.parse(https, "flow") as HttpsFlowScheme;
    const flow = compileHttpsFlow(flowScheme, {
      name: "script",
      path: "pardon:script",
    });

    return async (input: Record<string, string>, context?: FlowContext) => {
      const { result } = await runFlow(flow, input, context);
      return result;
    };
  },
});

export function pardonExecutionHandle({
  context,
  execution,
}: {
  context: PardonExecutionContext;
  execution: PardonRuntime["execution"];
}) {
  const http = (template: TemplateStringsArray, ...args: unknown[]) => {
    const http = String.raw(template, ...args);
    const { values, ...request } = HTTP.parse(http, {
      acceptcurl: context.options?.parsecurl,
    });

    function initiate() {
      return execution.init({
        ...context,
        url: intoURL(request),
        init: {
          ...request,
        },
        values: Object.assign({}, values, context.values ?? {}),
      });
    }

    return Object.assign(
      () => {
        return initiate().result;
      },
      {
        init() {
          return initiate();
        },
        preview() {
          return initiate().preview;
        },
        render() {
          return initiate().egress;
        },
        async request() {
          return (await initiate().egress).request;
        },
      },
    );
  };

  function fetchExecutionInit(
    ...[url, init, extra]: FetchArgs
  ): PardonExecutionInit {
    return {
      ...extra,
      url: url?.toString(),
      init: {
        ...init,
        headers: new Headers(init?.headers),
      },
      values: Object.assign({}, context.values ?? {}),
      options: {
        ...context?.options,
        ...extra?.options,
      },
      app: context.app,
    };
  }

  return Object.assign(http, {
    match(...[url, init, extra]: FetchArgs) {
      return execution.match(fetchExecutionInit(url, init, extra));
    },
    preview(...[url, init, extra]: FetchArgs) {
      return execution.preview(fetchExecutionInit(url, init, extra));
    },
    render(...[url, init, extra]: FetchArgs) {
      return execution.render(fetchExecutionInit(url, init, extra));
    },
    fetch(...[url, init, extra]: FetchArgs) {
      return execution.process(fetchExecutionInit(url, init, extra));
    },
  });
}

export function template(source: string) {
  if (!runtime) {
    throw new Error("pardon: no pardon runtime context loaded");
  }

  function init(
    values: Record<string, any>,
    extra?: Partial<PardonExecutionContext>,
  ) {
    return pardon(values, extra)`${source}`;
  }

  return Object.assign(
    (values: Record<string, any>, extra: Partial<PardonExecutionContext>) => {
      return init(values, extra)();
    },
    {
      request(
        values: Record<string, any>,
        extra: Partial<PardonExecutionContext>,
      ) {
        return init(values, extra).request();
      },
    },
  );
}
