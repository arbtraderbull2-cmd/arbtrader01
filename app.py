import json
import time
import MetaTrader5 as mt5
from flask import Flask, request, Response, render_template

app = Flask(__name__)

import os

ACCOUNTS_FILE = os.path.join(os.path.dirname(__file__), 'saved_accounts.json')

def load_accounts():
    if os.path.exists(ACCOUNTS_FILE):
        try:
            with open(ACCOUNTS_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def persist_accounts():
    with open(ACCOUNTS_FILE, 'w') as f:
        json.dump(saved_accounts, f, indent=2)

# Load from disk on startup
saved_accounts = load_accounts()


def mt5_init(creds):
    """Initialize MT5 with given credentials. Retries once on failure."""
    mt5.shutdown()
    time.sleep(0.1)   # brief pause so terminal has time to reset
    ok = mt5.initialize(
        login=int(creds['account']),
        password=creds['password'],
        server=creds['server'],
        timeout=10000
    )
    if not ok:
        # Retry once
        mt5.shutdown()
        time.sleep(0.3)
        ok = mt5.initialize(
            login=int(creds['account']),
            password=creds['password'],
            server=creds['server'],
            timeout=10000
        )
    return ok


# ── Pages ──────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')


# ── Connection test (SSE) ──────────────────────────────────────────────
def stream_test(accounts):
    def generate():
        for exchange, creds in accounts.items():
            yield f"data: {json.dumps({'type': 'start', 'exchange': exchange})}\n\n"
            time.sleep(0.5)
            try:
                mt5.shutdown()
                ok = mt5.initialize(
                    login=int(creds['account']),
                    password=creds['password'],
                    server=creds['server'],
                    timeout=10000
                )
                if not ok:
                    err = mt5.last_error()
                    yield f"data: {json.dumps({'type': 'error', 'exchange': exchange, 'message': str(err)})}\n\n"
                else:
                    info = mt5.account_info()
                    yield f"data: {json.dumps({'type': 'success', 'exchange': exchange, 'account': info.login, 'balance': info.balance, 'currency': info.currency})}\n\n"
                    mt5.shutdown()
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'exchange': exchange, 'message': str(e)})}\n\n"
            time.sleep(1)
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    return generate()


@app.route('/test', methods=['POST'])
def test_connections():
    accounts = request.get_json()
    return Response(stream_test(accounts), mimetype='text/event-stream')


# ── Connect / balance (topbar pills) ──────────────────────────────────
@app.route('/connect', methods=['POST'])
def connect_account():
    body     = request.get_json()
    exchange = body['exchange']
    creds    = body['creds']
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}
        info = mt5.account_info()
        mt5.shutdown()
        return {'account': info.login, 'company': info.company}
    except Exception as e:
        return {'error': str(e)}


@app.route('/balance', methods=['POST'])
def get_balance():
    body  = request.get_json()
    creds = body['creds']
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}
        info = mt5.account_info()
        mt5.shutdown()
        return {
            'balance':     info.balance,
            'equity':      info.equity,
            'margin':      info.margin,
            'free_margin': info.margin_free,
            'currency':    info.currency,
            'leverage':    info.leverage,
        }
    except Exception as e:
        return {'error': str(e)}


# ── Execute tab: account login ─────────────────────────────────────────
@app.route('/exec/login', methods=['POST'])
def exec_login():
    """Login to MT5 account, save it, return account info + traded symbols."""
    body = request.get_json()
    creds = {
        'account':  body['account'],
        'password': body['password'],
        'server':   body['server'],
    }
    label = body.get('label', '') or f"Acc {body['account']}"
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}

        info = mt5.account_info()

        # Fetch symbols this account has traded
        seen    = set()
        symbols = []

        deals = mt5.history_deals_get(0, int(time.time()))
        if deals:
            for d in deals:
                if d.symbol and d.symbol not in seen:
                    seen.add(d.symbol)
                    symbols.append(d.symbol)

        # Also add currently watched symbols as fallback
        watched = mt5.symbols_get()
        if watched:
            for s in watched:
                if s.name not in seen:
                    symbols.append(s.name)
                    seen.add(s.name)

        mt5.shutdown()

        acc_key = str(info.login)
        saved_accounts[acc_key] = {
            'account':  body['account'],
            'password': body['password'],
            'server':   body['server'],
            'label':    label,
        }
        persist_accounts()

        return {
            'login':    info.login,
            'name':     info.name,
            'company':  info.company,
            'balance':  info.balance,
            'currency': info.currency,
            'leverage': info.leverage,
            'label':    label,
            'symbols':  symbols[:200],   # cap at 200
        }
    except Exception as e:
        return {'error': str(e)}


@app.route('/exec/accounts', methods=['GET'])
def exec_accounts():
    """Return list of saved accounts including credentials for reconnect."""
    return {'accounts': [
        {
            'key':      k,
            'label':    v['label'],
            'account':  v['account'],
            'server':   v['server'],
            'password': v['password'],
        }
        for k, v in saved_accounts.items()
    ]}


@app.route('/exec/remove', methods=['POST'])
def exec_remove():
    """Remove a saved account."""
    key = request.get_json().get('account_key')
    if key in saved_accounts:
        del saved_accounts[key]
        persist_accounts()
        return {'ok': True}
    return {'error': 'Not found'}


@app.route('/exec/symbols', methods=['POST'])
def exec_symbols():
    """Fetch traded symbols for a saved account."""
    body    = request.get_json()
    acc_key = body['account_key']
    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}
        deals = mt5.history_deals_get(0, int(time.time()))
        symbols = []
        if deals:
            seen = set()
            for d in deals:
                if d.symbol and d.symbol not in seen:
                    seen.add(d.symbol)
                    symbols.append(d.symbol)
        mt5.shutdown()
        return {'symbols': symbols}
    except Exception as e:
        return {'error': str(e)}


@app.route('/exec/quote', methods=['POST'])
def exec_quote():
    """Get live bid/ask for a symbol from a saved account."""
    body    = request.get_json()
    acc_key = body['account_key']
    symbol  = body['symbol']
    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}
        tick = mt5.symbol_info_tick(symbol)
        if not tick:
            mt5.shutdown()
            return {'error': f'No tick data for {symbol}'}
        info = mt5.symbol_info(symbol)
        mt5.shutdown()
        return {
            'bid':    tick.bid,
            'ask':    tick.ask,
            'time':   tick.time,
            'digits': info.digits if info else 2,
        }
    except Exception as e:
        return {'error': str(e)}


# ── Execute tab: place order ───────────────────────────────────────────
@app.route('/exec/order', methods=['POST'])
def exec_order():
    """Place a trade order via MT5."""
    body    = request.get_json()
    acc_key = body['account_key']
    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]

    symbol    = body['symbol']
    side      = body['side']           # 'buy' | 'sell'
    order_type = body['order_type']    # 'market' | 'limit' | 'stop' | 'stop_limit'
    lots      = float(body['lots'])
    price     = float(body.get('price', 0))
    sl        = float(body.get('sl', 0))
    tp        = float(body.get('tp', 0))
    deviation = int(body.get('deviation', 10))
    comment   = body.get('comment', 'ArbTrader')
    stoplimit = float(body.get('stoplimit', 0))

    # Map to MT5 constants
    ACTION_MAP = {
        'market':     mt5.TRADE_ACTION_DEAL,
        'limit':      mt5.TRADE_ACTION_PENDING,
        'stop':       mt5.TRADE_ACTION_PENDING,
        'stop_limit': mt5.TRADE_ACTION_PENDING,
    }
    TYPE_MAP = {
        ('buy',  'market'):     mt5.ORDER_TYPE_BUY,
        ('sell', 'market'):     mt5.ORDER_TYPE_SELL,
        ('buy',  'limit'):      mt5.ORDER_TYPE_BUY_LIMIT,
        ('sell', 'limit'):      mt5.ORDER_TYPE_SELL_LIMIT,
        ('buy',  'stop'):       mt5.ORDER_TYPE_BUY_STOP,
        ('sell', 'stop'):       mt5.ORDER_TYPE_SELL_STOP,
        ('buy',  'stop_limit'): mt5.ORDER_TYPE_BUY_STOP_LIMIT,
        ('sell', 'stop_limit'): mt5.ORDER_TYPE_SELL_STOP_LIMIT,
    }

    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}

        tick = mt5.symbol_info_tick(symbol)
        if not tick:
            mt5.shutdown()
            return {'error': f'No tick for {symbol}'}

        # Check symbol trading mode before proceeding
        sym_info = mt5.symbol_info(symbol)
        if sym_info:
            mode_names = {0: 'disabled', 1: 'long only', 2: 'short only', 3: 'close only', 4: 'full'}
            mode = sym_info.trade_mode
            if mode == 0:
                mt5.shutdown()
                return {'error': f'{symbol} — trading is disabled on this symbol'}
            if mode == 3:
                mt5.shutdown()
                return {'error': f'{symbol} — close only (contract may be near expiry or market closed). Try the next contract e.g. GCQ26 instead of GCM26'}

        # For market orders use current ask/bid
        if order_type == 'market':
            price = tick.ask if side == 'buy' else tick.bid

        request_dict = {
            'action':    ACTION_MAP[order_type],
            'symbol':    symbol,
            'volume':    lots,
            'type':      TYPE_MAP[(side, order_type)],
            'price':     price,
            'sl':        sl,
            'tp':        tp,
            'deviation': deviation,
            'comment':   comment,
            'type_time': mt5.ORDER_TIME_GTC,
            'type_filling': mt5.ORDER_FILLING_FOK,  # broker supports FOK only
        }

        if order_type == 'stop_limit':
            request_dict['stoplimit'] = stoplimit

        result = mt5.order_send(request_dict)
        mt5.shutdown()

        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return {
                'error':   f'Order failed: {result.comment}',
                'retcode': result.retcode,
            }

        return {
            'order':   result.order,
            'volume':  result.volume,
            'price':   result.price,
            'comment': result.comment,
        }
    except Exception as e:
        return {'error': str(e)}


@app.route('/exec/symbol_info', methods=['POST'])
def exec_symbol_info():
    """Return trading status of a symbol — useful for diagnosing close-only errors."""
    body    = request.get_json()
    acc_key = body.get('account_key')
    symbol  = body.get('symbol')
    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}
        info = mt5.symbol_info(symbol)
        tick = mt5.symbol_info_tick(symbol)
        mt5.shutdown()
        if not info:
            return {'error': f'Symbol {symbol} not found'}
        mode_names = {0: 'Disabled', 1: 'Long only', 2: 'Short only', 3: 'Close only', 4: 'Full access'}
        import datetime
        return {
            'symbol':        info.name,
            'trade_mode':    info.trade_mode,
            'trade_mode_label': mode_names.get(info.trade_mode, str(info.trade_mode)),
            'session_open':  bool(info.session_deals),
            'bid':           tick.bid if tick else None,
            'ask':           tick.ask if tick else None,
            'spread':        info.spread,
            'digits':        info.digits,
            'volume_min':    info.volume_min,
            'volume_max':    info.volume_max,
            'volume_step':   info.volume_step,
        }
    except Exception as e:
        return {'error': str(e)}


# ── Disparity quotes ──────────────────────────────────────────────────

# Map metal → typical MT5 symbol names (broker-dependent)
METAL_SYMBOLS = {
    'gold':   ['XAUUSD', 'GOLD', 'XAUUSDm', 'XAUUSD.', 'GOLDs'],
    'silver': ['XAGUSD', 'SILVER', 'XAGUSDm', 'XAGUSD.', 'SILVERs'],
}

def find_symbol(candidates):
    """Return first symbol that exists on the connected MT5 terminal."""
    for s in candidates:
        info = mt5.symbol_info(s)
        if info is not None:
            return s
    return None


@app.route('/disparity/symbols', methods=['POST'])
def disparity_symbols():
    """Return all symbols grouped by metal (gold/silver) plus full list."""
    acc_key = request.get_json().get('account_key')
    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}

        # First try all visible symbols in market watch
        all_symbols = mt5.symbols_get()

        # If empty or very few, try fetching ALL symbols from the server
        # mt5.symbols_get("*") returns everything the broker has
        if not all_symbols or len(all_symbols) < 3:
            all_symbols = mt5.symbols_get("*") or []

        mt5.shutdown()

        if not all_symbols:
            return {'symbols': [], 'gold': [], 'silver': [], 'debug': 'No symbols returned from broker'}

        GOLD_KEYWORDS   = ['GOLD', 'XAU', 'GC', 'XAUUSD']
        SILVER_KEYWORDS = ['SILVER', 'XAG', 'SI', 'XAGUSD']

        def matches(name, keywords):
            n = name.upper()
            return any(k in n for k in keywords)

        # Build rich symbol objects with trade_mode info
        def sym_obj(s):
            return {
                'name':       s.name,
                'trade_mode': s.trade_mode,   # 3=close only, 4=full
                'tradeable':  s.trade_mode == 4,
            }

        all_names   = [s.name for s in all_symbols]
        gold_syms   = [sym_obj(s) for s in all_symbols if matches(s.name, GOLD_KEYWORDS)]
        silver_syms = [sym_obj(s) for s in all_symbols if matches(s.name, SILVER_KEYWORDS)]

        usdinr_syms = [s.name for s in all_symbols
                       if any(k in s.name.upper() for k in ['USDINR','USD/INR','INRUSD'])]

        return {
            'symbols':     all_names,
            'gold':        gold_syms,
            'silver':      silver_syms,
            'has_usdinr':  len(usdinr_syms) > 0,
            'total':       len(all_names),
        }
    except Exception as e:
        return {'error': str(e)}


@app.route('/disparity/debug', methods=['POST'])
def disparity_debug():
    """Return raw symbol list for debugging — call from browser console."""
    acc_key = request.get_json().get('account_key')
    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}
        visible   = mt5.symbols_get() or []
        all_syms  = mt5.symbols_get("*") or []
        mt5.shutdown()
        return {
            'visible_count': len(visible),
            'visible':       [s.name for s in visible],
            'total_count':   len(all_syms),
            'all':           [s.name for s in all_syms][:100],  # cap at 100
        }
    except Exception as e:
        return {'error': str(e)}


@app.route('/disparity/quotes', methods=['POST'])
def disparity_quotes():
    """Return live bid/ask for configured symbols from the active account."""
    body    = request.get_json()
    acc_key = body.get('account_key')
    # User-configured symbol mapping: {gold_mcx, gold_comex, silver_mcx, silver_comex, usdinr}
    sym_map = body.get('symbols', {})

    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            err = mt5.last_error()
            return {'error': f'MT5 auth failed: {err}'}

        def get_tick(sym):
            if not sym:
                return None
            tick = mt5.symbol_info_tick(sym)
            info = mt5.symbol_info(sym)
            if not tick:
                return {'error': f'No tick data for {sym}'}
            return {'symbol': sym, 'bid': tick.bid, 'ask': tick.ask,
                    'digits': info.digits if info else 2}

        result = {
            'gold_mcx':    get_tick(sym_map.get('gold_mcx')),
            'gold_comex':  get_tick(sym_map.get('gold_comex')),
            'silver_mcx':  get_tick(sym_map.get('silver_mcx')),
            'silver_comex':get_tick(sym_map.get('silver_comex')),
            'usdinr':      get_tick(sym_map.get('usdinr')),
        }

        mt5.shutdown()

        # If broker has no USDINR, fetch from free API as fallback
        if not result['usdinr'] or result['usdinr'].get('error'):
            try:
                import urllib.request
                url = 'https://api.frankfurter.app/latest?from=USD&to=INR'
                with urllib.request.urlopen(url, timeout=3) as r:
                    fx = json.loads(r.read())
                rate = fx['rates']['INR']
                result['usdinr'] = {
                    'symbol': 'USD/INR (frankfurter.app)',
                    'bid':    round(rate - 0.05, 4),
                    'ask':    round(rate + 0.05, 4),
                    'source': 'api',
                }
            except Exception as e:
                result['usdinr'] = {'error': f'Broker has no USDINR and API fallback failed: {e}'}

        return result
    except Exception as e:
        return {'error': str(e)}


# ── Live PnL routes ───────────────────────────────────────────────────

@app.route('/pnl/positions', methods=['POST'])
def pnl_positions():
    """Fetch all open positions for a saved account."""
    acc_key = request.get_json().get('account_key')
    if acc_key not in saved_accounts:
        return {'error': 'Account not found — try reconnecting in the sidebar'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            err = mt5.last_error()
            hint = ' (wrong password or server name — reconnect in sidebar)' if err[0] == -6 else ''
            return {'error': f'MT5 auth failed: {err}{hint}'}

        positions = mt5.positions_get()
        result = []
        if positions:
            for p in positions:
                result.append({
                    'ticket':      p.ticket,
                    'symbol':      p.symbol,
                    'type':        'BUY' if p.type == 0 else 'SELL',
                    'volume':      p.volume,
                    'open_price':  p.price_open,
                    'current':     p.price_current,
                    'sl':          p.sl,
                    'tp':          p.tp,
                    'profit':      p.profit,
                    'swap':        p.swap,
                    'comment':     p.comment,
                    'open_time':   p.time,
                })
        mt5.shutdown()
        return {'positions': result}
    except Exception as e:
        return {'error': str(e)}


@app.route('/pnl/orders', methods=['POST'])
def pnl_orders():
    """Fetch all pending limit/stop orders for a saved account."""
    acc_key = request.get_json().get('account_key')
    if acc_key not in saved_accounts:
        return {'error': 'Account not found — try reconnecting in the sidebar'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            err = mt5.last_error()
            hint = ' (wrong password or server name — reconnect in sidebar)' if err[0] == -6 else ''
            return {'error': f'MT5 auth failed: {err}{hint}'}

        orders = mt5.orders_get()
        ORDER_TYPES = {
            0: 'BUY Limit', 1: 'SELL Limit',
            2: 'BUY Stop',  3: 'SELL Stop',
            4: 'BUY Stop Limit', 5: 'SELL Stop Limit',
        }
        result = []
        if orders:
            for o in orders:
                result.append({
                    'ticket':      o.ticket,
                    'symbol':      o.symbol,
                    'type':        ORDER_TYPES.get(o.type, str(o.type)),
                    'volume':      o.volume_initial,
                    'price':       o.price_open,
                    'sl':          o.sl,
                    'tp':          o.tp,
                    'comment':     o.comment,
                    'open_time':   o.time_setup,
                })
        mt5.shutdown()
        return {'orders': result}
    except Exception as e:
        return {'error': str(e)}


@app.route('/pnl/close', methods=['POST'])
def pnl_close():
    """Close / cancel selected positions or orders."""
    body    = request.get_json()
    acc_key = body.get('account_key')
    tickets = body.get('tickets', [])    # list of position tickets
    order_tickets = body.get('order_tickets', [])  # list of pending order tickets

    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]

    results = []
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}

        # Close open positions
        for ticket in tickets:
            pos = mt5.positions_get(ticket=ticket)
            if not pos:
                results.append({'ticket': ticket, 'error': 'Position not found'})
                continue
            p    = pos[0]
            tick = mt5.symbol_info_tick(p.symbol)
            close_price = tick.bid if p.type == 0 else tick.ask  # BUY closes at bid
            req = {
                'action':       mt5.TRADE_ACTION_DEAL,
                'position':     ticket,
                'symbol':       p.symbol,
                'volume':       p.volume,
                'type':         mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY,
                'price':        close_price,
                'deviation':    10,
                'comment':      'ArbTrader close',
                'type_time':    mt5.ORDER_TIME_GTC,
                'type_filling': mt5.ORDER_FILLING_FOK,  # this broker supports FOK only
            }
            res = mt5.order_send(req)
            if res.retcode == mt5.TRADE_RETCODE_DONE:
                results.append({'ticket': ticket, 'ok': True, 'price': res.price})
            else:
                results.append({'ticket': ticket, 'error': res.comment})

        # Cancel pending orders
        for ticket in order_tickets:
            req = {
                'action': mt5.TRADE_ACTION_REMOVE,
                'order':  ticket,
            }
            res = mt5.order_send(req)
            if res.retcode == mt5.TRADE_RETCODE_DONE:
                results.append({'ticket': ticket, 'ok': True, 'cancelled': True})
            else:
                results.append({'ticket': ticket, 'error': res.comment})

        mt5.shutdown()
        return {'results': results}
    except Exception as e:
        return {'error': str(e)}


# ── Summary & History routes ──────────────────────────────────────────

from datetime import datetime as dt

HISTORY_FILE = os.path.join(os.path.dirname(__file__), 'trade_history.json')

def load_history_file():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def save_history_file(rows):
    with open(HISTORY_FILE, 'w') as f:
        json.dump(rows, f, indent=2)

def merge_history(existing, new_rows):
    seen = {r['ticket'] for r in existing}
    added = [r for r in new_rows if r['ticket'] not in seen]
    merged = existing + added
    merged.sort(key=lambda r: r['time'], reverse=True)
    return merged


@app.route('/summary/data', methods=['POST'])
def summary_data():
    """P&L summary by period + open exposure per symbol."""
    body    = request.get_json()
    acc_key = body.get('account_key')
    period  = body.get('period', 'ALL')

    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]

    period_seconds = {'D': 86400, 'W': 7*86400, 'M': 30*86400, 'ALL': 0}
    since = int(time.time()) - period_seconds.get(period, 0) if period != 'ALL' else 0

    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}

        now  = int(time.time())
        info = mt5.account_info()
        account_info = {
            'balance':     info.balance,
            'equity':      info.equity,
            'margin':      info.margin,
            'free_margin': info.margin_free,
            'currency':    info.currency,
            'leverage':    info.leverage,
        }

        deals  = mt5.history_deals_get(since, now) or []
        closed = [d for d in deals if d.entry == 1 and d.symbol]

        total_pnl   = sum(d.profit for d in closed)
        total_comm  = sum(d.commission for d in closed)
        total_swap  = sum(d.swap for d in closed)
        trade_count = len(closed)

        sym_pnl = {}
        for d in closed:
            s = d.symbol
            if s not in sym_pnl:
                sym_pnl[s] = {'pnl': 0, 'trades': 0, 'commission': 0, 'swap': 0}
            sym_pnl[s]['pnl']        += d.profit
            sym_pnl[s]['trades']     += 1
            sym_pnl[s]['commission'] += d.commission
            sym_pnl[s]['swap']       += d.swap

        positions = mt5.positions_get() or []
        open_pnl  = sum(p.profit for p in positions)

        exposure = {}
        for p in positions:
            s = p.symbol
            if s not in exposure:
                exposure[s] = {'long': 0, 'short': 0, 'open_pnl': 0}
            if p.type == 0:
                exposure[s]['long']  += p.volume
            else:
                exposure[s]['short'] += p.volume
            exposure[s]['open_pnl'] += p.profit

        mt5.shutdown()
        return {
            'account':     account_info,
            'period':      period,
            'closed_pnl':  round(total_pnl, 2),
            'open_pnl':    round(open_pnl, 2),
            'net_pnl':     round(total_pnl + open_pnl, 2),
            'commission':  round(total_comm, 2),
            'swap':        round(total_swap, 2),
            'trade_count': trade_count,
            'sym_pnl':     {k: {kk: round(vv, 2) if isinstance(vv, float) else vv
                               for kk, vv in v.items()} for k, v in sym_pnl.items()},
            'exposure':    {k: {kk: round(vv, 2) if isinstance(vv, float) else vv
                               for kk, vv in v.items()} for k, v in exposure.items()},
        }
    except Exception as e:
        return {'error': str(e)}


@app.route('/history/sync', methods=['POST'])
def history_sync():
    """Pull all deals from MT5 and save to local history file."""
    body    = request.get_json()
    acc_key = body.get('account_key')
    if acc_key not in saved_accounts:
        return {'error': 'Account not found'}
    creds = saved_accounts[acc_key]
    try:
        ok = mt5_init(creds)
        if not ok:
            return {'error': str(mt5.last_error())}

        deals = mt5.history_deals_get(0, int(time.time())) or []
        mt5.shutdown()

        ENTRY = {0: 'Open', 1: 'Close', 2: 'Reverse', 3: 'Out by'}
        TYPE  = {0: 'Buy',  1: 'Sell',  2: 'Balance', 3: 'Credit'}
        rows  = []
        for d in deals:
            if not d.symbol and d.profit == 0:
                continue
            rows.append({
                'ticket':     d.ticket,
                'order':      d.order,
                'time':       d.time,
                'time_str':   dt.fromtimestamp(d.time).strftime('%Y-%m-%d %H:%M:%S'),
                'symbol':     d.symbol or '—',
                'type':       TYPE.get(d.type,  str(d.type)),
                'entry':      ENTRY.get(d.entry, str(d.entry)),
                'volume':     d.volume,
                'price':      d.price,
                'commission': round(d.commission, 2),
                'swap':       round(d.swap, 2),
                'profit':     round(d.profit, 2),
                'comment':    d.comment,
                'account':    acc_key,
            })

        existing = load_history_file()
        before   = len(existing)
        merged   = merge_history(existing, rows)
        save_history_file(merged)
        return {'synced': len(rows), 'total': len(merged), 'added': len(merged) - before}
    except Exception as e:
        return {'error': str(e)}


@app.route('/history/data', methods=['POST'])
def history_data():
    """Read history from local file with date range + pagination."""
    body      = request.get_json()
    acc_key   = body.get('account_key')
    date_from = body.get('date_from')
    date_to   = body.get('date_to')
    page      = int(body.get('page', 1))
    per_page  = int(body.get('per_page', 10))

    all_rows = load_history_file()
    rows     = [r for r in all_rows if r.get('account') == acc_key] if acc_key else all_rows

    if date_from:
        try:
            ts = dt.fromisoformat(date_from).timestamp()
            rows = [r for r in rows if r['time'] >= ts]
        except Exception:
            pass
    if date_to:
        try:
            ts = dt.fromisoformat(date_to).timestamp()
            rows = [r for r in rows if r['time'] <= ts]
        except Exception:
            pass

    total = len(rows)
    start = (page - 1) * per_page
    return {
        'deals':    rows[start:start + per_page],
        'total':    total,
        'page':     page,
        'pages':    max(1, (total + per_page - 1) // per_page),
        'per_page': per_page,
    }


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
