'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require dom';

var APP_VERSION = '1.3.0';

var callGetProxyGroups = rpc.declare({
	object: 'luci.trafficrule',
	method: 'get_proxy_groups',
	expect: { groups: [] }
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('trafficrule'),
			callGetProxyGroups()
		]);
	},

	render: function(data) {
		var proxyGroups = data[1] || [];

		var m, s, o;

		m = new form.Map('trafficrule', 'TrafficRule - Settings',
			'Configure traffic capture and rule generation settings.');

		s = m.section(form.TypedSection, 'trafficrule', '');
		s.anonymous = true;

		o = s.option(form.ListValue, 'interface', 'Interface',
			'Network interface to capture traffic on.');
		o.value('br-lan', 'br-lan');
		o.value('eth0', 'eth0');
		o.value('eth1', 'eth1');
		o.default = 'br-lan';
		o.rmempty = false;

		o = s.option(form.ListValue, 'proxy_group', 'Proxy Group',
			'OpenClash proxy group for domains routed via proxy.');
		for (var i = 0; i < proxyGroups.length; i++) {
			o.value(proxyGroups[i], proxyGroups[i]);
		}
		o.default = '♻️ 自动选择';
		o.rmempty = false;

		o = s.option(form.ListValue, 'direct_group', 'Direct Group',
			'OpenClash proxy group for domains routed directly.');
		for (var i = 0; i < proxyGroups.length; i++) {
			o.value(proxyGroups[i], proxyGroups[i]);
		}
		o.default = 'DIRECT';
		o.rmempty = false;

		o = s.option(form.Flag, 'auto_reload_clash', 'Auto Reload OpenClash',
			'Automatically restart OpenClash after applying rules.');
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Flag, 'capture_dns', 'Capture DNS',
			'Extract domains from DNS queries in captured traffic.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'capture_sni', 'Capture SNI',
			'Extract domains from TLS SNI in captured traffic.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'capture_ip', 'Capture Dest IP',
			'Capture destination IP addresses from TCP connections. IPs are added to pending alongside domains. Requires restart of capture.');
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'max_pending', 'Max Pending',
			'Maximum number of domains in the pending list.');
		o.datatype = 'uinteger';
		o.default = '5000';
		o.rmempty = false;

		return m.render().then(function(node) {
			return E('div', {}, [
				node,
				E('div', { 'style': 'text-align:right;color:#999;font-size:0.85em;margin-top:16px;' },
					'TrafficRule v' + APP_VERSION)
			]);
		});
	}
});
