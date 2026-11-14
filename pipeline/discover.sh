#!/usr/bin/env bash
# One-off discovery: download the MF SR open data catalog and candidate datasets
# so their structure can be inspected. Files are saved unchanged.
set -u
out=data/raw/sk/_discovery/round3
mkdir -p "$out"
UA="Mozilla/5.0 (compatible; budget-visualizer data fetch; +https://github.com/omasamo/Budgetvisualizer)"
get() { # name url
  curl -sSL -A "$UA" -m 180 -o "$out/$1" -w "$1\t%{http_code}\t%{size_download}\t%{content_type}\t$2\n" "$2" || printf "%s\tFAILED\t\t\t%s\n" "$1" "$2"
}
{
printf "file\thttp\tbytes\ttype\turl\n"
for base in "https://rozpocet.sk/rest/api/" "https://rozpocet.sk/web/rest/api/"; do
  b=$(echo "$base" | md5sum | cut -c1-4)
  for p in service-info rozpocet/sumareZaRoky rozpocet/aktualizacie rozpocet/poslednaAktualizacia/PLNENIE/VS/SKU rozpocet/poslednaAktualizacia/SR/VS/SCH \
           organizacie/podurovne/sk/VS/0 organizacie/podurovne/sk/VS/1 organizacia/info/sk/VS/0 organizacia/info/sk/VS/1 \
           rozpocet/konsolidovanyRozpocet/sk/2026 rozpocet/rozpoctyPodorganizaciiVSOrg/0/2026/SKU rozpocet/rozpoctyPodorganizaciiVSOrg/1/2026/SKU \
           rozpocet/rozpocetVSOrg/1/2026/SKU rozpocet/stavUzavrierky/VS/2026/SKU; do
    get "${b}_$(echo $p | tr '/' '_')" "$base$p"
  done
done
get ris_views_parts.js "https://rozpocet.sk/web/app/views-parts.js"
get ris_views_layouts.js "https://rozpocet.sk/web/app/views-layouts.js"
get ris_directives.js "https://rozpocet.sk/web/app/directives.js"
get ris_locale_sk.json "https://rozpocet.sk/web/i18n/locale-sk.json"
} > "$out/_index.tsv"
cat "$out/_index.tsv"
