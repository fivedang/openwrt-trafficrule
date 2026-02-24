/*
 * sniextract - Extract TLS SNI hostnames from tcpdump -x hex output
 *
 * Reads tcpdump "-l -n -x" output from stdin. For each packet, parses
 * the hex dump to locate IP header -> TCP header -> TLS ClientHello ->
 * SNI extension, and prints the server name to stdout.
 *
 * Usage: tcpdump -l -n -x -i eth0 -s 512 'tcp dst port 443 ...' | sniextract
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#define MAX_PACKET_BYTES 2048

static unsigned char packet[MAX_PACKET_BYTES];
static int packet_len;

static int hex_to_byte(const char *s)
{
    int val = 0;
    int i;
    for (i = 0; i < 2; i++) {
        char c = s[i];
        val <<= 4;
        if (c >= '0' && c <= '9')
            val |= c - '0';
        else if (c >= 'a' && c <= 'f')
            val |= c - 'a' + 10;
        else if (c >= 'A' && c <= 'F')
            val |= c - 'A' + 10;
        else
            return -1;
    }
    return val;
}

static void parse_hex_line(const char *line)
{
    /* Skip leading whitespace and offset like "0x0010:  " */
    const char *p = line;
    while (*p && isspace((unsigned char)*p))
        p++;
    if (strncmp(p, "0x", 2) != 0)
        return;
    /* Skip past "0xNNNN:" */
    while (*p && *p != ':')
        p++;
    if (*p == ':')
        p++;

    /* Parse hex pairs like "4500 0052 abcd ..." */
    while (*p && packet_len < MAX_PACKET_BYTES) {
        while (*p && isspace((unsigned char)*p))
            p++;
        if (!*p)
            break;

        /* Expect 4-char hex token (2 bytes) */
        if (isxdigit((unsigned char)p[0]) && isxdigit((unsigned char)p[1])) {
            int b1 = hex_to_byte(p);
            if (b1 >= 0 && packet_len < MAX_PACKET_BYTES) {
                packet[packet_len++] = (unsigned char)b1;
            }
            p += 2;
            if (isxdigit((unsigned char)p[0]) && isxdigit((unsigned char)p[1])) {
                int b2 = hex_to_byte(p);
                if (b2 >= 0 && packet_len < MAX_PACKET_BYTES) {
                    packet[packet_len++] = (unsigned char)b2;
                }
                p += 2;
            }
        } else {
            p++;
        }
    }
}

static int is_valid_hostname_char(unsigned char c)
{
    return isalnum(c) || c == '.' || c == '-';
}

static void extract_sni(void)
{
    if (packet_len < 60)
        return;

    /* IP header length (IHL) */
    int ihl = (packet[0] & 0x0F) * 4;
    if (ihl < 20 || ihl >= packet_len)
        return;

    /* TCP data offset */
    int tcp_start = ihl;
    if (tcp_start + 13 >= packet_len)
        return;
    int tcp_hdr_len = ((packet[tcp_start + 12] & 0xF0) >> 4) * 4;
    if (tcp_hdr_len < 20)
        return;

    /* TLS record starts after IP + TCP headers */
    int tls_start = ihl + tcp_hdr_len;
    if (tls_start + 6 >= packet_len)
        return;

    /* Check: ContentType = Handshake (0x16) */
    if (packet[tls_start] != 0x16)
        return;

    /* Check: Handshake type = ClientHello (0x01) */
    if (packet[tls_start + 5] != 0x01)
        return;

    /* ClientHello body starts at tls_start + 5 (after record header) */
    int pos = tls_start + 5;

    /* Skip handshake header: type(1) + length(3) + client_version(2) + random(32) = 38 */
    pos += 38;
    if (pos >= packet_len)
        return;

    /* Session ID */
    int sid_len = packet[pos];
    pos += 1 + sid_len;
    if (pos + 2 > packet_len)
        return;

    /* Cipher suites */
    int cs_len = (packet[pos] << 8) | packet[pos + 1];
    pos += 2 + cs_len;
    if (pos + 1 > packet_len)
        return;

    /* Compression methods */
    int cm_len = packet[pos];
    pos += 1 + cm_len;
    if (pos + 2 > packet_len)
        return;

    /* Extensions total length */
    int ext_total = (packet[pos] << 8) | packet[pos + 1];
    pos += 2;

    int ext_end = pos + ext_total;
    if (ext_end > packet_len)
        ext_end = packet_len;

    /* Walk extensions */
    while (pos + 4 <= ext_end) {
        int ext_type = (packet[pos] << 8) | packet[pos + 1];
        int ext_len = (packet[pos + 2] << 8) | packet[pos + 3];
        pos += 4;

        if (ext_type == 0x0000 && ext_len >= 5) {
            /* SNI extension */
            /* SNI list length (2) + host type (1) + name length (2) */
            int sni_name_len = (packet[pos + 3] << 8) | packet[pos + 4];
            int sni_start = pos + 5;

            if (sni_start + sni_name_len <= packet_len && sni_name_len > 0 && sni_name_len < 256) {
                /* Validate and print hostname */
                int valid = 1;
                int has_dot = 0;
                int i;
                for (i = 0; i < sni_name_len; i++) {
                    unsigned char c = packet[sni_start + i];
                    if (!is_valid_hostname_char(c)) {
                        valid = 0;
                        break;
                    }
                    if (c == '.')
                        has_dot = 1;
                }
                if (valid && has_dot) {
                    fwrite(packet + sni_start, 1, sni_name_len, stdout);
                    putchar('\n');
                    fflush(stdout);
                }
            }
            return;
        }
        pos += ext_len;
    }
}

static void process_packet(void)
{
    if (packet_len > 0) {
        extract_sni();
        packet_len = 0;
    }
}

int main(void)
{
    char line[4096];

    packet_len = 0;

    while (fgets(line, sizeof(line), stdin)) {
        /* Remove trailing newline */
        int len = strlen(line);
        if (len > 0 && line[len - 1] == '\n')
            line[len - 1] = '\0';

        /* Detect packet header line (contains " IP " and " > ") */
        if (strstr(line, " IP ") && strstr(line, " > ")) {
            process_packet();
            /* Header line itself has no hex data */
            continue;
        }

        /* Detect hex dump line */
        const char *p = line;
        while (*p && isspace((unsigned char)*p))
            p++;
        if (strncmp(p, "0x", 2) == 0) {
            parse_hex_line(line);
        }
    }

    /* Process last buffered packet */
    process_packet();

    return 0;
}
