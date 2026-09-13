/*
 * Environment-configurable downstream connectors.
 *
 * The api never hard-codes where the identity and task services live: each
 * origin is read from an env var. This is the seam that lets the same api binary
 * run three ways without code changes:
 *
 *   - standalone:     IDENTITY_ORIGIN=http://localhost:4001  (straight to the service)
 *   - docker-compose: IDENTITY_ORIGIN=http://identity:4001   (compose service DNS)
 *   - under pardon:   IDENTITY_ORIGIN=http://pardon:PORT/proxy:identity
 *                     (the recording proxy — the `/proxy:<name>` prefix routes it)
 *
 * A trailing slash is trimmed so callers can safely do `${origin}${path}`.
 */
export function resolveConnectors(env = process.env) {
  return {
    identity: origin(env.IDENTITY_ORIGIN, "http://localhost:4001"),
    task: origin(env.TASK_ORIGIN, "http://localhost:4002"),
  };
}

function origin(value, fallback) {
  return (value ?? fallback).replace(/\/+$/, "");
}
