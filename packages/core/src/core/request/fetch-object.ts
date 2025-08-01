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
import type { EncodingTypes } from "./body-template.js";
import { createHeaders } from "./header-object.js";
import { intoURL } from "./url-object.js";

export type RequestMeta = Record<string, string> & {
  resolve?: string;
  body?: EncodingTypes;
  insecure?: "true" | "false";
};

export type ResponseMeta = Record<string, string> & {
  body?: EncodingTypes;
};

export type SimpleRequestInit = Omit<RequestInit, "body"> & {
  meta?: RequestMeta;
  body?: string;
};

export type FetchObject = {
  method?: string;
  origin?: string;
  pathname?: string;
  searchParams?: URLSearchParams;
  headers: Headers;
  meta?: RequestMeta;
  body?: string;
};

export type ResponseObject = {
  status: number | string;
  statusText?: string;
  headers: Headers;
  meta?: ResponseMeta;
  rawBody?: Buffer;
  body?: string;
};

export function fetchObjectURL({
  origin,
  pathname,
  searchParams,
  hash,
}: Pick<FetchObject, "origin" | "pathname"> &
  Partial<Pick<FetchObject, "searchParams">> & {
    hash?: string;
  }): URL {
  return intoURL({ origin, pathname, searchParams, hash });
}

export function intoFetchParams({
  meta,
  method,
  origin,
  pathname,
  searchParams,
  headers,
  body,
}: Partial<FetchObject>): [URL, SimpleRequestInit] {
  return [
    fetchObjectURL({ origin, pathname, searchParams }),
    { method, headers, body, meta },
  ];
}

export function fetchIntoObject(
  url: URL | string | undefined,
  init?: SimpleRequestInit,
): FetchObject {
  const { origin, pathname, searchParams } = intoURL(url ?? {});
  const { method, headers, body, meta } = init ?? {};

  return {
    meta,
    method: method || undefined,
    origin: origin || undefined,
    pathname: pathname || undefined,
    searchParams,
    headers: createHeaders(headers),
    body,
  };
}

export async function intoResponseObject(
  response: Response,
): Promise<ResponseObject> {
  const { status, statusText, headers } = response;

  const rawBody = Buffer.from(await response.clone().arrayBuffer());

  return {
    status,
    statusText,
    headers,
    rawBody,
    body: await response.text(),
  };
}
