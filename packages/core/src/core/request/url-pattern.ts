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
import { depatternize, patternize } from "../schema/core/pattern.js";
import { mapObject } from "../../util/mapping.js";
import { intoSearchParams } from "./search-pattern.js";

type URLTemplate = {
  origin?: string;
  pathname?: string;
  searchParams?: string | [string, string][] | URLSearchParams;
  hash?: string;
};

export function parseURL(
  url: string | URL | URLTemplate,
):
  | Pick<Partial<URL>, "origin" | "pathname" | "searchParams" | "hash">
  | undefined {
  if (typeof url === "string") {
    const urlpattern = patternize(url);

    const match =
      /^(?:([a-z]+:[/][/][^/?#]+)|[/][/])?([/][^?#]*)?([?][^#]*)?([#].*)?$/
        .exec(urlpattern.template)
        ?.slice(1, 5)
        ?.map((part) => depatternize(part ?? "", urlpattern));

    if (!match) {
      return;
    }

    const [origin, pathname, search, hash] = match;

    return {
      origin,
      pathname,
      searchParams: intoSearchParams(search),
      hash,
    };
  }

  const { origin, pathname, hash } = url;

  return {
    origin,
    pathname,
    searchParams: intoSearchParams(url.searchParams),
    hash,
  };
}

export function intoURL(url: string | URL | URLTemplate): URL {
  const { origin, pathname, searchParams, hash } = parseURL(url) || {};

  function href() {
    return `${origin ?? ""}${pathname ?? ""}${searchParams ?? ""}${hash ?? ""}`;
  }

  // TODO: read and write values.
  const prototype = {
    get hash() {
      return hash!;
    },

    get origin() {
      return origin!;
    },

    get pathname() {
      return pathname!;
    },

    get search() {
      return String(searchParams);
    },

    get searchParams() {
      return searchParams!;
    },

    get href() {
      return href();
    },

    toString() {
      return href();
    },

    toJSON() {
      return href();
    },

    // TODO: stubs
    get host() {
      return "";
    },

    get hostname() {
      return "";
    },

    get password() {
      return "";
    },

    get username() {
      return "";
    },

    get port() {
      return "";
    },

    get protocol() {
      return "";
    },
  } satisfies URL;

  const urlObject = {} as URL;

  Object.defineProperties(
    urlObject,
    mapObject(
      Object.getOwnPropertyDescriptors(prototype),
      (descriptor) => ({
        ...descriptor,
        enumerable: false,
        configurable: false,
      }),
      true,
    ),
  );

  return urlObject;
}
