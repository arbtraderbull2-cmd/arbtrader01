/* ── ArbTrader — main JS ── */

/* ════════════════════════════════════════
   ACCOUNT REGISTRY — single source of truth
   All tabs read AccountRegistry.activeKey
════════════════════════════════════════ */
const AccountRegistry = {
  accounts:  {},    // key → account data
  activeKey: null,  // THE selected account for all tabs

  add(key, data) {
    this.accounts[key] = data;
    this._syncDropdowns();
    this._syncCards();
    this._updateCount();
  },

  remove(key) {
    delete this.accounts[key];
    if (this.activeKey === key) this.setActive(null);
    this._syncDropdowns();
    this._syncCards();
    this._updateCount();
  },

  get(key) { return this.accounts[key] || null; },
  active()  { return this.accounts[this.activeKey] || null; },

  setActive(key) {
    this.activeKey = key;
    const acc = key ? this.accounts[key] : null;

    // Highlight card
    document.querySelectorAll('.acc-card').forEach(c => c.classList.remove('active'));
    if (key) document.getElementById(`acc-card-${key}`)?.classList.add('active');

    // Sync both dropdowns
    ['ex-acc-select'].forEach(id => {
      const sel = document.getElementById(id);
      if (sel) sel.value = key || '';
    });

    // Sidebar active indicator
    const badge   = document.getElementById('sb-active-acc');
    const name    = document.getElementById('sb-active-name');
    const bal     = document.getElementById('sb-active-bal');
    if (acc) {
      badge.style.display = 'flex';
      name.textContent    = acc.label;
      bal.textContent     = acc.currency
        ? `${acc.currency} ${Number(acc.balance).toLocaleString()}`
        : 'Balance unavailable';
    } else {
      badge.style.display = 'none';
    }

    // Notify all tabs
    onActiveAccountChanged(key, acc);
  },

  _syncDropdowns() {
    const ids = ['ex-acc-select'];
    ids.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const cur = sel.value;
      [...sel.options].forEach(o => { if (o.value) o.remove(); });
      Object.entries(this.accounts).forEach(([k, a]) => {
        const opt       = document.createElement('option');
        opt.value       = k;
        opt.textContent = `${a.label} (${a.login || a.account})`;
        sel.appendChild(opt);
      });
      if (cur && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
    });
  },

  _syncCards() {
    const list = document.getElementById('ex-acc-list');
    if (!list) return;
    list.innerHTML = '';
    Object.entries(this.accounts).forEach(([key, acc]) => {
      if (acc.balance != null) addAccountCard(key, acc);
      else addAccountCardOffline(key, acc.label, acc.account, acc.server);
    });
  },

  _updateCount() {
    const el = document.getElementById('sb-acc-count');
    if (el) el.textContent = Object.keys(this.accounts).length;
  },
};

/* Called whenever active account changes — each tab reacts */
function onActiveAccountChanged(key, acc) {
  // Execute tab
  const execName = document.getElementById('exec-active-acc-name');
  const execPH   = document.getElementById('exec-placeholder');
  const execForm = document.getElementById('exec-order-form');
  if (execName) execName.textContent = acc ? `${acc.label} · ${acc.currency || ''}` : 'No account selected';
  if (execPH)   execPH.style.display  = acc ? 'none'  : 'flex';
  if (execForm) execForm.style.display = acc ? 'block' : 'none';
  if (acc) populateSymbols(acc.symbols || []);

  // PnL tab badge
  const pnlBadge = document.getElementById('pnl-acc-badge');
  if (pnlBadge) pnlBadge.textContent = acc ? `${acc.label} · ${acc.login || acc.account}` : 'No account selected';

  // If a data tab is active, refresh it immediately
  if (acc) {
    if (document.getElementById('pg-pnl')?.classList.contains('active'))      pnlRefresh();
    if (document.getElementById('pg-limits')?.classList.contains('active'))   sumOnTabOpen();
    if (document.getElementById('pg-accounts')?.classList.contains('active')) histOnTabOpen();
  }

  // Update account badges
  const sumBadge  = document.getElementById('sum-acc-badge');
  const histBadge = document.getElementById('hist-acc-badge');
  const label = acc ? `${acc.label} · ${acc.login || acc.account}` : 'No account selected';
  if (sumBadge)  sumBadge.textContent  = label;
  if (histBadge) histBadge.textContent = label;

  // Stop quote polling if no account
  if (!key && execState.quoteInterval) {
    clearInterval(execState.quoteInterval);
    execState.quoteInterval = null;
  }

  // Disparity tab
  if (key) {
    dispStartPolling();
    const noAcc = document.getElementById('disp-no-acc');
    if (noAcc) noAcc.style.display = 'none';
  } else {
    dispStopPolling();
    const noAcc = document.getElementById('disp-no-acc');
    if (noAcc) noAcc.style.display = 'block';
    if (typeof dispClearAll === 'function') dispClearAll();
  }
}

/* ════════════════════════════════════════
   PAGE NAVIGATION
════════════════════════════════════════ */
function show(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(t => t.classList.remove('active'));
  document.getElementById('pg-' + id).classList.add('active');
  btn.classList.add('active');

  if (id === 'pnl'      && AccountRegistry.activeKey) pnlRefresh();
  if (id === 'limits'   && AccountRegistry.activeKey) sumOnTabOpen();
  if (id === 'accounts' && AccountRegistry.activeKey) histOnTabOpen();

  // Re-run disparity setup when switching to disparity tab
  if (id === 'disparity' && AccountRegistry.activeKey) {
    // Show content, ensure symbols loaded
    const noAcc   = document.getElementById('disp-no-acc');
    const content = document.getElementById('disp-content');
    if (noAcc)   noAcc.style.display   = 'none';
    if (content) content.style.display = 'block';
    // Reload symbols if dropdowns are empty
    const goldSel = document.getElementById('sym-gold-select');
    if (!goldSel || !goldSel.value) dispLoadSymbols();
  }
}

/* ════════════════════════════════════════
   METAL SUB-TABS
════════════════════════════════════════ */
function setMetal(metal, el) {
  const tab = el.closest('.metal-tab');
  document.querySelectorAll('.metal-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.querySelectorAll('.metal-panel').forEach(p => p.style.display = 'none');
  document.getElementById('panel-' + metal).style.display = 'block';
}

/* ════════════════════════════════════════
   LIVE CLOCK
════════════════════════════════════════ */
function tick() {
  const el = document.getElementById('clk');
  if (el) el.textContent = new Date().toLocaleTimeString();
}
tick();
setInterval(tick, 1000);

/* ════════════════════════════════════════
   LOAD PERSISTED ACCOUNTS ON STARTUP
════════════════════════════════════════ */
(async function loadSavedAccounts() {
  try {
    const res  = await fetch('/exec/accounts');
    const data = await res.json();
    if (!data.accounts?.length) return;
    data.accounts.forEach(acc => {
      AccountRegistry.add(acc.key, {
        login:    acc.account,
        account:  acc.account,
        label:    acc.label,
        server:   acc.server,
        password: acc.password,
        balance:  null,
      });
    });
  } catch (e) { /* silent */ }
})();

/* ════════════════════════════════════════
   TOPBAR CONNECTION MODAL
════════════════════════════════════════ */
const BROKER_META = {
  dg:    { title: 'Connect DG',    sub: 'FinoTrax · MT5' },
  comex: { title: 'Connect COMEX', sub: 'Navion fx · MT5' },
  ind:   { title: 'Connect IND',   sub: 'Satoshi dmcc · MT5' },
};
const connState    = { dg: true, comex: true, ind: false };
let activeExchange = null;

function openConnect(exchange) {
  activeExchange = exchange;
  const meta = BROKER_META[exchange];
  document.getElementById('modal-title').textContent = meta.title;
  document.getElementById('modal-sub').textContent   = meta.sub;
  ['f-account','f-password','f-server'].forEach(id => document.getElementById(id).value = '');
  setModalStatus('', '');
  setModalLoading(false);
  const btn = document.getElementById('modal-connect-btn');
  btn.textContent = connState[exchange] ? 'Disconnect' : 'Connect';
  btn.className   = connState[exchange] ? 'mbtn-disconnect' : 'mbtn-connect';
  document.getElementById('conn-modal').classList.add('open');
  setTimeout(() => document.getElementById('f-account').focus(), 80);
}

function closeConnect() {
  document.getElementById('conn-modal').classList.remove('open');
  activeExchange = null;
}

function closeConnectOutside(e) {
  if (e.target === document.getElementById('conn-modal')) closeConnect();
}

function setModalStatus(msg, type) {
  const el = document.getElementById('modal-status');
  el.textContent = msg;
  el.className   = 'modal-status' + (type ? ' ms-' + type : '');
}

function setModalLoading(loading) {
  const btn = document.getElementById('modal-connect-btn');
  btn.disabled = loading;
  if (loading) btn.textContent = 'Connecting…';
}

async function doConnect() {
  if (!activeExchange) return;
  if (connState[activeExchange]) { setConnectionState(activeExchange, false); closeConnect(); return; }
  const account  = document.getElementById('f-account').value.trim();
  const password = document.getElementById('f-password').value;
  const server   = document.getElementById('f-server').value.trim();
  if (!account || !password || !server) { setModalStatus('Please fill in all fields.', 'error'); return; }
  setModalLoading(true);
  try {
    const res  = await fetch('/connect', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ exchange: activeExchange, creds: { account, password, server } }),
    });
    const data = await res.json();
    if (data.error) { setModalStatus('⚠ ' + data.error, 'error'); setModalLoading(false); }
    else { setModalStatus('✓ Connected — Acc ' + data.account, 'success'); setConnectionState(activeExchange, true); setTimeout(closeConnect, 900); }
  } catch (err) { setModalStatus('⚠ ' + err.message, 'error'); setModalLoading(false); }
}

function setConnectionState(exchange, connected) {
  connState[exchange] = connected;
  const btn = document.getElementById('conn-' + exchange);
  if (btn) btn.className = 'conn-btn ' + (connected ? 'connected' : 'disconnected');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeConnect();
  if (e.key === 'Enter' && document.getElementById('conn-modal')?.classList.contains('open')) doConnect();
});

/* ════════════════════════════════════════
   SIDEBAR — ACCOUNT LOGIN
════════════════════════════════════════ */
async function execLogin() {
  const account  = document.getElementById('ex-account').value.trim();
  const password = document.getElementById('ex-password').value;
  const server   = document.getElementById('ex-server').value.trim();
  const label    = document.getElementById('ex-label').value.trim();
  const btn      = document.getElementById('ex-login-btn');

  if (!account || !password || !server) { setExStatus('Fill in account, password and server.', 'error'); return; }

  btn.disabled = true; btn.textContent = 'Connecting…';
  setExStatus('', '');

  try {
    const res  = await fetch('/exec/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account, password, server, label }),
    });
    const data = await res.json();

    if (data.error) {
      setExStatus('⚠ ' + data.error, 'error');
    } else {
      const key = String(data.login);
      AccountRegistry.add(key, {
        login: data.login, account, label: data.label,
        company: data.company, balance: data.balance,
        currency: data.currency, leverage: data.leverage,
        symbols: data.symbols || [], server, password,
      });
      setExStatus(`✓ ${data.label} connected`, 'success');
      ['ex-account','ex-password','ex-server','ex-label'].forEach(id => document.getElementById(id).value = '');
      // Auto-activate if first account
      if (!AccountRegistry.activeKey) AccountRegistry.setActive(key);
    }
  } catch (e) { setExStatus('⚠ ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Connect account'; }
}

function setExStatus(msg, type) {
  const el = document.getElementById('ex-login-status');
  el.textContent = msg;
  el.className   = 'acc-login-status' + (type ? ' als-' + type : '');
}

/* ── Connect saved account ── */
async function execConnectSaved() {
  const key  = document.getElementById('ex-acc-select').value;
  if (!key) { setSavedStatus('Select an account first.', 'error'); return; }

  const saved = AccountRegistry.get(key);
  if (!saved) { setSavedStatus('Account not found.', 'error'); return; }

  // Already live this session — just activate
  if (saved.balance != null && saved.symbols?.length > 0) {
    AccountRegistry.setActive(key);
    setSavedStatus(`✓ Using ${saved.label}`, 'success');
    return;
  }

  setSavedStatus('Connecting…', '');
  const btn = document.querySelector('.acc-connect-saved-btn');
  btn.disabled = true;

  try {
    const res  = await fetch('/exec/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account: saved.account, password: saved.password || '', server: saved.server, label: saved.label }),
    });
    const data = await res.json();
    if (data.error) {
      setSavedStatus('⚠ Re-enter password in the form above to reconnect.', 'error');
    } else {
      AccountRegistry.add(key, { ...saved, login: data.login, balance: data.balance, currency: data.currency, leverage: data.leverage, symbols: data.symbols || [], company: data.company });
      AccountRegistry.setActive(key);
      setSavedStatus(`✓ ${data.label} connected`, 'success');
    }
  } catch (e) { setSavedStatus('⚠ ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

function setSavedStatus(msg, type) {
  const el = document.getElementById('ex-saved-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'acc-login-status' + (type ? ' als-' + type : '');
}

/* ── Account cards ── */
function addAccountCard(key, data) {
  const list = document.getElementById('ex-acc-list');
  if (!list) return;
  document.getElementById(`acc-card-${key}`)?.remove();
  const card = document.createElement('div');
  card.className = 'acc-card'; card.id = `acc-card-${key}`;
  card.innerHTML = `
    <div class="acc-card-top">
      <div>
        <div class="acc-card-label">${data.label}</div>
        <div class="acc-card-meta">${data.company || data.server} · ${data.login || data.account}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="dot dot-g"></div>
        <button class="acc-card-remove" onclick="removeAccount('${key}')">✕</button>
      </div>
    </div>
    <div class="acc-card-bal">${data.currency || ''} ${data.balance != null ? Number(data.balance).toLocaleString() : '—'}</div>
    <div class="acc-card-leverage">1:${data.leverage || '—'}</div>
    <button class="acc-card-select" onclick="AccountRegistry.setActive('${key}')">Use this account</button>`;
  list.appendChild(card);
}

function addAccountCardOffline(key, label, account, server) {
  const list = document.getElementById('ex-acc-list');
  if (!list) return;
  document.getElementById(`acc-card-${key}`)?.remove();
  const card = document.createElement('div');
  card.className = 'acc-card'; card.id = `acc-card-${key}`;
  card.innerHTML = `
    <div class="acc-card-top">
      <div>
        <div class="acc-card-label">${label}</div>
        <div class="acc-card-meta">${server} · ${account}</div>
      </div>
      <button class="acc-card-remove" onclick="removeAccount('${key}')">✕</button>
    </div>
    <div class="acc-card-bal" style="color:#9ca3af;font-size:12px">Not connected this session</div>
    <button class="acc-card-select" onclick="execConnectSaved(); document.getElementById('ex-acc-select').value='${key}'">Reconnect</button>`;
  list.appendChild(card);
}

async function removeAccount(key) {
  await fetch('/exec/remove', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ account_key: key }),
  });
  AccountRegistry.remove(key);
}

/* ════════════════════════════════════════
   EXECUTE TAB — ORDER FORM
════════════════════════════════════════ */
const execState = { quoteInterval: null };

function populateSymbols(symbols) {
  const sel = document.getElementById('ord-symbol');
  if (!sel) return;
  sel.innerHTML = '';
  if (!symbols?.length) { sel.innerHTML = '<option value="">No symbols found</option>'; return; }
  symbols.forEach(s => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = s;
    sel.appendChild(opt);
  });
  onSymbolChange();
}

function onSymbolChange() { startQuotePolling(); }

function onOrderTypeChange() {
  const type     = document.getElementById('ord-type').value;
  const priceRow = document.getElementById('ord-price-row');
  const slWrap   = document.getElementById('ord-stoplimit-wrap');
  const lbl      = document.getElementById('ord-price-lbl');
  priceRow.style.display = type === 'market' ? 'none' : 'grid';
  slWrap.style.display   = type === 'stop_limit' ? 'block' : 'none';
  if (lbl) lbl.textContent = type === 'limit' ? 'Limit price' : 'Stop price';
}

function setLot(btn, val) {
  document.querySelectorAll('.lot-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const input = document.getElementById('ord-lots');
  input.value = val; input.readOnly = !!val;
  if (!val) input.focus();
}

function startQuotePolling() {
  if (execState.quoteInterval) clearInterval(execState.quoteInterval);
  fetchQuote();
  execState.quoteInterval = setInterval(fetchQuote, 1000);
}

async function fetchQuote() {
  const key    = AccountRegistry.activeKey;
  const symbol = document.getElementById('ord-symbol')?.value;
  if (!key || !symbol) return;
  try {
    const res  = await fetch('/exec/quote', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account_key: key, symbol }),
    });
    const data = await res.json();
    if (data.error) return;
    const fmt    = v => Number(v).toFixed(data.digits ?? 2);
    const spread = ((data.ask - data.bid) * Math.pow(10, data.digits ?? 2)).toFixed(1);
    document.getElementById('ord-bid').textContent        = fmt(data.bid);
    document.getElementById('ord-ask').textContent        = fmt(data.ask);
    document.getElementById('ord-spread').textContent     = `spread ${spread}`;
    document.getElementById('ord-buy-price').textContent  = fmt(data.ask);
    document.getElementById('ord-sell-price').textContent = fmt(data.bid);
    const pulse = document.getElementById('lq-pulse');
    pulse.classList.remove('pulse-flash'); void pulse.offsetWidth; pulse.classList.add('pulse-flash');
  } catch (e) {}
}

async function placeOrder(side) {
  const key = AccountRegistry.activeKey;
  if (!key) { setOrdStatus('No account selected.', 'error'); return; }

  const symbol     = document.getElementById('ord-symbol').value;
  const order_type = document.getElementById('ord-type').value;
  const lots       = document.getElementById('ord-lots').value;
  const price      = document.getElementById('ord-price')?.value || 0;
  const sl         = document.getElementById('ord-sl').value;
  const tp         = document.getElementById('ord-tp').value;
  const deviation  = document.getElementById('ord-deviation').value;
  const comment    = document.getElementById('ord-comment').value || 'ArbTrader';
  const stoplimit  = document.getElementById('ord-stoplimit')?.value || 0;

  if (!symbol) { setOrdStatus('Select a symbol.', 'error'); return; }
  if (!lots)   { setOrdStatus('Enter lot size.', 'error'); return; }

  setOrdStatus('Placing order…', 'info');
  try {
    const res  = await fetch('/exec/order', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account_key: key, symbol, side, order_type, lots, price, sl, tp, deviation, comment, stoplimit }),
    });
    const data = await res.json();
    data.error
      ? setOrdStatus('⚠ ' + data.error, 'error')
      : setOrdStatus(`✓ Order #${data.order} · ${data.volume} lots @ ${data.price}`, 'success');
  } catch (e) { setOrdStatus('⚠ ' + e.message, 'error'); }
}

function setOrdStatus(msg, type) {
  const el = document.getElementById('ord-status');
  el.textContent = msg; el.className = 'ord-status os-' + type;
}

/* ════════════════════════════════════════
   LIVE P&L TAB
════════════════════════════════════════ */
const pnlState = { autoInterval: null, positions: [], orders: [] };

function pnlToggleAuto(cb) {
  if (cb.checked) { pnlRefresh(); pnlState.autoInterval = setInterval(pnlRefresh, 5000); }
  else { clearInterval(pnlState.autoInterval); pnlState.autoInterval = null; }
}

async function pnlRefresh() {
  const key = AccountRegistry.activeKey;
  if (!key) return;
  await Promise.all([fetchPositions(key), fetchOrders(key)]);
  document.getElementById('pnl-last-update').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

async function fetchPositions(key) {
  try {
    const res  = await fetch('/pnl/positions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({account_key:key}) });
    const data = await res.json();
    if (data.error) { setPnlStatus('⚠ ' + data.error, 'error'); return; }
    pnlState.positions = data.positions;
    renderPositions(data.positions);
  } catch(e) { setPnlStatus('⚠ ' + e.message, 'error'); }
}

function renderPositions(positions) {
  const ph      = document.getElementById('pnl-pos-placeholder');
  const wrap    = document.getElementById('pnl-pos-table-wrap');
  const countEl = document.getElementById('pnl-pos-count');
  const totalEl = document.getElementById('pnl-total');
  const swapEl  = document.getElementById('pnl-swap');

  countEl.textContent = positions.length;
  if (!positions.length) {
    ph.textContent = 'No open positions'; ph.style.display = 'block'; wrap.style.display = 'none';
    totalEl.textContent = '—'; totalEl.className = 'ph-val'; swapEl.textContent = '—'; return;
  }
  ph.style.display = 'none'; wrap.style.display = 'block';

  const totalPnl  = positions.reduce((s,p) => s + p.profit, 0);
  const totalSwap = positions.reduce((s,p) => s + p.swap,   0);
  totalEl.textContent = (totalPnl >= 0 ? '+ ' : '− ') + Math.abs(totalPnl).toFixed(2);
  totalEl.className   = 'ph-val ' + (totalPnl >= 0 ? 'pos' : 'loss');
  swapEl.textContent  = totalSwap.toFixed(2);

  document.getElementById('pnl-pos-body').innerHTML = positions.map(p => `
    <tr class="pnl-row">
      <td class="pnl-td-check"><input type="checkbox" class="pos-check" value="${p.ticket}" onchange="pnlUpdateSqBtn()"/></td>
      <td class="mono">${p.ticket}</td>
      <td><b>${p.symbol}</b></td>
      <td><span class="type-badge ${p.type==='BUY'?'type-buy':'type-sell'}">${p.type}</span></td>
      <td class="mono">${p.volume}</td>
      <td class="mono">${p.open_price}</td>
      <td class="mono">${p.current}</td>
      <td class="mono dim">${p.sl||'—'}</td>
      <td class="mono dim">${p.tp||'—'}</td>
      <td class="mono dim">${p.swap.toFixed(2)}</td>
      <td class="mono ${p.profit>=0?'pnl-pos':'pnl-neg'}"><b>${p.profit>=0?'+':''}${p.profit.toFixed(2)}</b></td>
      <td class="dim small">${p.comment||'—'}</td>
    </tr>`).join('');
}

async function fetchOrders(key) {
  try {
    const res  = await fetch('/pnl/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({account_key:key}) });
    const data = await res.json();
    if (data.error) return;
    pnlState.orders = data.orders;
    renderOrders(data.orders);
  } catch(e) {}
}

function renderOrders(orders) {
  const ph      = document.getElementById('pnl-ord-placeholder');
  const wrap    = document.getElementById('pnl-ord-table-wrap');
  const countEl = document.getElementById('pnl-ord-count');
  countEl.textContent = orders.length;
  if (!orders.length) {
    ph.textContent = 'No pending orders'; ph.style.display = 'block'; wrap.style.display = 'none'; return;
  }
  ph.style.display = 'none'; wrap.style.display = 'block';
  document.getElementById('pnl-ord-body').innerHTML = orders.map(o => {
    const t = new Date(o.open_time * 1000);
    return `<tr class="pnl-row">
      <td class="pnl-td-check"><input type="checkbox" class="ord-check" value="${o.ticket}" onchange="pnlUpdateCancelBtn()"/></td>
      <td class="mono">${o.ticket}</td>
      <td><b>${o.symbol}</b></td>
      <td><span class="type-badge ${o.type.includes('BUY')?'type-buy':'type-sell'}">${o.type}</span></td>
      <td class="mono">${o.volume}</td>
      <td class="mono">${o.price}</td>
      <td class="mono dim">${o.sl||'—'}</td>
      <td class="mono dim">${o.tp||'—'}</td>
      <td class="dim small">${o.comment||'—'}</td>
      <td class="dim small">${t.toLocaleDateString()} ${t.toLocaleTimeString()}</td>
    </tr>`;
  }).join('');
}

function pnlSelectAll(type)  { document.querySelectorAll(`.${type}-check`).forEach(c=>c.checked=true);  type==='pos'?pnlUpdateSqBtn():pnlUpdateCancelBtn(); }
function pnlClearSel(type)   { document.querySelectorAll(`.${type}-check`).forEach(c=>c.checked=false); const a=document.getElementById(`pnl-check-all-${type}`); if(a) a.checked=false; type==='pos'?pnlUpdateSqBtn():pnlUpdateCancelBtn(); }
function pnlToggleAllPos(cb) { document.querySelectorAll('.pos-check').forEach(c=>c.checked=cb.checked); pnlUpdateSqBtn(); }
function pnlToggleAllOrd(cb) { document.querySelectorAll('.ord-check').forEach(c=>c.checked=cb.checked); pnlUpdateCancelBtn(); }

function pnlUpdateSqBtn() {
  const n = document.querySelectorAll('.pos-check:checked').length;
  const b = document.getElementById('pnl-sq-btn');
  b.disabled = n===0; b.textContent = n>0 ? `Square off (${n})` : 'Square off selected';
}
function pnlUpdateCancelBtn() {
  const n = document.querySelectorAll('.ord-check:checked').length;
  const b = document.getElementById('pnl-cancel-btn');
  b.disabled = n===0; b.textContent = n>0 ? `Cancel orders (${n})` : 'Cancel selected';
}

async function pnlSquareOff() {
  const key     = AccountRegistry.activeKey;
  const tickets = [...document.querySelectorAll('.pos-check:checked')].map(c=>Number(c.value));
  if (!key || !tickets.length) return;
  setPnlStatus(`Closing ${tickets.length} position(s)…`, 'info');
  try {
    const res  = await fetch('/pnl/close', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({account_key:key, tickets, order_tickets:[]}) });
    const data = await res.json();
    const ok   = data.results?.filter(r=>r.ok).length||0;
    const fail = data.results?.filter(r=>r.error).length||0;
    setPnlStatus(`✓ Closed ${ok}` + (fail?` · ${fail} failed`:''), ok>0?'success':'error');
    pnlRefresh();
  } catch(e) { setPnlStatus('⚠ '+e.message,'error'); }
}

async function pnlCancelOrders() {
  const key           = AccountRegistry.activeKey;
  const order_tickets = [...document.querySelectorAll('.ord-check:checked')].map(c=>Number(c.value));
  if (!key || !order_tickets.length) return;
  setPnlStatus(`Cancelling ${order_tickets.length} order(s)…`, 'info');
  try {
    const res  = await fetch('/pnl/close', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({account_key:key, tickets:[], order_tickets}) });
    const data = await res.json();
    const ok   = data.results?.filter(r=>r.ok).length||0;
    setPnlStatus(`✓ Cancelled ${ok} order(s)`,'success');
    pnlRefresh();
  } catch(e) { setPnlStatus('⚠ '+e.message,'error'); }
}

function setPnlStatus(msg, type) {
  const el = document.getElementById('pnl-action-status');
  el.textContent = msg; el.className = 'pnl-action-status ps-' + type;
}


/* ════════════════════════════════════════
   DISPARITY TAB — live quotes + calc
════════════════════════════════════════ */

const dispState = {
  interval: null,
  gold:   { comexAsk: null, comexBid: null, usdinr: null },
  silver: { comexAsk: null, comexBid: null, usdinr: null },
};

const dispParams = {
  gold:   { multiplier: 0.3215,  duty: 0, premBuy: 0, premSell: 0, interbank: 0 },
  silver: { multiplier: 32.1507, duty: 0, premBuy: 0, premSell: 0, interbank: 0 },
};

/* Start polling when account activates */
function dispStartPolling() {
  console.log('[dispStartPolling] called, activeKey:', AccountRegistry.activeKey);
  if (dispState.interval) clearInterval(dispState.interval);
  const noAcc   = document.getElementById('disp-no-acc');
  const content = document.getElementById('disp-content');
  console.log('[dispStartPolling] disp-no-acc:', noAcc, 'disp-content:', content);
  if (noAcc)   noAcc.style.display   = 'none';
  if (content) content.style.display = 'block';
  dispLoadSymbols();
  dispFetchQuotes();
  dispState.interval = setInterval(dispFetchQuotes, 2000);
}

function dispStopPolling() {
  if (dispState.interval) clearInterval(dispState.interval);
  dispState.interval = null;
  document.getElementById('disp-no-acc').style.display  = 'block';
  document.getElementById('disp-content').style.display = 'none';
  dispClearAll();
}

/* Fetch all symbols from broker, filter into gold/silver dropdowns */
async function dispLoadSymbols() {
  const key = AccountRegistry.activeKey;
  console.log('[dispLoadSymbols] activeKey:', key);
  if (!key) { console.warn('[dispLoadSymbols] no active key — aborting'); return; }

  try {
    console.log('[dispLoadSymbols] fetching /disparity/symbols...');
    const res  = await fetch('/disparity/symbols', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account_key: key }),
    });
    const data = await res.json();
    console.log('[dispLoadSymbols] response:', data);

    if (data.error) { console.error('[dispLoadSymbols] error:', data.error); return; }

    console.log('[dispLoadSymbols] gold symbols:', data.gold);
    console.log('[dispLoadSymbols] silver symbols:', data.silver);

    populateSymSelect('sym-gold-select',   data.gold   || []);
    populateSymSelect('sym-silver-select', data.silver || []);

    // Restore saved selections (overrides auto-select if previously chosen)
    const saved = dispLoadSymSelections();
    if (saved.gold   && document.querySelector(`#sym-gold-select   option[value="${saved.gold}"]`))
      document.getElementById('sym-gold-select').value   = saved.gold;
    if (saved.silver && document.querySelector(`#sym-silver-select option[value="${saved.silver}"]`))
      document.getElementById('sym-silver-select').value = saved.silver;

    // Kick off a fetch immediately after symbols are loaded
    dispFetchQuotes();

  } catch(e) { console.error('[dispLoadSymbols] exception:', e); }
}

function populateSymSelect(selectId, symbols) {
  const sel = document.getElementById(selectId);
  console.log(`[populateSymSelect] #${selectId} element:`, sel, 'symbols:', symbols);
  if (!sel) { console.error(`[populateSymSelect] element #${selectId} NOT FOUND in DOM`); return; }
  const prev = sel.value;

  if (!symbols.length) {
    sel.innerHTML = '<option value="">No symbols found</option>';
    return;
  }

  // symbols may be objects {name, trade_mode, tradeable} or plain strings
  sel.innerHTML = symbols.map(s => {
    const name      = s.name      || s;
    const tradeable = s.tradeable !== undefined ? s.tradeable : true;
    const label     = tradeable ? name : `${name} (close only)`;
    return `<option value="${name}" ${!tradeable ? 'style="color:#9ca3af"' : ''}>${label}</option>`;
  }).join('');

  // Restore previous or auto-select first tradeable
  if (prev && sel.querySelector(`option[value="${prev}"]`)) {
    sel.value = prev;
  } else {
    const firstTradeable = symbols.find(s => s.tradeable !== false);
    if (firstTradeable) sel.value = firstTradeable.name || firstTradeable;
  }
  console.log(`[populateSymSelect] #${selectId} selected: ${sel.value}`);
}

function dispOnSymbolChange(metal) {
  dispSaveSymSelections();
  dispFetchQuotes();
}

function dispSaveSymSelections() {
  localStorage.setItem('dispSymSel', JSON.stringify({
    gold:   document.getElementById('sym-gold-select')?.value   || '',
    silver: document.getElementById('sym-silver-select')?.value || '',
  }));
}

function dispLoadSymSelections() {
  try { return JSON.parse(localStorage.getItem('dispSymSel') || '{}'); } catch(e) { return {}; }
}

/* Fetch live quotes for selected symbols */
async function dispFetchQuotes() {
  const key = AccountRegistry.activeKey;
  if (!key) return;

  const goldSym   = document.getElementById('sym-gold-select')?.value;
  const silverSym = document.getElementById('sym-silver-select')?.value;

  if (!goldSym && !silverSym) return;

  // Build symbol map — USDINR handled by backend fallback if not on broker
  const symMap = {
    gold_comex:   goldSym   || '',
    silver_comex: silverSym || '',
    usdinr:       '',   // backend fetches from free API if broker has no USDINR
  };

  try {
    const res  = await fetch('/disparity/quotes', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account_key: key, symbols: symMap }),
    });
    const data = await res.json();
    if (data.error) { dispSetError(data.error); return; }

    const fmt = (v, d=2) => Number(v).toLocaleString('en-IN', {minimumFractionDigits: d, maximumFractionDigits: d});

    // USD/INR
    if (data.usdinr && !data.usdinr.error) {
      const mid = (data.usdinr.bid + data.usdinr.ask) / 2;
      dispState.gold.usdinr   = mid;
      dispState.silver.usdinr = mid;
      document.getElementById('gc-usdinr').textContent = mid.toFixed(2);
      document.getElementById('sc-usdinr').textContent = mid.toFixed(2);
      // Update sidebar rate
      const rb = document.querySelector('.rate-bid');
      const ra = document.querySelector('.rate-ask');
      if (rb) rb.textContent = data.usdinr.bid.toFixed(2);
      if (ra) ra.textContent = data.usdinr.ask.toFixed(2);
      // Show source hint if from API fallback
      const rateLabel = document.querySelector('.rate-label');
      if (rateLabel && data.usdinr.source === 'api') rateLabel.textContent = 'USD/INR~';
      else if (rateLabel) rateLabel.textContent = 'USD/INR';
    }

    // Gold
    if (data.gold_comex && !data.gold_comex.error) {
      const g = data.gold_comex;
      dispState.gold.comexAsk = g.ask;
      dispState.gold.comexBid = g.bid;
      document.getElementById('gold-comex-bid').textContent = fmt(g.bid);
      document.getElementById('gold-comex-ask').textContent = fmt(g.ask);
      document.getElementById('gold-comex-dot').style.background = '#22c55e';
      document.getElementById('gc-comex-price').textContent = fmt(g.ask);
      document.getElementById('gold-sym-status').textContent = '';
      dispRecalc('gold');
    } else if (goldSym) {
      document.getElementById('gold-comex-dot').style.background = '#ef4444';
      document.getElementById('gold-sym-status').textContent = `⚠ ${data.gold_comex?.error || 'Not found'}`;
    }

    // Silver
    if (data.silver_comex && !data.silver_comex.error) {
      const s = data.silver_comex;
      dispState.silver.comexAsk = s.ask;
      dispState.silver.comexBid = s.bid;
      document.getElementById('silver-comex-bid').textContent = fmt(s.bid);
      document.getElementById('silver-comex-ask').textContent = fmt(s.ask);
      document.getElementById('silver-comex-dot').style.background = '#22c55e';
      document.getElementById('sc-comex-price').textContent = fmt(s.ask);
      document.getElementById('silver-sym-status').textContent = '';
      dispRecalc('silver');
    } else if (silverSym) {
      document.getElementById('silver-comex-dot').style.background = '#ef4444';
      document.getElementById('silver-sym-status').textContent = `⚠ ${data.silver_comex?.error || 'Not found'}`;
    }

    // Timestamps
    const now = new Date().toLocaleTimeString();
    document.getElementById('gold-updated').textContent   = now;
    document.getElementById('silver-updated').textContent = now;

  } catch(e) { dispSetError(e.message); }
}

/* Recalculate bank rate and disparity */
function dispRecalc(metal) {
  const prefix    = metal === 'gold' ? 'gc' : 'sc';
  const state     = dispState[metal];
  if (!state.comexAsk || !state.usdinr) return;

  const multiplier = parseFloat(document.getElementById(`${prefix}-multiplier`)?.textContent) || dispParams[metal].multiplier;
  const duty       = parseFloat(document.getElementById(`${prefix}-duty`).value)      || 0;
  const premBuy    = parseFloat(document.getElementById(`${prefix}-prem-buy`).value)  || 0;
  const interbank  = metal === 'gold' ? (parseFloat(document.getElementById('gc-interbank')?.value) || 0) : 0;

  const bankRate  = state.comexAsk * multiplier * state.usdinr * (1 + premBuy / 100) + duty + interbank;

  const fmt  = v => Math.round(v).toLocaleString('en-IN');
  const fmtD = v => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)).toLocaleString('en-IN');

  document.getElementById(`${prefix}-bank-rate`).textContent = fmt(bankRate);

  // Update the right-side price card
  const bankDispEl = document.getElementById(`${metal}-bank-rate-disp`);
  if (bankDispEl) bankDispEl.textContent = fmt(bankRate);

  // Disparity = MCX − bank rate. Since this broker has only COMEX symbols,
  // we show the bank rate conversion. MCX line shows — until MCX symbol added.
  document.getElementById(`${prefix}-mcx-rate`).textContent = '—';
  document.getElementById(`${metal}-mcx-ask-disp`).textContent = '—';
  document.getElementById(`${metal}-mcx-dot`).style.background = '#f59e0b';

  const diffEl  = document.getElementById(`${prefix}-diff`);
  const dispEl  = document.getElementById(`${metal}-disparity`);
  const badgeEl = document.getElementById(`${metal}-disp-badge`);

  // Show bank rate as the reference value
  diffEl.textContent  = fmt(bankRate) + ' ₹';
  diffEl.style.color  = '#185FA5';
  if (dispEl)  { dispEl.textContent = fmt(bankRate); dispEl.style.color = '#0C447C'; }
  if (badgeEl) badgeEl.textContent  = '₹ ' + fmt(bankRate);
}

function dispSetError(msg) {
  ['gold-sym-status','silver-sym-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '⚠ ' + msg; el.style.color = '#A32D2D'; }
  });
}

function dispClearAll() {
  const ids = [
    'gold-comex-bid','gold-comex-ask','silver-comex-bid','silver-comex-ask',
    'gold-disparity','silver-disparity','gc-bank-rate','sc-bank-rate',
    'gc-mcx-rate','sc-mcx-rate','gc-diff','sc-diff','gc-usdinr','sc-usdinr',
    'gc-comex-price','sc-comex-price','gold-bank-rate-disp','silver-bank-rate-disp',
    'gold-mcx-ask-disp','silver-mcx-ask-disp',
  ];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  ['gold-disp-badge','silver-disp-badge'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '—';
  });
  ['gold-comex-dot','gold-mcx-dot','silver-comex-dot','silver-mcx-dot'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.background = '#d1d5db';
  });
}

function dispSaveParams(metal) {
  const prefix = metal === 'gold' ? 'gc' : 'sc';
  dispParams[metal].duty     = parseFloat(document.getElementById(`${prefix}-duty`).value)     || 0;
  dispParams[metal].premBuy  = parseFloat(document.getElementById(`${prefix}-prem-buy`).value) || 0;
  dispParams[metal].premSell = parseFloat(document.getElementById(`${prefix}-prem-sell`).value)|| 0;
  if (metal === 'gold') dispParams[metal].interbank = parseFloat(document.getElementById('gc-interbank')?.value) || 0;
  localStorage.setItem(`dispParams_${metal}`, JSON.stringify(dispParams[metal]));
  const btn = event.target;
  btn.textContent = '✓ Saved';
  setTimeout(() => btn.textContent = 'Save parameters', 1500);
}

/* Load saved params + symbol selections on startup */
(function initDisp() {
  ['gold','silver'].forEach(metal => {
    const saved = localStorage.getItem(`dispParams_${metal}`);
    if (!saved) return;
    try {
      const p = JSON.parse(saved);
      const px = metal === 'gold' ? 'gc' : 'sc';
      if (p.duty      != null && document.getElementById(`${px}-duty`))      document.getElementById(`${px}-duty`).value      = p.duty;
      if (p.premBuy   != null && document.getElementById(`${px}-prem-buy`))  document.getElementById(`${px}-prem-buy`).value  = p.premBuy;
      if (p.premSell  != null && document.getElementById(`${px}-prem-sell`)) document.getElementById(`${px}-prem-sell`).value = p.premSell;
      if (metal === 'gold' && p.interbank != null && document.getElementById('gc-interbank')) document.getElementById('gc-interbank').value = p.interbank;
    } catch(e) {}
  });
})();


/* ════════════════════════════════════════
   SUMMARY TAB
════════════════════════════════════════ */

const sumState = { period: 'ALL' };

function sumOnTabOpen() {
  const acc = AccountRegistry.active();
  const badge = document.getElementById('sum-acc-badge');
  if (badge) badge.textContent = acc ? `${acc.label} · ${acc.login || acc.account}` : 'No account selected';
  if (acc) sumRefresh();
}

function sumSetPeriod(period, btn) {
  sumState.period = period;
  document.querySelectorAll('.sum-period').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  sumRefresh();
}

async function sumRefresh() {
  const key = AccountRegistry.activeKey;
  if (!key) return;
  setSumStatus('Loading…', 'info');
  try {
    const res  = await fetch('/summary/data', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account_key: key, period: sumState.period }),
    });
    const data = await res.json();
    if (data.error) { setSumStatus('⚠ ' + data.error, 'error'); return; }
    renderSummary(data);
    setSumStatus('', '');
  } catch(e) { setSumStatus('⚠ ' + e.message, 'error'); }
}

function renderSummary(data) {
  document.getElementById('sum-placeholder').style.display = 'none';
  document.getElementById('sum-content').style.display     = 'block';

  const a   = data.account;
  const cur = a.currency;
  const fmt = (v, c=cur) => `${c} ${Number(v).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  const fmtPnl = (v) => {
    const s = v >= 0 ? '+' : '';
    return `${s}${fmt(v)}`;
  };
  const cls = v => v >= 0 ? 'pnl-pos' : 'pnl-neg';

  // Account standing
  document.getElementById('sum-account-row').innerHTML = `
    <div class="sum-acc-card">
      <div class="sac-item"><div class="sac-lbl">Balance</div><div class="sac-val">${fmt(a.balance)}</div></div>
      <div class="sac-item"><div class="sac-lbl">Equity</div><div class="sac-val">${fmt(a.equity)}</div></div>
      <div class="sac-item"><div class="sac-lbl">Margin</div><div class="sac-val">${fmt(a.margin)}</div></div>
      <div class="sac-item"><div class="sac-lbl">Free Margin</div><div class="sac-val">${fmt(a.free_margin)}</div></div>
      <div class="sac-item"><div class="sac-lbl">Leverage</div><div class="sac-val">1:${a.leverage}</div></div>
    </div>`;

  // Period labels
  const labels = { D: 'Today', W: 'This week', M: 'This month', ALL: 'All time' };
  document.getElementById('sum-period-label').textContent = labels[data.period] || data.period;
  document.getElementById('sum-trade-count').textContent  = `${data.trade_count} closed trade${data.trade_count !== 1 ? 's' : ''}`;

  // Hero values
  const netEl = document.getElementById('sum-net-pnl');
  netEl.textContent = fmtPnl(data.net_pnl);
  netEl.className   = 'shc-val ' + cls(data.net_pnl);

  const closedEl = document.getElementById('sum-closed-pnl');
  closedEl.textContent = fmtPnl(data.closed_pnl);
  closedEl.className   = 'shc-val ' + cls(data.closed_pnl);

  const openEl = document.getElementById('sum-open-pnl');
  openEl.textContent = fmtPnl(data.open_pnl);
  openEl.className   = 'shc-val ' + cls(data.open_pnl);

  document.getElementById('sum-commission').textContent = fmt(data.commission);
  document.getElementById('sum-swap').textContent       = `Swap: ${fmt(data.swap)}`;

  // P&L by symbol
  const symEntries = Object.entries(data.sym_pnl || {});
  const symPH      = document.getElementById('sum-sym-placeholder');
  const symWrap    = document.getElementById('sum-sym-wrap');
  if (!symEntries.length) {
    symPH.style.display   = 'block';
    symWrap.style.display = 'none';
  } else {
    symPH.style.display   = 'none';
    symWrap.style.display = 'block';
    document.getElementById('sum-sym-body').innerHTML = symEntries
      .sort((a,b) => b[1].pnl - a[1].pnl)
      .map(([sym, d]) => {
        const avg = d.trades ? d.pnl / d.trades : 0;
        return `<tr>
          <td><b>${sym}</b></td>
          <td class="mono">${d.trades}</td>
          <td class="mono ${cls(d.pnl)}">${fmtPnl(d.pnl)}</td>
          <td class="mono dim">${fmt(d.commission)}</td>
          <td class="mono dim">${fmt(d.swap)}</td>
          <td class="mono ${cls(avg)}">${fmtPnl(avg)}</td>
        </tr>`;
      }).join('');
  }

  // Exposure
  const expEntries = Object.entries(data.exposure || {});
  const expPH      = document.getElementById('sum-exp-placeholder');
  const expWrap    = document.getElementById('sum-exp-wrap');
  if (!expEntries.length) {
    expPH.style.display   = 'block';
    expWrap.style.display = 'none';
  } else {
    expPH.style.display   = 'none';
    expWrap.style.display = 'block';
    document.getElementById('sum-exp-body').innerHTML = expEntries.map(([sym, d]) => {
      const net = d.long - d.short;
      return `<tr>
        <td><b>${sym}</b></td>
        <td class="mono">${d.long > 0 ? d.long : '—'}</td>
        <td class="mono">${d.short > 0 ? d.short : '—'}</td>
        <td class="mono ${net > 0 ? 'type-buy' : net < 0 ? 'type-sell' : ''}">${net > 0 ? '+' : ''}${net}</td>
        <td class="mono ${cls(d.open_pnl)}">${fmtPnl(d.open_pnl)}</td>
      </tr>`;
    }).join('');
  }
}

function setSumStatus(msg, type) {
  const el = document.getElementById('sum-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'pnl-action-status' + (type ? ' ps-' + type : '');
}


/* ════════════════════════════════════════
   HISTORY TAB
════════════════════════════════════════ */

const histState = { page: 1, pages: 1, perPage: 10 };

function histOnTabOpen() {
  const acc   = AccountRegistry.active();
  const badge = document.getElementById('hist-acc-badge');
  if (badge) badge.textContent = acc ? `${acc.label} · ${acc.login || acc.account}` : 'No account selected';
  if (acc) histLoad(1);
}

async function histSync() {
  const key = AccountRegistry.activeKey;
  if (!key) return;
  const btn = document.getElementById('hist-sync-btn');
  btn.disabled = true; btn.textContent = '↓ Syncing…';
  setHistStatus('Syncing from MT5…', 'info');
  try {
    const res  = await fetch('/history/sync', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ account_key: key }),
    });
    const data = await res.json();
    if (data.error) { setHistStatus('⚠ ' + data.error, 'error'); return; }
    setHistStatus(`✓ Synced — ${data.added} new deals, ${data.total} total`, 'success');
    histLoad(1);
  } catch(e) { setHistStatus('⚠ ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '↓ Sync from MT5'; }
}

function histClearDates() {
  document.getElementById('hist-date-from').value = '';
  document.getElementById('hist-date-to').value   = '';
  histLoad(1);
}

async function histLoad(page) {
  const key = AccountRegistry.activeKey;
  if (!key) return;

  histState.page = page;
  const dateFrom = document.getElementById('hist-date-from')?.value || null;
  const dateTo   = document.getElementById('hist-date-to')?.value   || null;

  try {
    const res  = await fetch('/history/data', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        account_key: key,
        date_from:   dateFrom,
        date_to:     dateTo ? dateTo + 'T23:59:59' : null,
        page,
        per_page: histState.perPage,
      }),
    });
    const data = await res.json();
    if (data.error) { setHistStatus('⚠ ' + data.error, 'error'); return; }

    histState.pages = data.pages;
    renderHistory(data);
    setHistStatus('', '');
  } catch(e) { setHistStatus('⚠ ' + e.message, 'error'); }
}

function renderHistory(data) {
  document.getElementById('hist-placeholder').style.display = 'none';
  document.getElementById('hist-content').style.display     = 'block';

  const meta = document.getElementById('hist-meta');
  meta.textContent = `${data.total} deal${data.total !== 1 ? 's' : ''} · page ${data.page} of ${data.pages}`;

  const body = document.getElementById('hist-body');
  if (!data.deals.length) {
    body.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#9ca3af;padding:24px">No deals found</td></tr>`;
    document.getElementById('hist-pagination').innerHTML = '';
    return;
  }

  body.innerHTML = data.deals.map(d => {
    const pnlCls  = d.profit > 0 ? 'pnl-pos' : d.profit < 0 ? 'pnl-neg' : '';
    const typeCls = d.type === 'Buy' ? 'type-buy' : d.type === 'Sell' ? 'type-sell' : '';
    return `<tr>
      <td class="small dim">${d.time_str || new Date(d.time*1000).toLocaleString()}</td>
      <td class="mono small">${d.ticket}</td>
      <td><b>${d.symbol}</b></td>
      <td><span class="type-badge ${typeCls}">${d.type}</span></td>
      <td class="small dim">${d.entry}</td>
      <td class="mono">${d.volume}</td>
      <td class="mono">${d.price}</td>
      <td class="mono dim">${d.commission}</td>
      <td class="mono dim">${d.swap}</td>
      <td class="mono ${pnlCls}"><b>${d.profit > 0 ? '+' : ''}${d.profit}</b></td>
      <td class="small dim">${d.comment || '—'}</td>
    </tr>`;
  }).join('');

  // Pagination
  const pg   = document.getElementById('hist-pagination');
  const btns = [];
  if (data.page > 1)           btns.push(`<button class="hist-pg-btn" onclick="histLoad(1)">«</button>`);
  if (data.page > 1)           btns.push(`<button class="hist-pg-btn" onclick="histLoad(${data.page-1})">‹</button>`);
  btns.push(`<span class="hist-pg-info">${data.page} / ${data.pages}</span>`);
  if (data.page < data.pages)  btns.push(`<button class="hist-pg-btn" onclick="histLoad(${data.page+1})">›</button>`);
  if (data.page < data.pages)  btns.push(`<button class="hist-pg-btn" onclick="histLoad(${data.pages})">»</button>`);
  pg.innerHTML = btns.join('');
}

function setHistStatus(msg, type) {
  const el = document.getElementById('hist-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'pnl-action-status' + (type ? ' ps-' + type : '');
}
