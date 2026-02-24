'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var APP_VERSION = '1.2.0';

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

var callApplyRules = rpc.declare({
	object: 'luci.trafficrule',
	method: 'apply_rules',
	expect: {}
});

var TAB_TYPES = ['approved', 'direct', 'ignored'];
var TAB_LABELS = { approved: 'Proxy', direct: 'Direct', ignored: 'Ignored' };

return view.extend({
	activeTab: 'approved',
	domainData: {},
	selectedDomains: {},
	tabContainer: null,
	tableContainer: null,

	load: function() {
		var self = this;
		return Promise.all(TAB_TYPES.map(function(t) {
			return callGetDomains(t).then(function(domains) {
				self.domainData[t] = domains;
			});
		}));
	},

	refreshAll: function() {
		var self = this;
		return Promise.all(TAB_TYPES.map(function(t) {
			return callGetDomains(t).then(function(domains) {
				self.domainData[t] = domains;
			});
		})).then(function() {
			self.selectedDomains = {};
			self.renderTabBar();
			self.renderDomainTable();
		});
	},

	saveSelection: function() {
		if (!this.tableContainer) return;
		var tab = this.activeTab;
		var cbs = this.tableContainer.querySelectorAll('input.domain-cb');
		var sel = {};
		for (var i = 0; i < cbs.length; i++) {
			if (cbs[i].checked) {
				sel[cbs[i].value] = true;
			}
		}
		this.selectedDomains[tab] = sel;
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
			ui.addNotification(null, E('p', {}, 'No domains selected.'), 'warning');
			return Promise.resolve();
		}

		var self = this;
		self.selectedDomains = {};
		return callDomainAction(action, selected).then(function() {
			ui.addNotification(null, E('p', {},
				selected.length + ' domain(s) processed (' + action + ').'), 'info');
			return self.refreshAll();
		});
	},

	renderTabBar: function() {
		var self = this;
		var tabs = TAB_TYPES.map(function(t) {
			var count = (self.domainData[t] || []).length;
			var label = TAB_LABELS[t] + ' (' + count + ')';
			var isActive = (t === self.activeTab);
			return E('button', {
				'class': 'btn' + (isActive ? ' cbi-button-positive' : ''),
				'style': 'margin-right:4px;',
				'click': function() {
					self.saveSelection();
					self.activeTab = t;
					self.renderTabBar();
					self.renderDomainTable();
				}
			}, label);
		});

		dom.content(this.tabContainer, E('div', {
			'style': 'margin-bottom:12px;display:flex;gap:4px;flex-wrap:wrap;'
		}, tabs));
	},

	renderDomainTable: function() {
		var self = this;
		var tab = this.activeTab;
		var domains = this.domainData[tab] || [];
		var savedSel = this.selectedDomains[tab] || {};

		var statsLine = E('div', {
			'style': 'margin-bottom:8px;font-weight:bold;color:#444;'
		}, [E('span', {}, domains.length + ' domain(s) in ' + TAB_LABELS[tab] + ' list')]);

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
				E('td', { 'class': 'td', 'colspan': '2' }, 'No domains in this list.')
			])];
		}

		var table = E('table', { 'class': 'table cbi-section-table' },
			[headerRow].concat(rows));

		// Action buttons based on active tab
		var buttons = [];

		if (tab === 'approved') {
			buttons.push(E('button', {
				'class': 'btn cbi-button-action',
				'click': function() { return self.performAction('direct'); }
			}, 'Move to Direct'));
			buttons.push(E('button', {
				'class': 'btn cbi-button-reset',
				'click': function() { return self.performAction('remove_approved'); }
			}, 'Remove'));
		} else if (tab === 'direct') {
			buttons.push(E('button', {
				'class': 'btn cbi-button-positive',
				'click': function() { return self.performAction('proxy'); }
			}, 'Move to Proxy'));
			buttons.push(E('button', {
				'class': 'btn cbi-button-reset',
				'click': function() { return self.performAction('remove_direct'); }
			}, 'Remove'));
		} else if (tab === 'ignored') {
			buttons.push(E('button', {
				'class': 'btn cbi-button-reset',
				'click': function() { return self.performAction('remove_ignored'); }
			}, 'Remove'));
		}

		var buttonBar = E('div', { 'style': 'margin:8px 0;display:flex;gap:8px;flex-wrap:wrap;' }, buttons);

		// Apply button
		var applyBtn = E('div', { 'style': 'margin-top:16px;' }, [
			E('button', {
				'class': 'btn cbi-button-apply',
				'style': 'font-size:1.05em;padding:6px 24px;',
				'click': function() {
					return callApplyRules().then(function(res) {
						var msg = (res && res.stdout) ? res.stdout : 'Rules applied to OpenClash.';
						ui.addNotification(null, E('p', {}, msg), 'info');
					});
				}
			}, 'Apply Rules to OpenClash')
		]);

		dom.content(this.tableContainer, E('div', {}, [
			statsLine,
			buttonBar,
			table,
			applyBtn
		]));
	},

	render: function() {
		this.tabContainer = E('div', {});
		this.tableContainer = E('div', {});

		this.renderTabBar();
		this.renderDomainTable();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'TrafficRule - Rules'),
			this.tabContainer,
			this.tableContainer,
			E('div', { 'style': 'text-align:right;color:#999;font-size:0.85em;margin-top:16px;' },
				'TrafficRule v' + APP_VERSION)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
