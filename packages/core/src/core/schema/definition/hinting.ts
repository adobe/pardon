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

// these methods look at the hint, for example
//   "{{@value}}" has a @ hint which means it's secret
// while
//   "{{?value}}" has a ? hint which means we don't require it.
//
// the hint string is normally treated as a flag, but some patterns
// (like in the url/pathname, have special hints like `{{...path}}`
// for rest-slugs.).

type Hinting = { hint?: string | null };

// only matches non-empty strings.
export function isNonEmpty({ hint }: Hinting = {}) {
  return hint?.includes("*");
}

// optional when rendering. (matching is optional by default)
export function isOptional({ hint }: Hinting = {}) {
  return hint?.includes("?");
}

// required when matching (rendering is required by default)
export function isRequired({ hint }: Hinting = {}) {
  return hint?.includes("!");
}

// matched and generated values will be redacted and not saved.
export function isSecret({ hint }: Hinting = {}) {
  return hint?.includes("@");
}

// matched and generated values will not be exported
export function isNoExport({ hint }: Hinting = {}) {
  return hint?.includes(":");
}

// expression will be evaulated when --offline is passed.
export function isMelding({ hint }: Hinting = {}) {
  return hint?.includes("~");
}
