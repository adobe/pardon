#!/usr/bin/env -S node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const env = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, ".env.json"), "utf-8"));
  } catch (error) {
    void error;
    return {};
  }
})();

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    message: {
      type: "string",
    },
    dryrun: {
      type: "boolean",
    },
    remote: {
      type: "string",
      default: "origin",
    },
    release: {
      type: "boolean",
      default: false,
    },
  },
});

/**
 * @param {TemplateStringsArray|import('node:child_process').ExecSyncOptionsWithStringEncoding} pattern
 * @param  {string[]} args
 */
const exec = execWithOptions();
const eexec = exec({ stdio: "inherit" });

console.log("\n\n--- validating the current git state ---");

const branch = exec({ dryrun: true })`git branch --show-current`.trim();

if (branch !== "main" && !args.dryrun) {
  console.error("lets release from the main branch only for now!");
  process.exit(1);
}

eexec({ dryrun: true })`git remote update`;

const upstreamChanges = exec({ dryrun: true })`git rev-list ..@{u}`
  .split("\n")
  .filter(Boolean);

if (upstreamChanges.length) {
  console.warn(
    "local main branch not in sync with upstream! Rebase before release.",
  );
  process.exit(1);
}

console.log("\n\n--- prevalidating the release ---");

eexec({ dryrun: true })`rm -rf dist/`;
eexec({ dryrun: true })`npm run build`;
eexec({ dryrun: true })`git hook run pre-push`;
eexec({ dryrun: true })`git hook run pre-commit`;

exec`npm version ${positionals.length ? positionals.map(quoteArg).join(" ") : "prerelease"}`;

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

function quoteArg(arg) {
  return `'${arg.replace(/'/g, `'"'"'`)}'`;
}

function execWithOptions(options = { encoding: "utf-8" }) {
  /** @type {typeof String.raw} */
  return (pattern, ...parts) => {
    if (!Array.isArray(pattern)) {
      return execWithOptions({ ...options, ...pattern });
    }

    const command = String.raw(pattern, ...parts);
    const skip = args.dryrun && !options.dryrun;
    if (skip) {
      console.log("\n> " + command + " [skipped for dryrun]");
      return;
    }
    console.log("\n> " + command);
    return execSync(command, options);
  };
}

console.log("\n\n--- refreshing the environment ---");

eexec({ dryrun: true })`npm install`;
eexec({ dryrun: true })`npm rebuild`;

console.log("\n\n--- building and publishing to registry ---");

eexec({ dryrun: true, cwd: resolve("../favor") })`npm install`;
eexec({ dryrun: true, cwd: resolve("../favor") })`npm run package`;
eexec`npm publish${env.REGISTRY ? ` --registry="${env.REGISTRY}"` : ''}`;

console.log("\n\n--- commiting version updates ---");

eexec`git commit --no-verify -a -m ${quoteArg(`${version}: ${args.message || "release"}`)}`;

console.log("\n\n--- tagging and pushing back to git ---");

eexec`git tag pardon-${version}`;

eexec`git push --no-verify`;
eexec`git push --tags --no-verify`;
