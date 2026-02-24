# TrafficRule for OpenWrt

Capture network traffic from a specific LAN device, extract visited domains (DNS + TLS SNI) and destination IPs, then classify them into proxy/direct rules for [OpenClash](https://github.com/vernesong/OpenClash).

## How It Works

```
Target Device ──> tcpdump (on router) ──> DNS Parser / SNI Parser / IP Extractor
                                                 │
                                          Pending List
                                                 │
                                     ┌───────────┼───────────┐
                                   Proxy       Direct      Ignore
                                     │           │
                              rule-provider YAML files
                                     │           │
                                  OpenClash (reload)
```

1. **Capture** - tcpdump monitors traffic from a selected LAN device, extracting domains from DNS queries, TLS SNI handshakes, and optionally destination IP addresses
2. **Classify** - Captured entries appear in a pending list; you select and classify each as Proxy, Direct, or Ignore
3. **Apply** - Classified entries are written to OpenClash rule-provider YAML files and optionally trigger an OpenClash reload

## Packages

| Package | Description |
|---------|-------------|
| `trafficrule` | Backend: capture daemon, CLI tool, shell libraries, procd service |
| `luci-app-trafficrule` | LuCI web UI: Overview, Capture, Rules, Settings pages |
| `trafficrule-sniextract` | Optional: compiled C binary for faster TLS SNI parsing |

## LuCI Pages

- **Overview** - Service status, domain counts, LAN device list with Monitor button
- **Capture** - Start/Stop/Restart capture, view pending domains in real-time, classify (Proxy/Direct/Ignore), Apply to OpenClash
- **Rules** - Browse and manage Proxy/Direct/Ignored lists, move entries between lists, Apply
- **Settings** - Interface, proxy/direct groups, capture modes (DNS/SNI/IP), auto-reload toggle

## Installation

### From Source (OpenWrt SDK)

```sh
# Clone into your OpenWrt packages directory
git clone https://github.com/fivedang/openwrt-trafficrule.git package/trafficrule

# Build
make package/trafficrule/compile V=s
make package/luci-app-trafficrule/compile V=s

# Install generated .ipk files on your router
opkg install trafficrule_*.ipk luci-app-trafficrule_*.ipk
```

### Manual Deploy

```sh
# Backend
scp trafficrule/files/usr/sbin/trafficrule root@<router>:/usr/sbin/
scp trafficrule/files/usr/bin/trafficrule-capture root@<router>:/usr/bin/
scp trafficrule/files/usr/lib/trafficrule/*.sh root@<router>:/usr/lib/trafficrule/
scp trafficrule/files/etc/init.d/trafficrule root@<router>:/etc/init.d/
scp trafficrule/files/etc/config/trafficrule root@<router>:/etc/config/

# Frontend
scp luci-app-trafficrule/htdocs/luci-static/resources/view/trafficrule/*.js \
    root@<router>:/www/luci-static/resources/view/trafficrule/
scp luci-app-trafficrule/root/usr/libexec/rpcd/luci.trafficrule \
    root@<router>:/usr/libexec/rpcd/
scp luci-app-trafficrule/root/usr/share/luci/menu.d/luci-app-trafficrule.json \
    root@<router>:/usr/share/luci/menu.d/
scp luci-app-trafficrule/root/usr/share/rpcd/acl.d/luci-app-trafficrule.json \
    root@<router>:/usr/share/rpcd/acl.d/

# Clear cache and restart
ssh root@<router> 'rm -rf /tmp/luci-modulecache/ /tmp/luci-indexcache* /tmp/luci-sessions/; \
    /etc/init.d/rpcd restart; /etc/init.d/uhttpd restart'
```

## CLI Usage

```sh
trafficrule start                  # Start capture (via procd)
trafficrule stop                   # Stop capture
trafficrule status                 # Show status and domain counts
trafficrule monitor <IP>           # Switch target device
trafficrule devices                # List LAN devices
trafficrule list [pending|approved|direct|ignored]
trafficrule approve <domain|all>   # Move to proxy list
trafficrule direct <domain|all>    # Move to direct list
trafficrule ignore <domain|all>    # Move to ignored list
trafficrule remove <approved|direct> <domain>
trafficrule apply                  # Write rules to OpenClash
trafficrule clear <list>           # Clear a list
trafficrule reset                  # Reset pending + sessions
```

## Configuration

UCI config at `/etc/config/trafficrule`:

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `0` | Enable the service |
| `target_ip` | (empty) | LAN IP to monitor |
| `interface` | `br-lan` | Network interface for tcpdump |
| `proxy_group` | `Proxy` | OpenClash proxy group name |
| `direct_group` | `DIRECT` | OpenClash direct group name |
| `auto_reload_clash` | `0` | Restart OpenClash after Apply |
| `capture_dns` | `1` | Extract domains from DNS queries |
| `capture_sni` | `1` | Extract domains from TLS SNI |
| `capture_ip` | `0` | Capture destination IP addresses |
| `max_pending` | `5000` | Max entries in pending list |

## Key Design Decisions

- **Procd-managed service** - The capture daemon runs under procd with respawn. `trafficrule start/stop` always goes through `/etc/init.d/trafficrule` to keep procd state consistent (no `killall`)
- **Mutual exclusivity** - A domain/IP can only exist in one list (proxy, direct, or ignored). Moving an entry automatically removes it from all other lists
- **Separate rule-providers for IPs** - Domains use `behavior: domain`, IPs use `behavior: ipcidr` with `/32` notation, generating up to 4 rule-provider YAML files
- **Non-destructive capture** - Approved/direct/ignored lists persist in `/etc/trafficrule/`; only the pending list is cleared on start

## Dependencies

- `tcpdump` (required)
- `luci-base` (for web UI)
- OpenClash (target rule engine)

## License

MIT
