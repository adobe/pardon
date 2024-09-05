This is a chimera of solutions scraped from

- `create-electron-vite` - vue flavored
- `create-vite` - solid flavored
- `create-electron-app` - to integrate electron forge

and changes developed tangentially to
[this discussion](https://github.com/electron/forge/issues/3506)

# Building

This uses the build from the `packages/core`

`npm run dev` will rebuild pardon and run the electron app in dev mode (live
edits to tsx files supported).

`npm run package` will rebuild pardon and create an application in `./out/...`.
