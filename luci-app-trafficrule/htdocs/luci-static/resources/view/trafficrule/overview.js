'use strict';
'require view';
'require rpc';
'require ui';
'require dom';
'require poll';

var APP_VERSION = '1.2.0';

var callGetStatus = rpc.declare({
	object: 'luci.trafficrule',
	method: 'get_status',
	expect: {}
});

var callGetDevices = rpc.declare({
	object: 'luci.trafficrule',
	method: 'get_devices',
	expect: { devices: [] }
});

var callSetMonitor = rpc.declare({
	object: 'luci.trafficrule',
	method: 'set_monitor',
	params: ['ip']
});

function renderStatusCard(status) {
	var running = status.running;
	var indicator = E('span', {
		'class': 'label',
		'style': 'background-color:' + (running ? '#46a546' : '#c43c35') + ';color:#fff;padding:2px 8px;border-radius:3px;'
	}, running ? 'Running' : 'Stopped');

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, 'Service Status'),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'width:200px;font-weight:bold;' }, 'Status'),
				E('td', { 'class': 'td' }, indicator)
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Target IP'),
				E('td', { 'class': 'td' }, status.target_ip || '(not set)')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Interface'),
				E('td', { 'class': 'td' }, status.interface || '-')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Proxy Group'),
				E('td', { 'class': 'td' }, status.proxy_group || '-')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Direct Group'),
				E('td', { 'class': 'td' }, status.direct_group || '-')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Capture Started'),
				E('td', { 'class': 'td' }, status.capture_start || '(not started)')
			])
		]),
		E('h4', {}, 'Domain Counts'),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'width:200px;font-weight:bold;' }, 'Pending'),
				E('td', { 'class': 'td' }, String(status.pending || 0))
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Proxy'),
				E('td', { 'class': 'td' }, String(status.approved || 0))
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Direct'),
				E('td', { 'class': 'td' }, String(status.direct || 0))
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:bold;' }, 'Ignored'),
				E('td', { 'class': 'td' }, String(status.ignored || 0))
			])
		])
	]);
}

function renderDeviceTable(devices, view) {
	var rows = devices.map(function(dev) {
		var monBtn;
		if (dev.monitoring) {
			monBtn = E('span', {
				'class': 'label',
				'style': 'background-color:#46a546;color:#fff;padding:2px 8px;border-radius:3px;'
			}, 'Monitoring');
		} else {
			monBtn = E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': function() {
					ui.showModal('Confirm', [
						E('p', {}, 'Switch monitoring to ' + dev.ip + '?'),
						E('p', { 'style': 'color:#c43c35;' }, 'This will clear the pending list and restart capture.'),
						E('div', { 'class': 'right' }, [
							E('button', {
								'class': 'btn',
								'click': ui.hideModal
							}, 'Cancel'),
							' ',
							E('button', {
								'class': 'btn cbi-button-positive',
								'click': function() {
									ui.hideModal();
									return callSetMonitor(dev.ip).then(function() {
										ui.addNotification(null, E('p', {}, 'Now monitoring: ' + dev.ip), 'info');
										view.pollFn();
									});
								}
							}, 'Confirm')
						])
					]);
				}
			}, 'Monitor');
		}

		return E('tr', { 'class': 'tr' + (dev.monitoring ? ' cbi-section-table-row-active' : '') }, [
			E('td', { 'class': 'td' }, dev.ip),
			E('td', { 'class': 'td' }, dev.hostname || '-'),
			E('td', { 'class': 'td' }, dev.mac),
			E('td', { 'class': 'td' }, monBtn)
		]);
	});

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, 'LAN Devices'),
		E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, 'IP Address'),
				E('th', { 'class': 'th' }, 'Hostname'),
				E('th', { 'class': 'th' }, 'MAC Address'),
				E('th', { 'class': 'th' }, 'Action')
			])
		].concat(rows.length > 0 ? rows : [
			E('tr', { 'class': 'tr placeholder' }, [
				E('td', { 'class': 'td', 'colspan': '4' }, 'No DHCP devices found.')
			])
		]))
	]);
}

return view.extend({
	statusContainer: null,
	deviceContainer: null,

	pollFn: function() {
		var self = this;
		return Promise.all([callGetStatus(), callGetDevices()]).then(function(results) {
			var status = results[0];
			var devices = results[1];

			dom.content(self.statusContainer, renderStatusCard(status));
			dom.content(self.deviceContainer, renderDeviceTable(devices, self));
		});
	},

	load: function() {
		return Promise.all([callGetStatus(), callGetDevices()]);
	},

	render: function(data) {
		var status = data[0];
		var devices = data[1];

		this.statusContainer = E('div', {}, renderStatusCard(status));
		this.deviceContainer = E('div', {}, renderDeviceTable(devices, this));

		poll.add(this.pollFn.bind(this), 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'TrafficRule - Overview'),
			this.statusContainer,
			this.deviceContainer,
			E('div', { 'style': 'text-align:right;color:#999;font-size:0.85em;margin-top:16px;' },
				'TrafficRule v' + APP_VERSION)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
