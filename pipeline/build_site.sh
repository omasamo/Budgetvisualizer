#!/usr/bin/env bash
# Assemble the static site: site/ plus the processed data under data/.
# Usage: bash pipeline/build_site.sh <output-dir>
set -euo pipefail
out="${1:-_site}"
rm -rf "$out"
mkdir -p "$out/data"
cp -r site/. "$out/"
for d in data/processed/*/; do
  cc=$(basename "$d")
  mkdir -p "$out/data/$cc"
  cp "$d"*.json "$out/data/$cc/"
done
cp data/countries.json "$out/data/countries.json"
touch "$out/.nojekyll"
echo "Built $out"
