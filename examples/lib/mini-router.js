/* a tiny no-dependency server framework:
 *
 * - regex-based router.
 * - pre-reads the body as json or text.
 * - helper for responding with json.
 * - basic 404 and 500 error handling.
 */

/**
 * @typedef {Object} MiniRequest
 * @property {string} url
 * @property {string} method
 * @property {Headers} headers
 * @property {string|undefined} body
 */

/**
 * @typedef {Object} RouteInput
 * @property {MiniRequest} req
 * @property {string} url
 * @property {Record<string, string>} slug
 */

/** @typedef {(input: RouteInput) => Response | Promise<Response>} RouteAction */

/** @typedef {Record<string, RouteAction>} RouteMap */

/** @param {RouteMap} routemap */
export function createMiniRouter(routemap) {
  /** @param {string} path */
  /** @param {RouteAction} action */
  function route(path, action) {
    const re = new RegExp(
      `^${path
        .replaceAll(/::([a-z]*)/g, `(?<$1>.+)`)
        .replaceAll(/:([a-z]*)/g, `(?<$1>[^/]+)`)}/?$`,
    );

    return { re, action };
  }

  /** @param {MiniRequest} req */
  return async (req) => {
    const routes = Object.entries(routemap).map(([path, action]) =>
      route(path, action),
    );

    try {
      for (const route of routes) {
        const match = route.re.exec(`${req.method} ${req.url}`);

        if (match) {
          return await route.action({ req, slug: match.groups ?? {} });
        }
      }
    } catch (error) {
      console.warn(`mini-router: ${req.method} ${req.url}: error`, error);
      return new Response("error", { status: 500 });
    }
  };
}
