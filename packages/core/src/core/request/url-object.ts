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
import { depatternize, patternize } from "../schema/core/pattern.js";
import { mapObject } from "../../util/mapping.js";
import { intoSearchParams } from "./search-object.js";

type URLTemplate = {
  origin?: string;
  pathname?: string;
  searchParams?: string | [string, string][] | URLSearchParams;
  hash?: string;
};

function PardonURL() {}

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

  function protocol(origin?: string) {
    return (/^([a-z][a-z0-9+.-]*:)/i.exec(origin ?? "") ?? [undefined, ""])[1];
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
      return (origin ?? "")?.replace(/^[a-z][a-z0-9+.-]*:[/][/]/i, "");
    },

    get hostname() {
      return (origin ?? "")
        ?.replace(/^[a-z][a-z0-9+.-]*:[/][/]/i, "")
        .replace(/:\d+$/, "");
    },

    get password() {
      return "";
    },

    get username() {
      return "";
    },

    get port() {
      let [, port = ""] = /:(\d+)$/.exec(origin ?? "") ?? [];

      switch (protocol(origin)) {
        case "http:":
          if (port == "80") port = "";
          break;
        case "https:":
          if (port == "443") port = "";
          break;
      }

      return port;
    },

    get protocol() {
      return protocol(origin);
    },
  } satisfies URL;

  const urlObject = Object.create(PardonURL.prototype) as URL;

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
