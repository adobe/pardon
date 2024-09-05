import { clearProducts, products } from "@components/products-server-hook.ts";
import { createMemo } from "solid-js";
import { TbShredder } from "solid-icons/tb";

export default function ProductsView() {
  const numberOfProducts = createMemo(() => Object.keys(products()).length);

  return (
    <div class="inline-grid w-full grid-flow-col place-content-center gap-3">
      <button
        onClick={clearProducts}
        class="aspect-square place-self-center text-xl"
      >
        <TbShredder class="relative top-0.5" />
      </button>
      <span class="inline-grid">
        <b>Product count</b> <span>{numberOfProducts()} </span>
      </span>
    </div>
  );
}
