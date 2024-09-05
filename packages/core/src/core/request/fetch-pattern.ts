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
import { EncodingTypes } from "./https-schema.js";
import { intoURL } from "./url-pattern.js";

export type SimpleRequestInit = Omit<RequestInit, "body"> & {
  body?: string;
  encoding?: EncodingTypes;
};

export type FetchObject = {
  method?: string;
  origin?: string;
  pathname?: string;
  searchParams?: URLSearchParams;
  headers: Headers;
  body?: string;
  encoding?: EncodingTypes;
};

export type ResponseObject = {
  status: number | string;
  statusText?: string;
  headers: Headers;
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
  method,
  origin,
  pathname,
  searchParams,
  headers,
  body,
  encoding,
}: Partial<FetchObject>): [URL, SimpleRequestInit] {
  return [
    fetchObjectURL({ origin, pathname, searchParams }),
    { method, headers, body, encoding },
  ];
}

export function fetchIntoObject(
  url: URL | string | undefined,
  init?: SimpleRequestInit,
): FetchObject {
  const { origin, pathname, searchParams } = intoURL(url ?? {});
  const { method, headers, body } = init ?? {};

  return {
    method: method || undefined,
    origin: origin || undefined,
    pathname: pathname || undefined,
    searchParams,
    headers: new Headers(headers),
    body,
    encoding: init?.encoding,
  };
}

export async function intoResponseObject(
  response: Response,
): Promise<ResponseObject> {
  const { status, statusText, headers } = response;

  return {
    status,
    statusText,
    headers,
    body: await response.text(),
  };
}
