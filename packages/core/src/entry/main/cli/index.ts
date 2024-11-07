#!/usr/bin/env -S node --enable-source-maps --stack-trace-limit=69
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
import * as YAML from "yaml";

import { opts, processOptions } from "./options.js";
import { initializePardon } from "../../../runtime/runtime.js";

import { pardon } from "../../../api/pardon-wrapper.js";
import { disarm } from "../../../util/promise.js";

import { PardonError } from "../../../core/error.js";
import { HTTP } from "../../../core/formats/http-fmt.js";
import { CURL } from "../../../core/formats/curl-fmt.js";

import { recall } from "./recall.js";
import trace from "../../../features/trace.js";
import remember from "../../../features/remember.js";
import { inspect } from "node:util";
import { mapObject } from "../../../util/mapping.js";
import { KV } from "../../../core/formats/kv-fmt.js";

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

function exceptBody({ body, ...values }: Record<string, unknown>) {
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

  const { url, init, values } = await processOptions(options, ...args);

  const context = await initializePardon({ environment: values }, [
    trace,
    remember,
  ]);

  if (options["show-root"]) {
    console.info(context.config.root);

    return 0;
  }

  if (options.recall) {
    recall(context, options.recall.split(","), scalars(values));

    return 0;
  }

  if (options.offline || options.curl || options.http) {
    options.secrets ??= false;
  }

  const rendering = disarm(
    options.offline
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

  if (options.offline || options.curl || options.http || options.render) {
    const { request, redacted } = await rendering;
    const rendered = options.secrets ? request : redacted;

    if (options.json) {
      console.info(JSON.stringify(exceptBody(rendered.values), null, 2));
    } else if (options.curl) {
      if (options.values) {
        const values = KV.stringify(rendered.values, "\n", 2)
          .split("\n")
          .map((line) => `# ${line}\n`)
          .join("");
        console.info(`${values}${CURL.stringify(rendered, options)}`);
      } else {
        console.info(CURL.stringify(rendered, options));
      }
    } else if (options.values && !options.http) {
      console.info(KV.stringify(rendered.values, "\n", 2));
    } else {
      console.info(
        HTTP.stringify({
          ...rendered,
          ...(!options.values && { values: undefined }),
        }),
      );
    }

    if (options.timing) {
      const context = await rendering.context;
      console.warn('-- timing\n' + KV.stringify(context.durations, "\n", 2));
    }
  } else {
    const {
      inbound: { values, secrets, response, redacted },
    } = await rendering.result;

    const kv = options.secrets ? secrets : values;
    if (options.json) {
      console.info(JSON.stringify(exceptBody(kv), null, 2));

      return 0;
    }

    const result = options.secrets ? response : redacted;

    if (options.values) {
      console.info(
        `${KV.stringify(kv, "\n", 2, "\n")}${HTTP.responseObject.stringify(result)}`,
      );
    } else if (options.include) {
      console.info(HTTP.responseObject.stringify(result));
    } else {
      console.info(result.body);
    }

    if (options.timing) {
      const context = await rendering.context;
      console.warn('-- timing\n' + KV.stringify(context.durations, "\n", 2));
    }
  }

  process.exit(0);
}
