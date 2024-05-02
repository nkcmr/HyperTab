#!/bin/bash

set -euxo pipefail

release_version="$(git describe --tags)"
release_folder=".release-HyperTab-$release_version"

rm -rf .release-* HyperTab-*.zip
mkdir "$release_folder"

# shellcheck disable=SC2046
cp -rv $(jq -r '.releaseArtifacts[]' package.json) "$release_folder/"

jq \
  --arg newVersion "$release_version" \
  '.version = $newVersion' \
  "$release_folder/manifest.json" > \
  "$release_folder/manifest.json.tmp"

rm -vf "$release_folder/manifest.json"
mv -v "$release_folder/manifest.json.tmp" \
  "$release_folder/manifest.json"

(
  cd "$release_folder" &&
    zip -r9 "../HyperTab-$release_version.zip" ./*
)
