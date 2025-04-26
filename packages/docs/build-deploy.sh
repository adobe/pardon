#/usr/bin/env bash

set -e

source .env || true
npm run build

ORIGIN="$( git remote get-url adobe )"

(
  cd dist/
  git init .
  touch .nojekyll
  echo .DS_Store >.gitignore
  git add .
  git branch -m "gh-pages"
  git commit -m'astro docs'
  git remote add origin "${ORIGIN}"
  git push -f origin HEAD
)
