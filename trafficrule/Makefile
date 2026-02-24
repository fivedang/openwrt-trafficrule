include $(TOPDIR)/rules.mk

PKG_NAME:=trafficrule
PKG_VERSION:=1.2.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_MAINTAINER:=trafficrule

include $(INCLUDE_DIR)/package.mk

define Package/trafficrule
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Traffic capture to OpenClash proxy rules
  DEPENDS:=+tcpdump
  PKGARCH:=all
endef

define Package/trafficrule/description
  Monitors network traffic from a specified LAN device using tcpdump,
  extracts visited domains (via DNS queries and TLS SNI), and after
  manual review writes them into OpenClash proxy rules via rule-provider.
  Supports session-based App traffic isolation.
endef

define Package/trafficrule/conffiles
/etc/config/trafficrule
/etc/trafficrule/approved_domains.txt
/etc/trafficrule/ignored_domains.txt
/etc/trafficrule/direct_domains.txt
endef

define Build/Compile
ifdef CONFIG_PACKAGE_trafficrule-sniextract
	$(TARGET_CC) $(TARGET_CFLAGS) -o $(PKG_BUILD_DIR)/sniextract ./src/sniextract.c
endif
endef

define Package/trafficrule/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/trafficrule $(1)/etc/config/trafficrule

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/trafficrule $(1)/etc/init.d/trafficrule

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/trafficrule-capture $(1)/usr/bin/trafficrule-capture

	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/trafficrule $(1)/usr/sbin/trafficrule

	$(INSTALL_DIR) $(1)/usr/lib/trafficrule
	$(INSTALL_DATA) ./files/usr/lib/trafficrule/common.sh $(1)/usr/lib/trafficrule/common.sh
	$(INSTALL_BIN) ./files/usr/lib/trafficrule/dns_parser.sh $(1)/usr/lib/trafficrule/dns_parser.sh
	$(INSTALL_BIN) ./files/usr/lib/trafficrule/sni_parser.sh $(1)/usr/lib/trafficrule/sni_parser.sh

	$(INSTALL_DIR) $(1)/etc/trafficrule/sessions
	touch $(1)/etc/trafficrule/approved_domains.txt
	touch $(1)/etc/trafficrule/ignored_domains.txt
	touch $(1)/etc/trafficrule/direct_domains.txt
endef

define Package/trafficrule-sniextract
  SECTION:=net
  CATEGORY:=Network
  TITLE:=trafficrule TLS SNI extractor (C binary)
  DEPENDS:=+trafficrule
endef

define Package/trafficrule-sniextract/description
  Compiled C binary for fast TLS SNI extraction from tcpdump hex output.
  Optional: trafficrule falls back to shell parser if not installed.
endef

define Package/trafficrule-sniextract/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/sniextract $(1)/usr/bin/sniextract
endef

$(eval $(call BuildPackage,trafficrule))
$(eval $(call BuildPackage,trafficrule-sniextract))
