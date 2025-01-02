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

function tap(imports: Record<string, string>) {
  return Object.entries(imports).reduce(
    (tapped, [k, v]) =>
      Object.assign(tapped, {
        [k.replace(/^[.][/][^/]*[/]/, "")]: v,
      }),
    {},
  );
}

const exampleService = tap(
  import.meta.glob("./templates-example/**/*", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
);

export const productsExample = {
  ...exampleService,
  "example/products/create.https": `
>>>
POST https://example.com/products

{
  "name": "{{name}}",
  "price": "{{price}}"
}
`,
} as const;

export const productsExampleWithAuth = {
  ...productsExample,
  "example/products/create.https": `
>>>
POST https://example.com/products
Authorization: {{@auth = \`\${env}-auth-token\` }}

{
  "name": "{{name}}",
  "price": "{{price}}"
}
`,
} as const;
