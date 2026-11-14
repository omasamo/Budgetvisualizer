#!/usr/bin/env bash
# One-off discovery: download the MF SR open data catalog and candidate datasets
# so their structure can be inspected. Files are saved unchanged.
set -u
out=data/raw/sk/_discovery/round2
mkdir -p "$out"
UA="Mozilla/5.0 (compatible; budget-visualizer data fetch; +https://github.com/omasamo/Budgetvisualizer)"
get() { # name url
  curl -sSL -A "$UA" -m 180 -o "$out/$1" -w "$1\t%{http_code}\t%{size_download}\t%{content_type}\t$2\n" "$2" || printf "%s\tFAILED\t\t\t%s\n" "$1" "$2"
}
{
printf "file\thttp\tbytes\ttype\turl\n"
for f in init.js common/services.js app/services.js app/rozpocet.js common/app.js app/app.js app/controllers.js; do
  get "ris_$(echo $f | tr / _)" "https://rozpocet.sk/web/$f"
done
get od_show_szu2024.html "https://opendata.mfsr.sk/mi/opendata/show/tabulky-k-hotovostnemu-cerpaniu-sr-v-szu-za-rok-2024"
get mfsr_rozpocet_ludi_2026.html "https://www.mfsr.sk/sk/verejnost/rozpocet-ludi-2026/"
get mfsr_home.html "https://www.mfsr.sk/sk/"
} > "$out/_index.tsv"
cat "$out/_index.tsv"
