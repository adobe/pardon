import { cached, pardon } from "pardon";

// Acquire a bearer token by logging into the identity service. The identity
// login endpoint routes through the recording proxy ([proxy]: auto), so token
// acquisition is captured/replayed alongside the api's own downstream calls.
//
// Doing this in a script (rather than threading the token through flow scope)
// keeps the secret on the secure path — it is vaulted as `{{@token}}`, never a
// plain flow value.
export async function authorizeUser({
  username,
  origin,
}: {
  username: string;
  origin: string;
}) {
  const {
    ingress: {
      response,
      secrets: { token },
    },
  } = await pardon({
    username,
    origin,
  })`POST https://identity.example.com/tokens`();

  if (!token) {
    throw new Error(
      `failed to authorize ${username}: (${response.status}) ${response.body}`,
    );
  }

  return token;
}
