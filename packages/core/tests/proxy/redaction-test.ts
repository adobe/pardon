/*
Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
import { after, before, it } from "node:test";
import assert from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTrackingEnvironment } from "../../src/runtime/environment.js";
import { initializePardon } from "../../src/runtime/initialize.js";
import undici from "../../src/features/undici.js";
import { createRedactor } from "../../src/core/proxy/capture.js";
import { HTTP } from "../../src/core/formats/http-fmt.js";
import type { PardonRuntime } from "../../src/core/pardon/types.js";

// The redactor classifies a concrete exchange against the collection and returns
// its schema-redacted form (secrets replaced). It injects the given response, so
// no live upstream is needed — the same pipeline that redacts recording logs and
// console output. Redaction only happens where an endpoint marks a value secret.

let workspace: string;
let runtime: PardonRuntime;

before(async () => {
  await initTrackingEnvironment();

  workspace = await mkdtemp(join(tmpdir(), "pardon-redaction-"));
  await writeFile(
    join(workspace, "pardonrc.yaml"),
    "collections:\n  - ./collection\n",
  );

  const svc = join(workspace, "collection", "svc");
  await mkdir(svc, { recursive: true });
  await writeFile(
    join(svc, "service.yaml"),
    "config:\n  origin: https://svc.example\n",
  );
  // an endpoint whose bearer token is a secret (`@token`) — so a matched
  // Authorization header redacts, and whose response `token` is a secret too.
  await writeFile(
    join(svc, "login.https"),
    `>>>
POST https://svc.example/tokens
Authorization: Bearer {{ @token }}

<<<
200

{ "token": "{{ @token }}" }
`,
  );

  runtime = (await initializePardon({ cwd: workspace }, [
    undici,
  ])) as unknown as PardonRuntime;
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

it("redacts a secret matched against the collection, keeping the shape", async () => {
  const redact = createRedactor(runtime);

  const { request, response } = await redact(
    {
      method: "POST",
      origin: "https://svc.example",
      pathname: "/tokens",
      headers: new Headers({ authorization: "Bearer SECRET-TOKEN-123" }),
    },
    {
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      body: JSON.stringify({ token: "SECRET-TOKEN-123" }),
    },
  );

  const req = HTTP.stringify(request);
  // the header is still present and matched (Bearer ...), but the secret value
  // itself is gone from the redacted request.
  assert.match(req, /Authorization: Bearer/i);
  assert.doesNotMatch(req, /SECRET-TOKEN-123/, "request secret redacted");

  const res = HTTP.responseObject.stringify(response);
  assert.doesNotMatch(res, /SECRET-TOKEN-123/, "response secret redacted");
});

it("passes uncatalogued (default/default) traffic through unredacted", async () => {
  const redact = createRedactor(runtime);

  // no endpoint matches this path → default/default → nothing marked secret.
  const { request } = await redact(
    {
      method: "GET",
      origin: "https://svc.example",
      pathname: "/unknown",
      headers: new Headers({ authorization: "Bearer PLAIN-abc" }),
    },
    { status: 200, statusText: "OK", headers: new Headers(), body: "" },
  );

  const req = HTTP.stringify(request);
  assert.match(req, /PLAIN-abc/, "no schema marks it secret, so it is kept");
});
