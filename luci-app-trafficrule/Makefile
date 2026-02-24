include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-trafficrule
PKG_VERSION:=1.2.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_MAINTAINER:=trafficrule

LUCI_TITLE:=LuCI support for TrafficRule
LUCI_DEPENDS:=+trafficrule +luci-base

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildance
$(eval $(call BuildPackage,$(PKG_NAME)))
