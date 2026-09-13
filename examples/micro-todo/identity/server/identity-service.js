import { createMiniRouter } from "../../../lib/mini-router.js";

/*
 * identity service — the system of record for who a user is.
 *
 * - POST /users     register (or update) a username/password
 * - POST /tokens    exchange username/password for a token (login)
 * - POST /validate  validate a token, returning its username
 *
 * The todo API holds no user state of its own; it calls POST /validate here to
 * turn a caller's token into a username before touching the task service.
 */
export const makeIdentityServiceRouter = ({ users, setUsers }) =>
  createMiniRouter({
    "GET /health-check"() {
      return new Response("ok");
    },
    "POST /users"({ req }) {
      const { username, password } = parseBodyJson(req);
      if (!username || !password) {
        return new Response("username and password required", { status: 400 });
      }

      setUsers((current) => ({ ...current, [username]: password }));
      return json({ username });
    },
    "POST /tokens"({ req }) {
      const { username, password } = parseBodyJson(req);
      if (users()[username] !== password) {
        return new Response("wrong username or password", { status: 401 });
      }

      return json({ token: mintToken(username) });
    },
    "POST /validate"({ req }) {
      const { token } = parseBodyJson(req);
      const identity = readToken(token);
      if (!identity || !(identity.username in users())) {
        return new Response("invalid token", { status: 401 });
      }

      return json({ username: identity.username });
    },
  });

/** mint an opaque-ish token: `jwt.<base64 payload>` (not signed — this is a PoC). */
function mintToken(username) {
  return `jwt.${btoa(JSON.stringify({ username }))}`;
}

function readToken(token) {
  if (typeof token !== "string") {
    return undefined;
  }

  const [header, payload] = token.split(".");
  if (header !== "jwt" || !payload) {
    return undefined;
  }

  try {
    return JSON.parse(atob(payload));
  } catch {
    return undefined;
  }
}

/** @param {import("../../../lib/mini-router.js").MiniRequest} req */
function parseBodyJson(req) {
  if (req.headers.get("content-type") !== "application/json") {
    throw new Error("missing content type");
  }

  return JSON.parse(String(req.body));
}

function json(json, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
