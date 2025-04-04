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

import { AssetSource } from "pardon/runtime";
import { mapObject } from "pardon/utils";
import {
  createMemo,
  createResource,
  createRoot,
  createSignal,
  startTransition,
} from "solid-js";

export const { manifest, samples, manifestPromise, setManifestPromise } =
  createRoot(() => {
    const [manifestPromise, setManifestPromise] = createSignal<
      Promise<PardonManifest>
    >(
      (async () => {
        const cwd = (await window.pardon.settings).cwd ?? "/";
        console.info("pardon.setConfig", cwd);
        return window.pardon.setConfig(cwd);
      })(),
    );

    const [manifest] = createResource(
      manifestPromise,
      async (promise) => await promise,
    );

    const [samples] = createResource(manifestPromise, async (promise) => {
      await promise;
      return await window.pardon.samples();
    });

    return { manifestPromise, setManifestPromise, manifest, samples };
  });

window.pardon.resetManifestWith((manifest) => {
  startTransition(() => setManifestPromise(manifest));
});

type AppManifest = Awaited<ReturnType<typeof window.pardon.manifest>>;

export const fileManifest = createRoot(() => {
  return createMemo(() => {
    const app = manifest();
    return app && new FileManifest(app);
  });
});

class FileManifest {
  readonly app: AppManifest;
  readonly croots: string[];
  readonly crootnames: string[];

  readonly assets: Record<
    string,
    { sources: (AssetSource & { exists: boolean })[] }
  >;

  constructor(app: AppManifest) {
    this.app = app;
    this.croots = app.collections.map((root) => `${root.replace(/[/]$/, "")}/`);
    this.crootnames = this.croots.map((path, index) => {
      const parts = this.croots.map((path) => path.slice(0, -1).split("/"));
      const otherParts = parts.filter((_, i) => i !== index);

      const names = parts[index];
      while (names.length != 0) {
        const name = names.pop();
        if (otherParts.every((others) => others.pop() !== name)) {
          return name;
        }
      }

      return path;
    });

    this.assets = mapObject(app.assets, (value) => ({
      sources: this.croots
        .map((root) => {
          const firstRoot = this.croots.find((root) =>
            value.sources[0].path.startsWith(root),
          );

          if (!firstRoot) {
            return null;
          }

          const extension = value.sources[0].path.slice(firstRoot.length);
          const source = value.sources.find(({ path }) =>
            path.startsWith(root),
          );
          if (source) {
            return { ...source, exists: true };
          }

          const path = root + extension;

          return { path, content: "", exists: false };
        })
        .filter(Boolean),
    }));
  }

  assetFromPath(path: string) {
    const cindex = this.croots.findIndex((root) => path.startsWith(root));
    if (cindex > -1) {
      const croot = this.croots[cindex];

      return {
        cindex,
        asset: `pardon:${path
          .replace(/(?<![/](?:service|config))[.](json|yaml)$/, "")
          .slice(croot.length)}`,
        collection: this.app.collections[cindex],
      };
    }
  }
}
