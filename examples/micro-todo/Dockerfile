# One image for all three mini services; docker-compose picks which to run via
# `command`. Build context is the examples/ directory so the shared lib/ (mini
# router, signal, server) can be copied alongside micro-todo/.
#
#   docker build -f micro-todo/Dockerfile -t micro-todo .    # run from examples/
FROM node:22-alpine
WORKDIR /app

# no dependencies to install — these are zero-dep mini services
COPY lib ./lib
COPY micro-todo ./micro-todo

WORKDIR /app/micro-todo

# default; overridden per-service by docker-compose `command`
CMD ["node", "api/server"]
