#!/bin/sh
# trafficrule - DNS query parser
# Reads tcpdump -l -n output from stdin, extracts queried domain names

. /usr/lib/trafficrule/common.sh

# Ensure config is loaded for max_pending check in add_pending_domain
. /lib/functions.sh
load_config
ensure_dirs

# Parse tcpdump DNS output line by line
# Expected format: "14:19:06.123 IP 192.168.1.100.53852 > 8.8.8.8.53: 26977+ A? play.google.com. (33)"
# Also matches: AAAA?, MX?, CNAME?, etc.

while read -r line; do
    # Extract domain from DNS query lines containing "A?" or "AAAA?" etc.
    domain="$(echo "$line" | awk '
        /[A-Z]+\?/ {
            for (i = 1; i <= NF; i++) {
                if ($i ~ /^(A|AAAA|CNAME|MX|TXT|SRV|NS|SOA|PTR)\?$/) {
                    domain = $(i+1)
                    # Remove trailing dot and parenthesis/length info
                    gsub(/\.$/, "", domain)
                    gsub(/[^a-zA-Z0-9._-]/, "", domain)
                    if (domain ~ /^[a-zA-Z0-9]/ && domain ~ /\./) {
                        print domain
                    }
                    exit
                }
            }
        }
    ')"

    [ -n "$domain" ] && add_pending_domain "$domain"
done
