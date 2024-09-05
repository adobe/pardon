#!/usr/bin/env zsh

mkdir -p ./pardon.iconset
sips -z 16 16      ./pardon-icon-tiny.png --out pardon.iconset/icon_16x16.png
sips -z 32 32      ./pardon-icon-tiny.png --out pardon.iconset/icon_16x16@2x.png
sips -z 32 32      ./pardon-icon-small.png --out pardon.iconset/icon_32x32.png
sips -z 64 64      ./pardon-icon-small.png --out pardon.iconset/icon_32x32@2x.png
sips -z 128 128    ./pardon-icon.png --out pardon.iconset/icon_128x128.png
sips -z 256 256    ./pardon-icon.png --out pardon.iconset/icon_128x128@2x.png
sips -z 256 256    ./pardon-icon.png --out pardon.iconset/icon_256x256.png
sips -z 512 512    ./pardon-icon.png --out pardon.iconset/icon_256x256@2x.png
sips -z 512 512    ./pardon-icon.png --out pardon.iconset/icon_512x512.png
sips -z 1024 1024  ./pardon-icon.png --out pardon.iconset/icon_512x512@2x.png
iconutil -c icns -o icon.icns pardon.iconset && rm -rf ./pardon.iconset

mkdir -p ./pardon-pngs
sips -z 16 16      ./pardon-icon-tiny.png --out pardon-pngs/16.png
sips -z 24 24      ./pardon-icon-tiny.png --out pardon-pngs/24.png
sips -z 32 32      ./pardon-icon-small.png --out pardon-pngs/32.png
sips -z 48 48      ./pardon-icon-small.png --out pardon-pngs/48.png
sips -z 57 57      ./pardon-icon-small.png --out pardon-pngs/57.png
sips -z 64 64      ./pardon-icon-small.png --out pardon-pngs/64.png
for size in 72 96 120 128 144 152 195 228 256 512 1024; do
  sips -z $size $size ./pardon-icon.png --out pardon-pngs/$size.png
done

mkdir -p ./gen
npx icon-gen -i ./pardon-pngs -o ./gen --ico --ico-name=icon

mv ./gen/icon.ico .

rm -rf ./pardon-pngs ./gen
