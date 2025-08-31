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
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { HTTP, type RequestObject } from "../../../core/formats/http-fmt.js";
import { PardonError } from "../../../core/error.js";
import { arrayIntoObject, mapObject } from "../../../util/mapping.js";
import { intoURL, parseURL } from "../../../core/request/url-object.js";
import { extractKVs } from "../../../util/kv-options.js";
import { JSON } from "../../../core/raw-json.js";

export type CommandOptions = ReturnType<typeof opts>["values"];

export function opts() {
  return parseArgs({
    allowPositionals: true,
    options: {
      recall: {
        type: "string",
        short: "w",
      },
      include: {
        type: "boolean",
        short: "i",
      },
      cwd: {
        type: "string",
      },
      // specify that output should not be reformated (JSON / form output).
      raw: {
        type: "string",
      },
      // turns of most expression evaluation when rendering
      preview: {
        type: "boolean",
        short: "n",
      },
      env: {
        type: "string",
        short: "E",
      },
      header: {
        type: "string",
        multiple: true,
        short: "H",
      },
      pardon: {
        type: "boolean",
      },
      "show-root": {
        type: "boolean",
      },
      "show-config": {
        type: "boolean",
      },
      curl: {
        type: "boolean",
      },
      http: {
        type: "boolean",
      },
      secrets: {
        type: "boolean",
      },
      data: {
        type: "string",
        short: "d",
      },
      "data-raw": {
        type: "string",
      },
      unmatched: {
        type: "boolean",
      },
      // curl compatibility only
      location: {
        // pardon doesn't do anything with this,
        // but it is repeated in generated --curl commands.
        type: "boolean",
        short: "L",
      },
      request: {
        type: "string",
        short: "X",
      },
      values: {
        type: "boolean",
      },
      json: {
        type: "boolean",
      },
      render: {
        type: "boolean",
      },
      timing: {
        short: "T",
        type: "boolean",
      },
      "run-script": {
        type: "string",
      },
      help: {
        short: "h",
        type: "boolean",
      },
    },
  });
}

export async function processOptions(
  {
    data,
    "data-raw": dataRaw,
    header: headers,
    request: method,
  }: CommandOptions,
  ...args: string[]
) {
  const values = arrayIntoObject(extractKVs(args, true), ([k, v]) => ({
    [k]: v,
  }));

  if (/^[A-Z]+$/.test(args[0])) {
    if (method !== undefined) {
      throw new Error(
        "cannot specify an http method both with and without --request",
      );
    }

    method = args.shift()!;
  }

  if (values.method !== undefined && typeof values.method !== "string") {
    throw new Error("method should be a string");
  }

  if (!args.length) {
    return {
      values,
      init: { method: (method ?? values.method) as string },
    };
  }

  const mainArg = args.shift();
  if (/[.]flow[.]https$/.test(mainArg ?? "")) {
    // TODO: assert no other values in request.
    return {
      flow: mainArg as `${string}.flow.https`,
      values,
    };
  }

  const request = await parseMainArgument(mainArg!);

  Object.assign(
    values,
    mapObject(request.values ?? {}, { filter: (key) => !(key in values) }),
  );

  if (request.method && method) {
    throw new PardonError("http method specified twice");
  }

  if (values.method !== undefined && typeof values.method !== "string") {
    throw new Error("method in values must be a string.");
  }

  request.method ??= method ?? (values.method as string) ?? "GET";

  if (values.method && values.method && values.method !== request.method) {
    throw new Error("method in input does not match method in request");
  }

  if (data !== undefined && dataRaw !== undefined) {
    throw new Error("both --data and --data-raw should not be specified");
  }

  if (dataRaw) {
    request.body = `{{${JSON.stringify(await readData(dataRaw))}}}`;
  } else if (data) {
    request.body = await readData(data);
  }

  if (args[0]) {
    request.body = args.shift();
  }

  request!.headers = new Headers(request.headers || []);
  for (const header of headers || []) {
    const [key, value] = header.split(/\s*:\s*/, 2).map((s) => s.trim());
    request!.headers.append(key, value);
  }

  return { url: intoURL(request), init: request, values };
}

async function readData(dataArg: string) {
  if (dataArg == "-") {
    return await text(process.stdin);
  }

  if (dataArg.startsWith("@")) {
    // TODO: support binary payloads
    return readFile(dataArg.slice(1), "utf-8");
  }

  return dataArg;
}

async function parseMainArgument(arg: string): Promise<Partial<RequestObject>> {
  if (arg.endsWith(".http") && !/^https?:/.test(arg)) {
    const httpFile = await readFile(arg, "utf-8");
    return HTTP.parse(httpFile);
  }

  let method: string | undefined;

  arg = arg.replace(/^(?:([A-Z]+)\s+)/, (_, method_) => {
    method = method_;
    return "";
  });

  return { ...parseURL(arg), headers: new Headers(), method };
}
