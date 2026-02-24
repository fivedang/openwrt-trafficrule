#!/bin/sh
# trafficrule - TLS SNI parser (shell fallback)
# Reads tcpdump -l -n -x output from stdin, extracts SNI hostnames
# This is a best-effort shell implementation; prefer sniextract binary when available.

. /usr/lib/trafficrule/common.sh

. /lib/functions.sh
load_config
ensure_dirs

# Accumulate hex dump lines into complete packets, then parse
# tcpdump -x output format:
#   14:30:00.123 IP 192.168.1.100.12345 > 1.2.3.4.443: Flags [S], ...
#     0x0000:  4500 0052 ...
#     0x0010:  ...

hex_buf=""

process_packet() {
    local hex="$1"
    [ -z "$hex" ] && return

    # Use awk to parse the hex data and extract SNI
    domain="$(echo "$hex" | awk '
    BEGIN {
        n = 0
    }
    {
        for (i = 1; i <= NF; i++) {
            # Each token is a 4-char hex pair (2 bytes)
            h = $i
            if (length(h) == 4) {
                byte1 = substr(h, 1, 2)
                byte2 = substr(h, 3, 2)
                hex_arr[n] = byte1; n++
                hex_arr[n] = byte2; n++
            }
        }
    }
    END {
        if (n < 60) exit

        # Find IP header length (IHL)
        cmd = "printf \"%d\" 0x" hex_arr[0]
        cmd | getline val; close(cmd)
        ihl = and(val, 15) * 4

        # TCP header: data offset is at byte ihl+12, upper nibble
        tcp_off_idx = ihl + 12
        if (tcp_off_idx >= n) exit
        cmd = "printf \"%d\" 0x" hex_arr[tcp_off_idx]
        cmd | getline val; close(cmd)
        tcp_hdr_len = int(val / 16) * 4

        # TLS data starts at ihl + tcp_hdr_len
        tls_start = ihl + tcp_hdr_len
        if (tls_start + 5 >= n) exit

        # Verify TLS handshake (0x16) and ClientHello (0x01)
        if (hex_arr[tls_start] != "16") exit
        if (hex_arr[tls_start + 5] != "01") exit

        # ClientHello starts at tls_start + 5
        # Skip: handshake type(1) + length(3) + version(2) + random(32) = 38 bytes
        pos = tls_start + 5 + 38

        # Session ID length
        if (pos >= n) exit
        cmd = "printf \"%d\" 0x" hex_arr[pos]
        cmd | getline sid_len; close(cmd)
        pos = pos + 1 + sid_len

        # Cipher suites length (2 bytes)
        if (pos + 1 >= n) exit
        cmd = "printf \"%d\" 0x" hex_arr[pos] hex_arr[pos+1]
        cmd | getline cs_len; close(cmd)
        pos = pos + 2 + cs_len

        # Compression methods length (1 byte)
        if (pos >= n) exit
        cmd = "printf \"%d\" 0x" hex_arr[pos]
        cmd | getline cm_len; close(cmd)
        pos = pos + 1 + cm_len

        # Extensions length (2 bytes)
        if (pos + 1 >= n) exit
        cmd = "printf \"%d\" 0x" hex_arr[pos] hex_arr[pos+1]
        cmd | getline ext_total; close(cmd)
        pos = pos + 2

        ext_end = pos + ext_total
        if (ext_end > n) ext_end = n

        # Walk extensions to find SNI (type 0x0000)
        while (pos + 4 < ext_end) {
            cmd = "printf \"%d\" 0x" hex_arr[pos] hex_arr[pos+1]
            cmd | getline ext_type; close(cmd)
            cmd = "printf \"%d\" 0x" hex_arr[pos+2] hex_arr[pos+3]
            cmd | getline ext_len; close(cmd)
            pos = pos + 4

            if (ext_type == 0) {
                # SNI extension found
                # SNI list length (2) + type (1) + name length (2) = skip 5 bytes
                sni_pos = pos + 5
                cmd = "printf \"%d\" 0x" hex_arr[pos+3] hex_arr[pos+4]
                cmd | getline sni_len; close(cmd)

                if (sni_pos + sni_len <= n) {
                    sni = ""
                    for (j = 0; j < sni_len; j++) {
                        cmd = "printf \"\\\\x" hex_arr[sni_pos + j] "\""
                        cmd | getline ch; close(cmd)
                        sni = sni ch
                    }
                    if (sni ~ /^[a-zA-Z0-9]/ && sni ~ /\./) {
                        print sni
                    }
                }
                exit
            }
            pos = pos + ext_len
        }
    }
    ')"

    [ -n "$domain" ] && add_pending_domain "$domain"
}

while IFS= read -r line; do
    case "$line" in
        *" IP "*" > "*)
            # New packet header line — process previous buffer
            process_packet "$hex_buf"
            hex_buf=""
            ;;
        "	0x"*|"        0x"*)
            # Hex dump continuation line
            # Strip offset prefix (e.g., "0x0010:  ") and keep hex data
            cleaned="$(echo "$line" | sed 's/^[[:space:]]*0x[0-9a-f]*:[[:space:]]*//')"
            hex_buf="${hex_buf} ${cleaned}"
            ;;
    esac
done

# Process last packet
process_packet "$hex_buf"
