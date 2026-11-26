#!/usr/bin/env sh
# Fetch the human avatar, a man from the Microsoft Rocketbox library (MIT),
# into huri_playground/static/avatar/man/, where avatar.js looks for him.
#
#     scripts/fetch_avatar.sh [Male_Adult_08]
#
# The model is the "_facial" export: the avatar with ARKit (52), Oculus viseme
# (15) and FACS blend shapes, so his mouth opens with the voice and he blinks.
# Its textures are 2048 px TGAs (12-16 MB each); they are converted to WebP,
# which the browser loads, with ImageMagick (`magick`). Like Mouse-Man, the
# files stay out of git (.gitignore: huri_playground/static/avatar/).
set -eu

AVATAR="${1:-Male_Adult_08}"
# Rocketbox master on 2022-10-02 (ARKit blend shapes are in since 2022-06).
REF=0943055db6ec570bcef9f2c8b41c9e5467c808f9
BASE="https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/$REF"
case "$AVATAR" in
  Male_Adult_* | Female_Adult_*) GROUP=Adults ;;
  *) echo "unknown avatar: $AVATAR (try Male_Adult_08)" >&2; exit 2 ;;
esac
SRC="$BASE/Assets/Avatars/$GROUP/$AVATAR"
DEST="$(cd "$(dirname "$0")/.." && pwd)/huri_playground/static/avatar/man"

command -v magick >/dev/null || { echo "ImageMagick (magick) is needed to convert the textures" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "fetching $AVATAR from Microsoft Rocketbox @ ${REF%"${REF#???????}"}"
curl -fsSL -o "$TMP/model.fbx" "$SRC/Export/${AVATAR}_facial.fbx"
curl -fsSL -o "$TMP/LICENSE" "$BASE/LICENSE.md"
# The texture names are the avatar's internal id (Male_Adult_08 is m014).
curl -fsSL "https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars/$GROUP/$AVATAR/Textures?ref=$REF" \
  | grep -o '"name": *"[^"]*\.tga"' | sed 's/.*"\([^"]*\)"$/\1/' > "$TMP/textures"
[ -s "$TMP/textures" ] || { echo "no textures listed for $AVATAR" >&2; exit 1; }

mkdir -p "$TMP/out"
while read -r tga; do
  curl -fsSL -o "$TMP/$tga" "$SRC/Textures/$tga"
  # Lossy, high quality; the hair/eyelash texture keeps its alpha channel.
  magick "$TMP/$tga" -quality 92 "$TMP/out/${tga%.tga}.webp"
done < "$TMP/textures"

rm -rf "$DEST"
mkdir -p "$DEST"
mv "$TMP/model.fbx" "$TMP/LICENSE" "$DEST/"
mv "$TMP/out/"*.webp "$DEST/"
echo "$AVATAR, Microsoft Rocketbox @ $REF (MIT, see LICENSE)" > "$DEST/SOURCE"
du -sh "$DEST"
