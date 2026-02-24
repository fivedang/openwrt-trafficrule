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

var callGetDomains = rpc.declare({
	object: 'luci.trafficrule',
	method: 'get_domains',
	params: ['type'],
	expect: { domains: [] }
});

var callDomainAction = rpc.declare({
	object: 'luci.trafficrule',
	method: 'domain_action',
	params: ['action', 'domains']
});

var callServiceAction = rpc.declare({
	object: 'luci.trafficrule',
	method: 'service_action',
	params: ['action']
});

var callApplyRules = rpc.declare({
	object: 'luci.trafficrule',
	method: 'apply_rules',
	expect: {}
});

function arraysEqual(a, b) {
	if (a.length !== b.length) return false;
	for (var i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

return view.extend({
	pendingDomains: [],
	savedSelection: {},
	captureStart: '',
	isRunning: false,
	proxyCount: 0,
	directCount: 0,

	controlContainer: null,
	infoContainer: null,
	tableContainer: null,
	applyContainer: null,

	load: function() {
		return Promise.all([callGetStatus(), callGetDomains('pending')]);
	},

	pollFn: function() {
		var self = this;
		return Promise.all([callGetStatus(), callGetDomains('pending')]).then(function(results) {
			var status = results[0];
			var domains = results[1];
			var runChanged = (self.isRunning !== !!status.running);
			var startChanged = (self.captureStart !== (status.capture_start || ''));
			var countsChanged = (self.proxyCount !== (status.approved || 0)) ||
			                    (self.directCount !== (status.direct || 0));
			self.isRunning = !!status.running;
			self.captureStart = status.capture_start || '';
			self.proxyCount = status.approved || 0;
			self.directCount = status.direct || 0;

			if (runChanged || startChanged) {
				self.renderControlBar();
				self.renderInfoBar(domains.length);
			}

			if (!arraysEqual(self.pendingDomains, domains)) {
				self.saveSelection();
				self.pendingDomains = domains;
				self.renderInfoBar(domains.length);
				self.renderDomainTable();
			}

			if (countsChanged) {
				self.renderApplySection();
			}
		});
	},

	saveSelection: function() {
		if (!this.tableContainer) return;
		var cbs = this.tableContainer.querySelectorAll('input.domain-cb');
		var sel = {};
		for (var i = 0; i < cbs.length; i++) {
			if (cbs[i].checked) {
				sel[cbs[i].value] = true;
			}
		}
		this.savedSelection = sel;
	},

	getSelectedDomains: function() {
		var cbs = this.tableContainer.querySelectorAll('input.domain-cb:checked');
		var selected = [];
		for (var i = 0; i < cbs.length; i++) {
			selected.push(cbs[i].value);
		}
		return selected;
	},

	performAction: function(action) {
		var selected = this.getSelectedDomains();
		if (selected.length === 0) {
			ui.addNotification(null, E('p', {}, 'No domains selected. Check the boxes first.'), 'warning');
			return Promise.resolve();
		}

		var labels = { proxy: 'Proxy', direct: 'Direct', ignore: 'Ignored' };
		var self = this;
		self.savedSelection = {};
		return callDomainAction(action, selected).then(function() {
			ui.addNotification(null, E('p', {},
				selected.length + ' domain(s) classified as ' + (labels[action] || action) +
				'. Click "Apply Rules to OpenClash" to sync.'), 'info');
			return self.pollFn();
		});
	},

	renderControlBar: function() {
		var self = this;
		var running = this.isRunning;

		var indicator = E('span', {
			'class': 'label',
			'style': 'background-color:' + (running ? '#46a546' : '#c43c35') + ';color:#fff;padding:2px 8px;border-radius:3px;margin-right:12px;vertical-align:middle;'
		}, running ? 'Running' : 'Stopped');

		var startBtn = E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': function() {
				return callServiceAction('start').then(function() {
					ui.addNotification(null, E('p', {}, 'Capture started.'), 'info');
					return self.pollFn();
				});
			}
		}, 'Start Capture');

		var stopBtn = E('button', {
			'class': 'btn cbi-button cbi-button-reset',
			'click': function() {
				return callServiceAction('stop').then(function() {
					ui.addNotification(null, E('p', {}, 'Capture stopped.'), 'info');
					return self.pollFn();
				});
			}
		}, 'Stop');

		var restartBtn = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'click': function() {
				return callServiceAction('restart').then(function() {
					ui.addNotification(null, E('p', {}, 'Capture restarted.'), 'info');
					return self.pollFn();
				});
			}
		}, 'Restart');

		dom.content(this.controlContainer, E('div', {
			'style': 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;'
		}, [indicator, startBtn, stopBtn, restartBtn]));
	},

	renderInfoBar: function(count) {
		var items = [];
		if (this.captureStart) {
			items.push(E('span', {}, 'Started: ' + this.captureStart));
			items.push(E('span', { 'style': 'margin:0 12px;color:#ccc;' }, '|'));
		}
		items.push(E('span', {}, 'Pending: ' + count + ' domain(s)'));

		dom.content(this.infoContainer, E('div', {
			'style': 'margin:8px 0;font-weight:bold;color:#444;'
		}, items));
	},

	renderDomainTable: function() {
		var self = this;
		var domains = this.pendingDomains;
		var savedSel = this.savedSelection;

		// Step guide
		var stepGuide = E('div', {
			'style': 'background:#f0f6ff;border:1px solid #b8d4f0;border-radius:4px;padding:10px 14px;margin-bottom:12px;color:#333;font-size:0.92em;line-height:1.6;'
		}, [
			E('strong', {}, 'Workflow: '),
			E('span', {}, '1. Select domains below '),
			E('span', { 'style': 'color:#999;' }, ' \u2192 '),
			E('span', {}, ' 2. Click Proxy / Direct / Ignore to classify '),
			E('span', { 'style': 'color:#999;' }, ' \u2192 '),
			E('span', {}, ' 3. Click "Apply Rules to OpenClash" at the bottom to sync')
		]);

		var selectAll = E('input', {
			'type': 'checkbox',
			'click': function() {
				var cbs = self.tableContainer.querySelectorAll('input.domain-cb');
				for (var i = 0; i < cbs.length; i++) {
					cbs[i].checked = this.checked;
				}
			}
		});

		var headerRow = E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th', 'style': 'width:40px;' }, selectAll),
			E('th', { 'class': 'th' }, 'Domain')
		]);

		var rows = domains.map(function(d) {
			var cb = E('input', {
				'type': 'checkbox',
				'class': 'domain-cb',
				'value': d
			});
			if (savedSel[d]) cb.checked = true;
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, cb),
				E('td', { 'class': 'td' }, d)
			]);
		});

		if (rows.length === 0) {
			rows = [E('tr', { 'class': 'tr placeholder' }, [
				E('td', { 'class': 'td', 'colspan': '2' }, 'No pending domains. Start capture and browse on the target device.')
			])];
		}

		var table = E('table', { 'class': 'table cbi-section-table' },
			[headerRow].concat(rows));

		// Classification buttons — clearly labeled as step 2
		var actionBar = E('div', {
			'style': 'margin:12px 0;padding:10px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;'
		}, [
			E('strong', { 'style': 'margin-right:4px;' }, 'Classify selected:'),
			E('button', {
				'class': 'btn cbi-button-positive',
				'click': function() { return self.performAction('proxy'); }
			}, '\u2192 Proxy'),
			E('button', {
				'class': 'btn cbi-button-action',
				'click': function() { return self.performAction('direct'); }
			}, '\u2192 Direct'),
			E('button', {
				'class': 'btn cbi-button-neutral',
				'click': function() { return self.performAction('ignore'); }
			}, 'Ignore')
		]);

		dom.content(this.tableContainer, E('div', {}, [
			stepGuide,
			table,
			actionBar
		]));
	},

	renderApplySection: function() {
		var self = this;
		var summary = 'Current rules: ' + this.proxyCount + ' proxy, ' + this.directCount + ' direct.';

		dom.content(this.applyContainer, E('div', {
			'style': 'margin-top:4px;padding:12px;background:#ffe;border:1px solid #e0d890;border-radius:4px;'
		}, [
			E('div', { 'style': 'margin-bottom:8px;color:#555;' }, summary),
			E('button', {
				'class': 'btn cbi-button-apply',
				'style': 'font-size:1.05em;padding:6px 24px;',
				'click': function() {
					return callApplyRules().then(function(res) {
						var msg = (res && res.stdout) ? res.stdout : 'Rules applied to OpenClash.';
						ui.addNotification(null, E('p', {}, msg), 'info');
						return self.pollFn();
					});
				}
			}, 'Apply Rules to OpenClash')
		]));
	},

	render: function(data) {
		var status = data[0];
		var domains = data[1];
		this.isRunning = !!status.running;
		this.captureStart = status.capture_start || '';
		this.pendingDomains = domains;
		this.proxyCount = status.approved || 0;
		this.directCount = status.direct || 0;

		this.controlContainer = E('div', {});
		this.infoContainer = E('div', {});
		this.tableContainer = E('div', {});
		this.applyContainer = E('div', {});

		this.renderControlBar();
		this.renderInfoBar(domains.length);
		this.renderDomainTable();
		this.renderApplySection();

		poll.add(this.pollFn.bind(this), 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'TrafficRule - Capture'),
			E('div', { 'class': 'cbi-section' }, [
				this.controlContainer,
				this.infoContainer
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, 'Pending Domains'),
				this.tableContainer
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, 'Apply to OpenClash'),
				this.applyContainer
			]),
			E('div', { 'style': 'text-align:right;color:#999;font-size:0.85em;margin-top:16px;' },
				'TrafficRule v' + APP_VERSION)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
