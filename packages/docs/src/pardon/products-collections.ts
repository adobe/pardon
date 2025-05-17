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

import { tap } from "./helper.ts";

export const serviceAndPing = tap(
  import.meta.glob("./service-and-ping/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

export const exampleProducts = tap(
  import.meta.glob("./example-products/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

const blanketAuth = tap(
  import.meta.glob("./blanket-auth/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

const configurableAuth = tap(
  import.meta.glob("./configurable-auth/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

export const bodyProcessing = tap(
  import.meta.glob("./example-body-processing/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

export const ordering = tap(
  import.meta.glob("./example-orders/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

export const serviceAndPingAndProducts = {
  ...serviceAndPing,
  ...exampleProducts,
};

export const serviceAndPingAndProductsWithAuth = {
  ...serviceAndPingAndProducts,
  ...blanketAuth,
};

export const serviceAndPingAndProductsWithConfigurableAuth = {
  ...serviceAndPingAndProductsWithAuth,
  ...configurableAuth,
};

export const serviceAndPingAndProductsWithConfigurableScriptAuth = {
  ...serviceAndPingAndProductsWithConfigurableAuth,
  [`example/auth.mix.https`]: `
config:
  authorization: token
>>>
ANY //
Authorization: {{ @auth = serviceToken(env) }}
`,
};

export const serviceWithOrdering = {
  ...serviceAndPingAndProductsWithConfigurableAuth,
  ...ordering,
};

export const serviceWithOrderingAndGetMatching = {
  ...serviceAndPingAndProductsWithConfigurableScriptAuth,
  ...ordering,
  "example/products/get.https": `
>>>
GET https://example.com/products/{{product}}

<<<
200 OK

{
  "name": "{{name}}",
  "price": "{{price}}"
}`,
  "example/orders/create.https": `
>>>
POST https://example.com/orders

{
  "cart": [{
    "product": "{{items.product}}",
    "quantity": number("{{items.quantity=1}}"),
    "cost": "{{items.cost}}"
  }]
}`,
};

export const serviceWithAutoCost = {
  ...serviceWithOrderingAndGetMatching,
  "example/orders/create.https": `
import:
  ../products/products-helper.ts:
    - price
>>>
POST https://example.com/orders

{
  "cart": [{
    "product": "{{items.product}}",
    "quantity": number("{{items.quantity=1}}"),
    "cost": "{{items.cost = price({ product, env })}}"
  }]
}`,
};
