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

import { TbShovel } from "solid-icons/tb";

export default function InProgressBanner() {
  return (
    <div class="absolute right-[-45px] top-[-45px] select-none">
      <div class="h-10 origin-[0%_0%] translate-x-[30%] rotate-45 flex-col place-content-end text-nowrap bg-white px-10 pb-1 text-sm shadow-sm shadow-[rgba(255,255,255,0.75)] dark:bg-stone-500 dark:shadow-md dark:shadow-[rgba(128,128,128,0.75)]">
        ... <TbShovel class="inline-flex rotate-[-75deg]" />
      </div>
    </div>
  );
}
