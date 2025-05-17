#!/usr/bin/env -S node --enable-source-maps --stack-trace-limit=69 --no-warnings=ExperimentalWarning
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
import * as YAML from "yaml";

import { opts, processOptions } from "./options.js";
import { initializePardon } from "../../../runtime/initialize.js";

import { pardon } from "../../../api/pardon-wrapper.js";
import { disarm } from "../../../util/promise.js";

import { PardonError } from "../../../core/error.js";
import { HTTP } from "../../../core/formats/http-fmt.js";
import { CURL } from "../../../core/formats/curl-fmt.js";

import { recall } from "./recall.js";
import trace from "../../../features/trace.js";
import persist from "../../../features/persist.js";
import undici from "../../../features/undici.js";
import { inspect } from "node:util";
import { mapObject } from "../../../util/mapping.js";
import { KV } from "../../../core/formats/kv-fmt.js";
import { executeFlowInContext } from "../../../core/execution/flow/index.js";
import { initTrackingEnvironment } from "../../../runtime/environment.js";
import { JSON } from "../../../core/raw-json.js";
import contentEncodings from "../../../features/content-encodings.js";
import { resolve } from "node:path";

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    if (error instanceof PardonError) {
      console.warn(error.message);
      process.exit(1);
    }

    console.error("unexpected error: " + inspect(error, { depth: Infinity }));
    process.exit(1);
  });

function exceptBody<T extends { body?: unknown }>({ body, ...values }: T) {
  return values;
}

function scalars(values: Record<string, unknown>): Record<string, string> {
  return mapObject(values, {
    filter: (_, value) => !value || typeof value !== "object",
    values: (value) => String(value),
  });
}

async function main() {
  const { positionals: args = [], values: options } = opts();
  if (options.help) {
    console.info(
      `
usage
-----
[making requests]
  pardon "https://any.url"
  pardon "POST https://any.url" --data="..."
  pardon request.http
  pardon endpoint=service/action key=value

[previewing requests in curl format]
  pardon ... --curl
[previewing requests in http]
  pardon ... --http
[show secrets (in responses or previews)]
  pardon ... --secrets
`.trim(),
    );
  }

  const {
    flow: flowName,
    url,
    init,
    values,
  } = await processOptions(options, ...args);

  const context = await initializePardon(
    { environment: values, cwd: options.cwd },
    [undici, contentEncodings, trace, persist],
  );

  if (options["show-root"]) {
    console.info(context.config.root);

    return 0;
  }

  if (options.recall) {
    await recall(context, options.recall.split(","), scalars(values), {
      args,
    });

    return 0;
  }

  if (options.preview || options.curl || options.http) {
    options.secrets ??= false;
  }

  if (flowName) {
    initTrackingEnvironment();
    const flowContext = context.createFlowContext();
    const { context: resultContext } = await executeFlowInContext(
      flowName,
      values,
      flowContext,
    );
    if (options.json) {
      console.info(
        KV.stringify(resultContext.environment, { indent: 2, mode: "json" }),
      );
    } else {
      console.info(KV.stringify(resultContext.environment, { indent: 2 }));
    }
    return;
  }

  if (options["run-script"]) {
    const script = options["run-script"];

    await initTrackingEnvironment();
    environment = values;

    try {
      const { default: defaultExport, main } = await import(
        resolve(process.cwd(), script)
      );
      if (typeof defaultExport === "function") {
        await defaultExport(values);
      } else if (typeof main === "function") {
        await main(values);
      }
    } catch (ex) {
      console.warn(`${script}: failed to execute`, ex);
      return 1;
    }

    return 0;
  }

  const rendering = disarm(
    options.preview
      ? pardon(values).preview(url!, init, { options })
      : pardon(values).render(url!, init, { options }),
  );

  if (options["show-config"]) {
    const {
      endpoint: {
        configuration: { name: endpoint_, ...configuration },
        layers: flow,
        action,
        service,
        ...endpoint
      },
    } = await rendering.match;

    console.info(`---
${YAML.stringify({
  service,
  action,
  endpoint: endpoint_,
  configuration: mapObject(configuration, {
    filter: (_, value) =>
      (!value ||
        typeof value !== "object" ||
        Object.keys(value).length !== 0) &&
      typeof value !== "function",
  }),
  ...endpoint,
})}`);

    return 0;
  }

  if (options.preview || options.curl || options.http || options.render) {
    const { request, redacted } = await rendering;
    const rendered = options.secrets ? request : redacted;

    if (options.json) {
      console.info(JSON.stringify(exceptBody(rendered.values ?? {}), null, 2));
    } else if (options.curl) {
      if (options.values) {
        const values = KV.stringify(rendered.values, { indent: 2 })
          .split("\n")
          .map((line) => `# ${line}\n`)
          .join("");
        console.info(`${values}${CURL.stringify(rendered, options)}`);
      } else {
        console.info(CURL.stringify(rendered, options));
      }
    } else if (options.values && !options.http) {
      console.info(KV.stringify(rendered.values, { indent: 2 }));
    } else {
      console.info(
        HTTP.stringify({
          ...rendered,
          ...{ meta: undefined },
          ...(!options.values && { values: undefined }),
        }),
      );
    }

    if (options.timing) {
      const context = await rendering.context;
      console.warn(
        "-- timing\n" + KV.stringify(context.durations, { indent: 2 }),
      );
    }
  } else {
    const {
      ingress: { values, secrets, response, redacted },
    } = await rendering.result;

    const kv = options.secrets ? secrets : values;
    if (options.json) {
      console.info(KV.stringify(exceptBody(kv), { indent: 2, mode: "json" }));

      return 0;
    }

    const result = options.secrets ? response : redacted;

    if (options.values) {
      if (options.json) {
        console.info(JSON.stringify(kv, null, 2));
      } else {
        console.info(
          `${KV.stringify(kv, { indent: 2, trailer: "\n" })}${HTTP.responseObject.stringify(result)}`,
        );
      }
    } else if (options.include) {
      console.info(HTTP.responseObject.stringify(result));
    } else {
      console.info(result.body);
    }

    if (options.timing) {
      const context = await rendering.context;
      console.warn("-- timing\n" + KV.stringify(context.durations));
    }
  }

  process.exit(0);
}
