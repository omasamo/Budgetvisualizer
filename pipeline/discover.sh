#!/usr/bin/env bash
# One-off discovery: download the MF SR open data catalog and candidate datasets
# so their structure can be inspected. Files are saved unchanged.
set -u
out=data/raw/sk/_discovery/round4
mkdir -p "$out"
UA="Mozilla/5.0 (compatible; budget-visualizer data fetch; +https://github.com/omasamo/Budgetvisualizer)"
get() { # name url
  curl -sSL -A "$UA" -m 180 -o "$out/$1" -w "$1\t%{http_code}\t%{size_download}\t%{content_type}\t$2\n" "$2" || printf "%s\tFAILED\t\t\t%s\n" "$1" "$2"
}
{
printf "file\thttp\tbytes\ttype\turl\n"
base="https://rozpocet.sk/rest/api/"
for p in rozpocet/rozpoctyPodorganizaciiVSOrg/0/2026/10 rozpocet/rozpoctyPodorganizaciiVSOrg/0/2026/9 rozpocet/rozpoctyPodorganizaciiVSOrg/0/2025/12 \
         rozpocet/rozpoctyPodorganizaciiVSOrg/0/2024/12 rozpocet/rozpocetVSOrg/0/2026/10 rozpocet/rozpocetVSOrg/10003/2026/10 \
         rozpocet/rozpoctyVSOrg/0/2016/2026/12/true rozpocet/rozpoctyVSOrg/0/2016/2026/0/true "rozpocet/rozpocetSumarVSOrg/0/2026/10?EKV=SpoluV&DRH=21" \
         rozpocet/uzavierkaRozpoctu/VS/2026/SKU rozpocet/uzavierkaRozpoctu/VS/2026/SCH rozpocet/uzavierkaRozpoctu/VS/2026/UPR \
         rozpocet/poslednaAktualizacia/SR/VS/UPR rozpocet/poslednaAktualizacia/SR/VS/SKU "organizacie/info/sk/VS/0/2026/2"; do
  sleep 1
  get "$(echo "$p" | tr '/?&=' '____')" "$base$p"
done
} > "$out/_index.tsv"
cat "$out/_index.tsv"
