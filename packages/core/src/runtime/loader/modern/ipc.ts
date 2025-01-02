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
export function createIpcSender(port: MessagePort) {
  let nextId = 100;
  const responses: Record<
    number,
    [(_: unknown) => void, (_: unknown) => void]
  > = {};

  port.onmessage = ({
    data: { id, error, response },
  }: MessageEvent<{ id: number; error?: boolean; response: unknown }>) => {
    responses[id][error ? 1 : 0](response);
  };

  return {
    ready() {
      port.postMessage({ action: "__ready" });
    },
    send(action: string, ...args: unknown[]): any {
      const id = nextId++;
      const message = { id, action, args };
      const response = new Promise(
        (resolve, reject) => (responses[id] = [resolve, reject]),
      ).finally(() => delete responses[id]);

      port.postMessage(message);

      return response;
    },
  };
}

export function createIpcReceiver(
  port: MessagePort,
  actions: Record<string, Function>, // eslint-disable-line @typescript-eslint/no-unsafe-function-type
) {
  let ready: (_: void | PromiseLike<void>) => void;
  const initialized = new Promise<void>((resolve) => (ready = resolve));

  port.onmessage = ({
    data: { id, action, args },
  }: MessageEvent<{ id: number; action: string; args: unknown[] }>) => {
    if (action == "__ready") {
      ready();
      ready = () => {
        throw new Error("ready already invoked");
      };
      return;
    }

    (async () => await actions[action](...args))()
      .then((response) => {
        port.postMessage({ id, response });
      })
      .catch((error) => {
        port.postMessage({ id, error: true, response: error });
      });
  };

  return initialized;
}
