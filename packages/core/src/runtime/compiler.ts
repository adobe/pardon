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
import type Module from "node:module";
import { posix } from "node:path";
import { readFileSync } from "node:fs";

import { Project, ts } from "ts-morph";

import { PardonError } from "../core/error.js";
import { AppContext } from "../core/app-context.js";
import { expressionTransform } from "../core/expression.js";
import { shared } from "../core/tracking.js";

const { join, normalize } = posix;

export type PardonCompiler = ReturnType<typeof createCompiler>;

export default function createCompiler({
  collection: { configurations, data, scripts, resolutions, assets },
}: Pick<AppContext, "collection">) {
  const project: Project = new Project({
    compilerOptions: {
      outDir: "memory",
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts"], // use 2022 runtime.
      allowJs: true,
      sourceMap: true,
      inlineSourceMap: true,
      mapRoot: "file:///",
    },
    useInMemoryFileSystem: true,
  });

  return {
    compile,
    resolveModule: resolvePardonOrExternalModule,
    resolve: resolvePardonRelativeImport,
    import: importModule,
  };

  async function importModule(specifier: string, parentSpecifier: string) {
    const resolved = resolvePardonRelativeImport(specifier, parentSpecifier);

    return await shared(() => import(/* @vite-ignore */ resolved));
  }

  // TODO: analyze which paths actually hit here.
  function resolvePardonExport(moduleSpecifier: string) {
    // file urls?
    if (moduleSpecifier.startsWith("file:///")) {
      return new URL(moduleSpecifier).pathname;
    }

    if (!moduleSpecifier.startsWith("pardon:")) {
      return moduleSpecifier;
    }

    const resolved = resolutions[moduleSpecifier];

    if (resolved) {
      return resolved;
    }

    const config = resolvePardonConfig(moduleSpecifier);

    if (config) {
      const exports = config.export;
      if (exports && exports in resolutions) {
        return resolutions[exports];
      }

      throw new PardonError(`${moduleSpecifier}: configuration has no export`);
    }

    throw new PardonError(`${moduleSpecifier}: unresolved`);
  }

  function expectPardon(specifier: string) {
    if (!specifier.startsWith("pardon:")) {
      throw new PardonError(
        "unexpected attempt to resolve non-pardon module: " + specifier,
      );
    }

    return specifier.replace(/^pardon:/, "");
  }

  function resolvePardonConfig(pardonSpecifier: string) {
    const module = expectPardon(pardonSpecifier);

    const configuration = configurations[module];

    if (!configuration) {
      throw new Error("could resolve pardon config: " + pardonSpecifier);
    }

    return configuration;
  }

  function compile(moduleSpecifier: string, context: Module.LoadHookContext) {
    void context;

    if (moduleSpecifier in data) {
      return `export default (${JSON.stringify(data[moduleSpecifier].values ?? null)});`;
    }

    const resolved = resolvePardonExport(moduleSpecifier);

    if (!resolved.startsWith("pardon:") && !resolved.endsWith(".https")) {
      const content = readFileSync(resolved, "utf-8");
      if (!resolved.endsWith(".ts")) {
        return content;
      }

      const compiled = project
        .createSourceFile(resolved, content)
        .transform(expressionTransform)
        .asKind(ts.SyntaxKind.SourceFile)
        ?.getEmitOutput();

      const output = compiled?.getOutputFiles()[0].getText();

      return output;
    }

    if (resolved in scripts) {
      const stack = scripts[resolved];

      if (stack.length > 1) {
        throw new Error("todo: stacked scripts");
      }

      const { path, content } = stack[0];

      const compiled = project
        .createSourceFile(path, content)
        .transform(expressionTransform)
        .asKind(ts.SyntaxKind.SourceFile)
        ?.getEmitOutput();

      const output = compiled?.getOutputFiles()[0].getText();

      return output;
    }

    const httpsMatch = /[.](mix|mux|unit|flow)[.]https$/.exec(resolved);

    if (httpsMatch) {
      const [, type] = httpsMatch;

      const asset = assets[resolved] ?? {
        sources: [
          {
            path: resolved,
            content: readFileSync(resolved, "utf-8"),
          },
        ],
      };

      if (asset.sources.length > 1) {
        // note: we support overlapping mixins as configurations,
        // but not sure how we would as script imports, doesn't make
        // sense for unit/flow imports.
        throw new Error("todo: support stacked mixins as imports?");
      }

      return `
import { HTTPS } from 'pardon';

function load() {
  try { 
    return HTTPS.parse(${JSON.stringify(asset.sources[0].content)}, ${JSON.stringify(type)});
  } catch (error) {
    throw new Error(${JSON.stringify(moduleSpecifier)} + ":" + (error?.message ?? error), { cause: error });
  }
}

export default load();
`.trimStart();
    }

    throw new Error(`${resolved}: compiler confused what to do here`);
  }
}

export function resolvePardonRelativeImport(
  moduleSpecifier: string,
  parentSpecifier: string,
) {
  return resolvePardonOrExternalModule(moduleSpecifier, parentSpecifier);
}

function resolvePardonOrExternalModule(
  moduleSpecifier: string,
  parentSpecifier: string,
) {
  if (!ts.isExternalModuleNameRelative(moduleSpecifier)) {
    return normalize(moduleSpecifier);
  }

  if (!parentSpecifier.startsWith("pardon:")) {
    return join(parentSpecifier, moduleSpecifier);
  }

  const resolved = join(
    parentSpecifier.replace("pardon:", "__pardon__/"),
    moduleSpecifier,
  );

  if (
    ts.isExternalModuleNameRelative(resolved) &&
    !resolved.startsWith("__pardon__/")
  ) {
    throw new Error(
      "module cannot escape a collection: " +
        moduleSpecifier +
        " from " +
        parentSpecifier,
    );
  }

  return resolved.replace("__pardon__/", "pardon:");
}
