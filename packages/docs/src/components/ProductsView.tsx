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
import { clearProducts, products } from "@components/products-server-hook.ts";
import { createMemo } from "solid-js";

export default function ProductsView() {
  const numberOfProducts = createMemo(() => Object.keys(products()).length);

  return (
    <div class="inline-grid w-full grid-flow-col place-content-center gap-3">
      <button
        onClick={clearProducts}
        class="aspect-square place-self-center text-xl"
      >
        <IconTablerShredder class="relative top-0.5" />
      </button>
      <span class="inline-grid">
        <b>Product count</b> <span>{numberOfProducts()} </span>
      </span>
    </div>
  );
}
