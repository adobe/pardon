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

import { Project, SourceFile, ts } from "ts-morph";

import { PardonError } from "../core/error.js";
import { AppContext } from "../core/app-context.js";
import { expressionTransform, TsMorphTransform } from "../core/expression.js";
import { shared } from "../core/tracking.js";

const { join, normalize } = posix;

export type PardonCompiler = ReturnType<typeof createCompiler>;

const withIdentityTransfrom: (identity: string) => TsMorphTransform =
  (identity) =>
  ({ factory, visitChildren, currentNode }) => {
    if (
      ts.isImportDeclaration(currentNode) ||
      ts.isExportDeclaration(currentNode)
    ) {
      if (
        !currentNode.moduleSpecifier ||
        !ts.isStringLiteral(currentNode.moduleSpecifier) ||
        !currentNode.moduleSpecifier.text.startsWith("pardon:")
      ) {
        return visitChildren();
      }

      if (ts.isImportDeclaration(currentNode)) {
        return factory.createImportDeclaration(
          currentNode.modifiers,
          currentNode.importClause,
          currentNode.moduleSpecifier,
          factory.createImportAttributes(
            factory.createNodeArray([
              factory.createImportAttribute(
                factory.createIdentifier("identity"),
                factory.createStringLiteral(identity),
              ),
              ...(currentNode.attributes?.elements ?? []),
            ]),
          ),
        );
      } else if (!currentNode.isTypeOnly) {
        return factory.createExportDeclaration(
          currentNode.modifiers,
          false,
          currentNode.exportClause,
          currentNode.moduleSpecifier,
          factory.createImportAttributes(
            factory.createNodeArray([
              factory.createImportAttribute(
                factory.createIdentifier("identity"),
                factory.createStringLiteral(identity),
              ),
            ]),
          ),
        );
      }
    }

    return visitChildren();
  };

export default function createCompiler({
  collection: { data, resolutions, identities, assets },
}: Pick<AppContext, "collection">) {
  const project: Project = new Project({
    compilerOptions: {
      outDir: "memory",
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts"], // assume 2022 runtime.
      allowJs: true,
      sourceMap: true,
      inlineSourceMap: true,
      mapRoot: "file:///",
    },
    useInMemoryFileSystem: true,
  });

  translate.cache = {} as Record<
    string,
    { compiled: SourceFile; exports: string[] } | undefined
  >;

  function translate(path: string, content: string) {
    if (translate.cache[path]) {
      return translate.cache[path];
    }

    const identity = identities[path];

    const compiled = project
      .createSourceFile(path, content)
      .transform(expressionTransform)
      .transform(withIdentityTransfrom(identity))
      .asKind(ts.SyntaxKind.SourceFile)!;

    const exports = [...(compiled?.getExportedDeclarations().entries() ?? [])]
      .filter(([, v]) =>
        v.some((v) => {
          return !(
            (v.getSymbol()?.getValueDeclaration()?.getFlags() ??
              ts.SymbolFlags.Transient) & ts.SymbolFlags.Transient
          );
        }),
      )
      .map(([k]) => k);

    return (translate.cache[path] = { compiled, exports });
  }

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

  function resolvePardonExport(spec: string, context: Module.LoadHookContext) {
    let [, moduleSpecifier, index] = /^([^?]*)(?:[?](.*))?$/.exec(spec)!;

    // file urls?
    if (moduleSpecifier.startsWith("file:///")) {
      const pathname = new URL(moduleSpecifier).pathname;

      if (identities[pathname]) {
        const { identity } = context.importAttributes;
        if (!identity) {
          throw new Error("illegal direct import of exported script");
        }

        if (identity !== identities[pathname]) {
          throw new Error("improper import of exported script");
        }

        return { resolution: pathname, identity };
      }

      return { resolution: pathname };
    }

    if (!moduleSpecifier.startsWith("pardon:")) {
      return { resolution: moduleSpecifier };
    }

    moduleSpecifier = moduleSpecifier.replace(/[.][tj]s$/, "");

    const resolved = resolutions[moduleSpecifier];

    if (resolved) {
      if (index) {
        return { resolved, index: Number(index), identity: moduleSpecifier };
      }

      return { resolved, index: resolved.length, identity: moduleSpecifier };
    }

    throw new PardonError(`${moduleSpecifier}: unresolved`);
  }

  function compile(moduleSpecifier: string, context: Module.LoadHookContext) {
    if (moduleSpecifier in data) {
      return `export default (${JSON.stringify(data[moduleSpecifier].values ?? null)});`;
    }

    const { resolution, resolved, identity, index } = resolvePardonExport(
      moduleSpecifier,
      context,
    );

    if (
      resolution &&
      !resolution.startsWith("pardon:") &&
      !resolution.endsWith(".https")
    ) {
      const content = readFileSync(resolution, "utf-8");
      if (!resolution.endsWith(".ts")) {
        return content;
      }

      const compiled = translate(resolution, content)?.compiled.getEmitOutput();

      return compiled?.getOutputFiles()[0].getText();
    }

    if (resolved) {
      const exported = new Set<string>();
      return resolved
        .slice(0, index)
        .reverse()
        .map(({ path, content }) => ({
          path,
          exports: translate(path, content).exports.filter((symbol) =>
            exported.has(symbol) ? false : exported.add(symbol),
          ),
        }))
        .reverse()
        .map(
          ({ path, exports }, index) =>
            `export { ${exports.join(", ")} } from ${JSON.stringify(
              `file://${path}`,
            )} with { identity: ${JSON.stringify(`${identity}?${index}`)} };`,
        )
        .join("\n");
    }

    const httpsMatch = /[.](mix|mux|unit|flow)[.]https$/.exec(resolution);

    if (httpsMatch) {
      const [, type] = httpsMatch;

      const asset = assets[resolution] ?? {
        sources: [
          {
            path: resolved,
            content: readFileSync(resolution, "utf-8"),
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
