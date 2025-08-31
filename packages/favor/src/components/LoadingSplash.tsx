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

import { type ComponentProps, createSignal, onCleanup } from "solid-js";

export default function LoadingSplash(props: ComponentProps<"span">) {
  const spinner = "-/|\\";
  const [spindex, setSpindex] = createSignal(1);
  const interval = setInterval(
    () => setSpindex((value) => (value + 1) % spinner.length),
    150,
  );
  onCleanup(() => clearInterval(interval));

  return <span {...props}>({spinner[spindex()]})</span>;
}
