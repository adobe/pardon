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
import { type ChildProcess, spawn } from "child_process";
import { Transform, pipeline } from "stream";
import split from "split";

export function createRpcSender() {
  let nextId = 100;
  const responses: Record<
    number,
    [(_: unknown) => void, (_: unknown) => void]
  > = {};

  process.on(
    "message",
    ({
      id,
      error,
      result,
    }: {
      id: number;
      error?: boolean;
      result: unknown;
    }) => {
      responses[id][error ? 1 : 0](result);
    },
  );

  return {
    send(action: string, ...args: unknown[]): any {
      const id = nextId++;
      const message = { id, action, args };
      const response = new Promise(
        (resolve, reject) => (responses[id] = [resolve, reject]),
      ).finally(() => delete responses[id]);

      process.send!(message);

      return response;
    },
  };
}

export function hostRpcChild(
  actions: Record<string, Function>, // eslint-disable-line @typescript-eslint/no-unsafe-function-type
) {
  // spawn a copy of the current process with --loader specified and wait for it.
  const child = spawn(
    process.argv0,
    [
      /* registers src/modules/loader.ts */
      `--loader=${new URL("./loader.js", import.meta.url).href}`,
      ...process.argv.slice(1),
    ],
    { stdio: ["pipe", "pipe", "pipe", "ipc"] },
  );

  child.on(
    "message",
    ({ id, action, args }: { id: number; action: string; args: unknown[] }) => {
      (async () => await actions[action](...args))()
        .then((result) => {
          child.send!({ id, result });
        })
        .catch((error) => {
          child.send!({ id, error: true, result: error });
        });
    },
  );

  return child;
}

function filterLineTransform(test: RegExp) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, test.test(chunk.toString("utf-8")) ? null : chunk);
    },
  });
}

export function awaitChildProcess(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (child.stdin) {
      process.stdin.pipe(child.stdin);
    }

    child.stdout?.pipe(process.stdout);

    pipeline(
      child.stderr!,
      split(),
      filterLineTransform(/ExperimentalWarning|node --trace-warnings/),
      process.stderr,
      (err) => {
        if (err) {
          console.error("error processing child stderr", err);
        }
      },
    );

    // lifetime tricks, remove at peril
    const keepalive = setInterval(() => {}, 10000000);

    child.on("exit", (code) => {
      clearInterval(keepalive);
      resolve(code ?? 0);
    });
  });
}
