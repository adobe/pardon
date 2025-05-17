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

import { fourOhFour, json } from "@components/server-hook-shared.ts";
import { makePersisted } from "@solid-primitives/storage";
import {
  PardonFetchExecution,
  hookExecution,
  intoFetchParams,
  intoResponseObject,
} from "pardon/playground";
import { createSignal, untrack } from "solid-js";

const [, setNextProductId] = makePersisted(createSignal(1000), { name: "pid" });
const [, setNextOrderId] = makePersisted(createSignal(9000), { name: "oid" });

const [products, setProducts] = makePersisted(
  createSignal<Record<string, Record<string, unknown>>>({}),
  { name: "products" },
);

function generateProductId() {
  return `P${setNextProductId((id) => id + 1)}`;
}

function generateOrderId() {
  return `P${setNextOrderId((id) => id + 1)}`;
}

export { products };

export function clearProducts() {
  setNextProductId(1000);
  setProducts({});
}

export const ProductsServerExecution = hookExecution(PardonFetchExecution, {
  async fetch({ egress: { request } }, _next) {
    const [url, init] = intoFetchParams(request);

    return intoResponseObject(await serve(url, init));
  },
});

async function serve(url: URL, init: RequestInit): Promise<Response> {
  switch (init.method) {
    case "GET": {
      if (/^[/]products[/]?$/.test(url.pathname)) {
        return list(url, init);
      }
      const productMatch = /^[/]products[/]([^/]+)?$/.exec(url.pathname);
      if (productMatch) {
        return get(url, init, { product: productMatch[1] });
      }
      break;
    }
    case "PUT": {
      const productMatch = /^[/]products[/]([^/]+)?$/.exec(url.pathname);
      if (productMatch) {
        return update(url, init, { product: productMatch[1] });
      }
      break;
    }
    case "POST": {
      if (/^[/]products[/]?$/.test(url.pathname)) {
        return create(url, init);
      }
      if (/^[/]orders[/]?$/.test(url.pathname)) {
        return order(url, init);
      }
      break;
    }
    case "DELETE": {
      const productMatch = /^[/]products[/]([^/]+)?$/.exec(url.pathname);
      if (productMatch) {
        return remove(url, init, { product: productMatch[1] });
      }
      break;
    }
  }

  return fourOhFour();
}

function list(url: URL, _init: RequestInit) {
  return json(
    Object.entries(untrack(products))
      .map(([key, value]) => ({ ...value, id: key }) as Record<string, unknown>)
      .filter((product) =>
        [...(url.searchParams?.keys() || [])].every((param) =>
          url.searchParams
            .getAll(param)
            .some((value) => product[param] === value),
        ),
      ),
  );
}

function get(_url: URL, _init: RequestInit, { product }: { product: string }) {
  if (!untrack(products)[product]) {
    return fourOhFour();
  }

  return json(untrack(products)[product]);
}

async function create(_url: URL, init: RequestInit) {
  const info = JSON.parse(String(init.body));
  const id = generateProductId();

  await new Promise((resolve) => setTimeout(resolve, 500));

  setProducts((products) => ({ ...products, [id]: info }));

  return json({ ...info, id });
}

async function order(_url: URL, init: RequestInit) {
  const info = JSON.parse(String(init.body));
  const id = generateOrderId();

  await new Promise((resolve) => setTimeout(resolve, 800));

  return json({ ...info, id });
}

async function update(
  _url: URL,
  init: RequestInit,
  { product }: { product: string },
) {
  if (!untrack(products)[product]) {
    return fourOhFour();
  }

  const info = JSON.parse(String(init.body));
  const newProduct = { ...untrack(products)[product], ...info };

  await new Promise((resolve) => setTimeout(resolve, 500));

  setProducts((products) => ({ ...products, [product]: newProduct }));
  return json({ ...newProduct, id: product });
}

async function remove(
  _url: URL,
  _init: RequestInit,
  { product }: { product: string },
) {
  if (!untrack(products)[product]) {
    return fourOhFour();
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  setProducts(({ [product]: deleted, ...remaining }) => remaining);

  return new Response(null, { status: 204 });
}
