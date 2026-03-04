#!/bin/sh
# trafficrule - common function library

TRAFFICRULE_TMP="/tmp/trafficrule"
TRAFFICRULE_ETC="/etc/trafficrule"
LOCK_DIR="${TRAFFICRULE_TMP}/.lock"
LOG_FILE="${TRAFFICRULE_TMP}/trafficrule.log"
PENDING_FILE="${TRAFFICRULE_TMP}/pending.txt"
ACTIVE_SESSION_FILE="${TRAFFICRULE_TMP}/active_session"
CAPTURE_START_FILE="${TRAFFICRULE_TMP}/capture_start"
SESSION_TMP_DIR="${TRAFFICRULE_TMP}/sessions"
APPROVED_FILE="${TRAFFICRULE_ETC}/approved_domains.txt"
DIRECT_FILE="${TRAFFICRULE_ETC}/direct_domains.txt"
IGNORED_FILE="${TRAFFICRULE_ETC}/ignored_domains.txt"
SESSION_ETC_DIR="${TRAFFICRULE_ETC}/sessions"
RULE_PROVIDER_FILE="/etc/openclash/rule_provider/trafficrule_proxy.yaml"
DIRECT_RULE_PROVIDER_FILE="/etc/openclash/rule_provider/trafficrule_direct.yaml"
IP_RULE_PROVIDER_FILE="/etc/openclash/rule_provider/trafficrule_proxy_ip.yaml"
DIRECT_IP_RULE_PROVIDER_FILE="/etc/openclash/rule_provider/trafficrule_direct_ip.yaml"
CUSTOM_RULES_2_FILE="/etc/openclash/custom/openclash_custom_rules_2.list"

# UCI config variables (populated by load_config)
TR_ENABLED=""
TR_TARGET_IP=""
TR_INTERFACE=""
TR_PROXY_GROUP=""
TR_DIRECT_GROUP=""
TR_AUTO_RELOAD=""
TR_CAPTURE_DNS=""
TR_CAPTURE_SNI=""
TR_CAPTURE_IP=""
TR_MAX_PENDING=""

load_config() {
    config_load trafficrule
    config_get TR_ENABLED global enabled "0"
    config_get TR_TARGET_IP global target_ip ""
    config_get TR_INTERFACE global interface "br-lan"
    config_get TR_PROXY_GROUP global proxy_group "♻️ 自动选择"
    config_get TR_DIRECT_GROUP global direct_group "DIRECT"
    config_get TR_AUTO_RELOAD global auto_reload_clash "0"
    config_get TR_CAPTURE_DNS global capture_dns "1"
    config_get TR_CAPTURE_SNI global capture_sni "1"
    config_get TR_CAPTURE_IP global capture_ip "0"
    config_get TR_MAX_PENDING global max_pending "5000"
}

log_msg() {
    local level="$1"
    shift
    local msg="$*"
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "${timestamp} [${level}] ${msg}" >> "$LOG_FILE"
    logger -t trafficrule -p "daemon.${level}" "$msg"
}

ensure_dirs() {
    mkdir -p "$TRAFFICRULE_TMP" "$SESSION_TMP_DIR"
    mkdir -p "$TRAFFICRULE_ETC" "$SESSION_ETC_DIR"
    [ -f "$PENDING_FILE" ] || touch "$PENDING_FILE"
    [ -f "$APPROVED_FILE" ] || touch "$APPROVED_FILE"
    [ -f "$DIRECT_FILE" ] || touch "$DIRECT_FILE"
    [ -f "$IGNORED_FILE" ] || touch "$IGNORED_FILE"
}

acquire_lock() {
    local max_wait="${1:-10}"
    local waited=0
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
        waited=$((waited + 1))
        if [ "$waited" -ge "$max_wait" ]; then
            log_msg err "Failed to acquire lock after ${max_wait}s"
            return 1
        fi
        sleep 1
    done
    return 0
}

release_lock() {
    rmdir "$LOCK_DIR" 2>/dev/null
}

# Check if a domain is in a given file (exact line match)
domain_in_file() {
    local domain="$1"
    local file="$2"
    [ -f "$file" ] && grep -qxF "$domain" "$file"
}

# Filter a domain: skip local domains, already known domains
is_domain_valid() {
    local domain="$1"
    # Skip empty
    [ -z "$domain" ] && return 1
    # Skip local/internal domains
    case "$domain" in
        *.local|*.lan|*.arpa|*.localhost|*.internal|localhost)
            return 1
            ;;
    esac
    # Skip if already in any list
    domain_in_file "$domain" "$APPROVED_FILE" && return 1
    domain_in_file "$domain" "$DIRECT_FILE" && return 1
    domain_in_file "$domain" "$IGNORED_FILE" && return 1
    domain_in_file "$domain" "$PENDING_FILE" && return 1
    return 0
}

# Filter an IP address: skip private/reserved, already known
is_ip_valid() {
    local ip="$1"
    [ -z "$ip" ] && return 1
    # Skip private/reserved ranges
    case "$ip" in
        10.*|172.16.*|172.17.*|172.18.*|172.19.*|172.2[0-9].*|172.3[01].*|192.168.*|127.*|0.*|255.*|224.*)
            return 1
            ;;
    esac
    # Skip if already in any list
    domain_in_file "$ip" "$APPROVED_FILE" && return 1
    domain_in_file "$ip" "$DIRECT_FILE" && return 1
    domain_in_file "$ip" "$IGNORED_FILE" && return 1
    domain_in_file "$ip" "$PENDING_FILE" && return 1
    return 0
}

add_pending_domain() {
    local domain="$1"
    is_domain_valid "$domain" || return 0

    acquire_lock 5 || return 1
    # Double-check after acquiring lock (race condition guard)
    if ! domain_in_file "$domain" "$PENDING_FILE"; then
        # Enforce max_pending limit
        if [ -n "$TR_MAX_PENDING" ]; then
            local count
            count="$(wc -l < "$PENDING_FILE" 2>/dev/null || echo 0)"
            if [ "$count" -ge "$TR_MAX_PENDING" ]; then
                release_lock
                return 0
            fi
        fi
        echo "$domain" >> "$PENDING_FILE"
    fi
    release_lock

    # Also add to active session if one exists
    add_session_domain "$domain"
}

add_pending_ip() {
    local ip="$1"
    is_ip_valid "$ip" || return 0

    acquire_lock 5 || return 1
    if ! domain_in_file "$ip" "$PENDING_FILE"; then
        if [ -n "$TR_MAX_PENDING" ]; then
            local count
            count="$(wc -l < "$PENDING_FILE" 2>/dev/null || echo 0)"
            if [ "$count" -ge "$TR_MAX_PENDING" ]; then
                release_lock
                return 0
            fi
        fi
        echo "$ip" >> "$PENDING_FILE"
    fi
    release_lock

    add_session_domain "$ip"
}

get_active_session() {
    if [ -f "$ACTIVE_SESSION_FILE" ]; then
        cat "$ACTIVE_SESSION_FILE"
    fi
}

add_session_domain() {
    local domain="$1"
    local session
    session="$(get_active_session)"
    [ -z "$session" ] && return 0

    local session_file="${SESSION_TMP_DIR}/${session}.txt"
    acquire_lock 5 || return 1
    if ! domain_in_file "$domain" "$session_file"; then
        echo "$domain" >> "$session_file"
    fi
    release_lock
}

# Remove a domain from a file (in place, no lock — caller must hold lock)
remove_domain_from_file() {
    local domain="$1"
    local file="$2"
    if [ -f "$file" ] && grep -qxF "$domain" "$file"; then
        local tmpf="${file}.tmp"
        grep -vxF "$domain" "$file" > "$tmpf" 2>/dev/null || true
        mv "$tmpf" "$file"
    fi
}

# Remove domains listed in src_file from target_file (bulk, no lock — caller must hold lock)
remove_domains_bulk() {
    local src_file="$1"
    local target_file="$2"
    if [ -s "$target_file" ] && [ -s "$src_file" ]; then
        local tmpf="${target_file}.tmp"
        grep -vxFf "$src_file" "$target_file" > "$tmpf" 2>/dev/null || true
        mv "$tmpf" "$target_file"
    fi
}

# Check if a string looks like an IPv4 address
is_ipv4() {
    echo "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
}

# Count lines in a file (0 if file doesn't exist or is empty)
count_lines() {
    local file="$1"
    if [ -f "$file" ] && [ -s "$file" ]; then
        wc -l < "$file" | tr -d ' '
    else
        echo 0
    fi
}
