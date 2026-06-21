"""
mt5_test.py — standalone MT5 diagnostic script
Run: python mt5_test.py
"""

import MetaTrader5 as mt5
import json
from datetime import datetime

# ── CONFIG — fill these in ──────────────────────────
ACCOUNT  = 10107           # your account number
PASSWORD = "Ki@10107"
SERVER   = "NavionFx-Server"
# ────────────────────────────────────────────────────


def separator(title):
    print(f"\n{'─'*50}")
    print(f"  {title}")
    print('─'*50)

def connect():
    mt5.shutdown()
    ok = mt5.initialize(login=ACCOUNT, password=PASSWORD, server=SERVER, timeout=10000)
    if not ok:
        print(f"❌ Connect failed: {mt5.last_error()}")
        return False
    info = mt5.account_info()
    print(f"✓ Connected: {info.name} | {info.company} | Balance: {info.currency} {info.balance:,.2f}")
    return True

# ── TEST 1: Basic connection ─────────────────────────
separator("TEST 1 — Connection")
if not connect():
    exit(1)

# ── TEST 2: Market watch symbols ─────────────────────
separator("TEST 2 — Market Watch symbols (visible)")
visible = mt5.symbols_get() or []
print(f"Count: {len(visible)}")
for s in visible:
    print(f"  {s.name:30} spread={s.spread}")

# ── TEST 3: All broker symbols ───────────────────────
separator("TEST 3 — All broker symbols (mt5.symbols_get('*'))")
all_syms = mt5.symbols_get("*") or []
print(f"Count: {len(all_syms)}")
for s in all_syms[:50]:   # cap at 50 for readability
    print(f"  {s.name:30} visible={s.visible}")
if len(all_syms) > 50:
    print(f"  ... and {len(all_syms)-50} more")

# ── TEST 4: Gold symbols ─────────────────────────────
separator("TEST 4 — Gold symbols")
GOLD_KW = ['GOLD', 'XAU', 'GC']
gold = [s for s in all_syms if any(k in s.name.upper() for k in GOLD_KW)]
print(f"Found {len(gold)} gold symbols:")
for s in gold:
    print(f"  {s.name}")

# ── TEST 5: Silver symbols ───────────────────────────
separator("TEST 5 — Silver symbols")
SILVER_KW = ['SILVER', 'XAG', 'SIN', 'SIV']
silver = [s for s in all_syms if any(k in s.name.upper() for k in SILVER_KW)]
print(f"Found {len(silver)} silver symbols:")
for s in silver:
    print(f"  {s.name}")

# ── TEST 6: Live tick for each gold symbol ───────────
separator("TEST 6 — Live ticks (gold)")
for s in gold:
    tick = mt5.symbol_info_tick(s.name)
    if tick:
        print(f"  ✓ {s.name:20} bid={tick.bid}  ask={tick.ask}  time={datetime.fromtimestamp(tick.time)}")
    else:
        print(f"  ✗ {s.name:20} no tick — {mt5.last_error()}")

# ── TEST 7: Live tick for each silver symbol ─────────
separator("TEST 7 — Live ticks (silver)")
for s in silver:
    tick = mt5.symbol_info_tick(s.name)
    if tick:
        print(f"  ✓ {s.name:20} bid={tick.bid}  ask={tick.ask}  time={datetime.fromtimestamp(tick.time)}")
    else:
        print(f"  ✗ {s.name:20} no tick — {mt5.last_error()}")

# ── TEST 8: USDINR ───────────────────────────────────
separator("TEST 8 — USDINR candidates")
FX_KW = ['USDINR', 'USD/INR', 'INRUSD']
fx = [s for s in all_syms if any(k in s.name.upper() for k in FX_KW)]
print(f"Found {len(fx)} USDINR symbols:")
for s in fx:
    tick = mt5.symbol_info_tick(s.name)
    if tick:
        print(f"  ✓ {s.name:20} bid={tick.bid}  ask={tick.ask}")
    else:
        print(f"  ✗ {s.name:20} no tick")

# ── TEST 9: Open positions ───────────────────────────
separator("TEST 9 — Open positions")
positions = mt5.positions_get() or []
print(f"Count: {len(positions)}")
for p in positions:
    print(f"  #{p.ticket} {p.symbol} {'BUY' if p.type==0 else 'SELL'} {p.volume} lots | P&L: {p.profit:.2f}")

# ── TEST 10: Pending orders ──────────────────────────
separator("TEST 10 — Pending orders")
orders = mt5.orders_get() or []
print(f"Count: {len(orders)}")
for o in orders:
    print(f"  #{o.ticket} {o.symbol} type={o.type} price={o.price_open}")

# ── TEST 11: Trade history (last 10 deals) ───────────
separator("TEST 11 — Last 10 deals (trade history)")
import time
deals = mt5.history_deals_get(0, int(time.time())) or []
print(f"Total deals: {len(deals)}")
for d in list(deals)[-10:]:
    print(f"  {datetime.fromtimestamp(d.time)} {d.symbol:20} {'BUY' if d.type==0 else 'SELL'} {d.volume} @ {d.price}")

mt5.shutdown()
print(f"\n✓ All tests done. MT5 shut down cleanly.")


# ── TEST 12: Broker filling modes + order check ──────
separator("TEST 12 — Filling modes per symbol")
import MetaTrader5 as mt5
mt5.shutdown()
ok = mt5.initialize(login=ACCOUNT, password=PASSWORD, server=SERVER, timeout=10000)
if ok:
    for sym_name in ['GCM26', 'SIN26', 'GCQ26']:
        info = mt5.symbol_info(sym_name)
        if not info:
            print(f"  {sym_name}: not found")
            continue
        # filling_mode is a bitmask: 1=FOK, 2=IOC, 4=Return
        fm = info.filling_mode
        modes = []
        if fm & 1: modes.append('FOK (ORDER_FILLING_FOK)')
        if fm & 2: modes.append('IOC (ORDER_FILLING_IOC)')
        if fm & 4: modes.append('Return (ORDER_FILLING_RETURN)')
        print(f"  {sym_name}: filling_mode={fm} → {', '.join(modes) or 'none'}")
        print(f"    trade_mode={info.trade_mode}  trade_stops_level={info.trade_stops_level}")
        print(f"    volume_min={info.volume_min}  volume_step={info.volume_step}  volume_max={info.volume_max}")

    separator("TEST 13 — Try placing a test BUY order (GCM26, 0.01 lots)")
    sym  = 'GCM26'
    info = mt5.symbol_info(sym)
    tick = mt5.symbol_info_tick(sym)
    if info and tick:
        # Try each filling mode
        for filling, label in [
            (mt5.ORDER_FILLING_IOC,    'IOC'),
            (mt5.ORDER_FILLING_FOK,    'FOK'),
            (mt5.ORDER_FILLING_RETURN, 'RETURN'),
        ]:
            req = {
                'action':       mt5.TRADE_ACTION_DEAL,
                'symbol':       sym,
                'volume':       info.volume_min,
                'type':         mt5.ORDER_TYPE_BUY,
                'price':        tick.ask,
                'deviation':    20,
                'comment':      'ArbTrader test',
                'type_time':    mt5.ORDER_TIME_GTC,
                'type_filling': filling,
            }
            result = mt5.order_send(req)
            print(f"  Filling {label}: retcode={result.retcode} comment='{result.comment}'")
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                print(f"  ✓ ORDER PLACED! ticket={result.order} price={result.price}")
                # Close it immediately
                close_req = {
                    'action':       mt5.TRADE_ACTION_DEAL,
                    'position':     result.order,
                    'symbol':       sym,
                    'volume':       info.volume_min,
                    'type':         mt5.ORDER_TYPE_SELL,
                    'price':        mt5.symbol_info_tick(sym).bid,
                    'deviation':    20,
                    'comment':      'ArbTrader test close',
                    'type_time':    mt5.ORDER_TIME_GTC,
                    'type_filling': filling,
                }
                mt5.order_send(close_req)
                print(f"  ✓ Test position closed")
                break
    mt5.shutdown()


# ── TEST 14: History deals structure ────────────────
separator("TEST 14 — Deal history fields")
mt5.shutdown()
ok = mt5.initialize(login=ACCOUNT, password=PASSWORD, server=SERVER, timeout=10000)
if ok:
    import time
    deals = mt5.history_deals_get(0, int(time.time())) or []
    print(f"Total deals: {len(deals)}")
    if deals:
        d = deals[-1]
        print(f"\nSample deal fields:")
        print(f"  ticket={d.ticket} order={d.order} time={datetime.fromtimestamp(d.time)}")
        print(f"  symbol={d.symbol} type={d.type} entry={d.entry}")
        print(f"  volume={d.volume} price={d.price} commission={d.commission}")
        print(f"  swap={d.swap} profit={d.profit} fee={d.fee}")
        print(f"  comment={d.comment} magic={d.magic}")

    separator("TEST 15 — History orders structure")
    orders = mt5.history_orders_get(0, int(time.time())) or []
    print(f"Total history orders: {len(orders)}")
    if orders:
        o = orders[-1]
        print(f"\nSample order fields:")
        print(f"  ticket={o.ticket} symbol={o.symbol} type={o.type}")
        print(f"  volume_initial={o.volume_initial} price_open={o.price_open}")
        print(f"  state={o.state} time_setup={datetime.fromtimestamp(o.time_setup)}")
        print(f"  time_done={datetime.fromtimestamp(o.time_done) if o.time_done else 'N/A'}")
        print(f"  comment={o.comment} magic={o.magic}")

    separator("TEST 16 — PnL by period")
    now = int(time.time())
    periods = {
        'Today':  now - 86400,
        'Week':   now - 7*86400,
        'Month':  now - 30*86400,
        'All':    0,
    }
    for label, since in periods.items():
        deals = mt5.history_deals_get(since, now) or []
        trades = [d for d in deals if d.symbol and d.profit != 0]
        total_pnl  = sum(d.profit for d in trades)
        total_comm = sum(d.commission for d in trades)
        total_swap = sum(d.swap for d in trades)
        print(f"  {label:8}: {len(trades):3} trades | P&L={total_pnl:+.2f} | comm={total_comm:.2f} | swap={total_swap:.2f}")

    mt5.shutdown()