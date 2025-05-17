import { pardon } from "pardon";

export async function authorizeUser({
  username,
  origin,
}: {
  username: string;
  origin: string;
}) {
  const {
    ingress: {
      response: res,
      secrets: { token },
    },
  } = await pardon({ username, origin })`
    PUT https://todo.example.com/users
  `();

  if (!token) {
    throw new Error(
      `failed to authorize user ${username}: (${res.status}) ${res.body}`,
    );
  }

  return token;
}

export async function getPassword(username: string) {
  return "pw";
}
