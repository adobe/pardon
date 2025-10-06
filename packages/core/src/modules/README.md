# Pardon Modules

These modules are largely 1-1 with the exports in `package.json` backed by the
modules produced via the `rollup.config`.

## The pardon modules

A brief description of the modules and their roles. Unless otherwise noted,
these require a NodeJS-type environment.

### import "pardon"

Provided by `./api.ts` here. Currently a grab-bag of functionality helpful for
writing helper scripts.

repackaging: build this to "./api.js" for runtime access.

### import "pardon/testing"

Methods for defining "units" and validating and/or extracting data from
responses.

### import "pardon/runtime"

Provides the method for initializing the pardon systems, for integrating the
pardon runtime into other environments.

### import "pardon/loader"

(internal, do not use directly.)

Used internally for initializing the system, this needs to be its own artifact
especially when running on older versions of node.

repackaging: build this to "./loader.js" for runtime access.

### import "pardon/formats"

Provides the pardon formats (https, kv, curl) without the rest of the runtime.
This import is safe for front-end / non-node environments.

### import "pardon/utils"

(internal, do not use.)

Sharing some small mapping utilities directly with ux.
