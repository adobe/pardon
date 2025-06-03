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
import { pardon } from "pardon";

export async function getPassword(username: string) {
  // this could be anything, including more pardon() calls,
  // or loading data from files.
  return (await import("node:crypto")).hash("sha256", username).slice(0, 8);
}

export async function authorizeUser(username: string) {
  const {
    ingress: {
      values: { "auth-token": token },
      response: res,
    },
  } = await pardon({
    username,
    password: getPassword(username),
  })`PUT https://todo.example.com/users`();

  if (!token) {
    throw new Error(
      `failed to authorize user ${username}: (${res.status}) ${res.body}`,
    );
  }

  return token;
}
