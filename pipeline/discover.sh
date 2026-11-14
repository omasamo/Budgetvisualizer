#!/usr/bin/env bash
# One-off discovery: download the MF SR open data catalog and candidate datasets
# so their structure can be inspected. Files are saved unchanged.
set -u
out=data/raw/sk/_discovery
mkdir -p "$out"
UA="Mozilla/5.0 (compatible; budget-visualizer data fetch; +https://github.com/omasamo/Budgetvisualizer)"
get() { # name url
  curl -sSL -A "$UA" -m 180 -o "$out/$1" -w "$1\t%{http_code}\t%{size_download}\t%{content_type}\t$2\n" "$2" || printf "%s\tFAILED\t\t\t%s\n" "$1" "$2"
}
{
printf "file\thttp\tbytes\ttype\turl\n"
get catalog.csv "https://opendata.mfsr.sk/en/mi/opendata/catalogexport?output=csv"
get catalog-sk.csv "https://opendata.mfsr.sk/mi/opendata/catalogexport?output=csv"
get catalog.jsonld "https://opendata.mfsr.sk/en/mi/opendata/catalog/lkod"
get openapi.html "https://opendata.mfsr.sk/en/mi/page/openapi"
get plnenie_narodna.xlsx "https://opendata.mfsr.sk/mi/opendata/download/plnenie-statneho-rozpoctu-sr-v-narodnej-metodike/1"
get priebezne.xls "https://opendata.mfsr.sk/mi/opendata/download/priebezne-plnenie-statneho-rozpoctu/1"
get vyvoj_vydavkov.bin "https://opendata.mfsr.sk/mi/opendata/download/vyvoj-vydavkov-sp/1"
get it_vydavky_kapitol.bin "https://opendata.mfsr.sk/mi/opendata/download/vydavky-kapitol-statneho-rozpoctu-na-informacne-technologie/1"
for y in 2020 2021 2022 2023 2024 2025; do
  get szu_hotovost_$y.xlsx "https://opendata.mfsr.sk/mi/opendata/download/tabulky-k-hotovostnemu-cerpaniu-sr-v-szu-za-rok-$y/1"
  get szu_navrh_$y.xlsx "https://opendata.mfsr.sk/mi/opendata/download/tabulky-z-navrhu-szu-za-rok-$y/1"
done
get cat208.html "https://opendata.mfsr.sk/mi/opendata/category/208-sekcia-statneho-vykaznictva"
get cat216.html "https://opendata.mfsr.sk/mi/opendata/category/216-prijmy-a-vydavky-verejnej-spravy"
get rozpocet_web.html "https://rozpocet.sk/web/"
get mfsr_sr.html "https://www.mfsr.sk/sk/financie/verejne-financie/statny-rozpocet/"
get mfsr_plnenie.html "https://www.mfsr.sk/sk/financie/verejne-financie/plnenie-statneho-rozpoctu/"
} > "$out/_index.tsv"
cat "$out/_index.tsv"
