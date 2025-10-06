# Pardon Hook Features

## Persist

Saves request and response values into the database.

## Trace

Traces the awaited flow of http requests (esp. for tracking the call dependency
structure in unit tests).

## Content-Encodings

Adds decoding of content-encoding types: br, zlib, deflate, zlib, because they
need to be hooked up for some reason.

## Uncidi

Uses `undici`'s request rather than the standard `fetch`, allowing DNS
resolution to be overridden.
