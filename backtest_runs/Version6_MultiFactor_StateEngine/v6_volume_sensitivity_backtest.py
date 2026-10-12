import pandas as pd
import numpy as np
import yfinance as yf
import os
from datetime import datetime

# ==========================================
# 台股交易與回測全局參數
# ==========================================
INITIAL_CASH = 1_000_000.0
FEE_RATE     = 0.001425 * 0.6  # 台股手續費 6折
TAX_RATE     = 0.003           # 證券交易稅 0.3%
STOP_LOSS    = 0.20            # 硬性停損 -20%
POS_PCT      = 0.05            # 單筆倉位 5%

TEST_SYMBOLS = [
    {'code': '2330.TW', 'name': '台積電'},
    {'code': '2317.TW', 'name': '鴻海'},
    {'code': '3231.TW', 'name': '緯創'},
    {'code': '2382.TW', 'name': '廣達'},
    {'code': '3017.TW', 'name': '奇鋐'},
    {'code': '2360.TW', 'name': '致茂'},
    {'code': '3030.TW', 'name': '德律'},
    {'code': '2059.TW', 'name': '川湖'},
    {'code': '2301.TW', 'name': '光寶科'},
    {'code': '6669.TW', 'name': '緯穎'},
    {'code': '2454.TW', 'name': '聯發科'},
    {'code': '2303.TW', 'name': '聯電'},
    {'code': '2603.TW', 'name': '長榮'},
    {'code': '2609.TW', 'name': '陽明'},
    {'code': '3037.TW', 'name': '欣興'},
]

def add_atr(df, w=14):
    pc = df['Close'].shift(1)
    tr = pd.concat([df['High']-df['Low'], (df['High']-pc).abs(), (df['Low']-pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0/w, adjust=False).mean()

def add_supertrend(df, period=10, mult=3.0):
    atr = add_atr(df, period).values
    hl2 = (df['High'].values + df['Low'].values) / 2.0
    c   = df['Close'].values
    n   = len(df)
    bub = hl2 + mult * atr
    blb = hl2 - mult * atr
    fub = np.zeros(n); flb = np.zeros(n)
    st  = np.zeros(n); d   = np.ones(n, dtype=int)
    for i in range(1, n):
        fub[i] = bub[i] if (bub[i] < fub[i-1] or c[i-1] > fub[i-1]) else fub[i-1]
        flb[i] = blb[i] if (blb[i] > flb[i-1] or c[i-1] < flb[i-1]) else flb[i-1]
        if d[i-1] == 1:
            if c[i] < flb[i]: d[i] = -1; st[i] = fub[i]
            else:             d[i] =  1; st[i] = flb[i]
        else:
            if c[i] > fub[i]: d[i] =  1; st[i] = flb[i]
            else:             d[i] = -1; st[i] = fub[i]
    df['st_val'] = st
    df['st_dir'] = d
    return df

def calc_v6_score(df):
    df['ma5']  = df['Close'].rolling(5).mean()
    df['ma20'] = df['Close'].rolling(20).mean()
    df['vol_ma20'] = df['Volume'].rolling(20).mean()
    df['vol_ratio'] = df['Volume'] / df['vol_ma20'].replace(0, 1)

    df = add_supertrend(df)

    scores = []
    for i in range(len(df)):
        if i < 20:
            scores.append(0)
            continue
        st_dir = df['st_dir'].iloc[i]
        if st_dir == -1:
            scores.append(30)
            continue

        c = df['Close'].iloc[i]
        m5 = df['ma5'].iloc[i]
        m20 = df['ma20'].iloc[i]
        vr = df['vol_ratio'].iloc[i]
        o = df['Open'].iloc[i]
        h = df['High'].iloc[i]
        l = df['Low'].iloc[i]

        f_ma = 20 if (c > m5 > m20) else (10 if c > m20 else (5 if c > m5 else 0))
        
        # 爆量分
        rng = (h - l + 1e-9)
        u_shadow = (h - max(o, c)) / rng
        is_stagnant = (vr > 2.2 and (c < o or u_shadow > 0.4))
        f_vol = 10 if is_stagnant else (25 if vr > 1.2 else (15 if vr > 1.0 else 0))

        # K線型態
        is_bull_k = c > o
        low20 = df['Low'].iloc[max(0, i-20):i].min()
        near_sup = (l <= low20 * 1.03) and is_bull_k
        f_pat = 20 if (is_bull_k and near_sup) else (10 if is_bull_k else 0)

        f_chip = 25  # 模擬強籌碼基準分
        f_adx  = 20  # 模擬強ADX

        bias = (c - m20) / m20 if m20 > 0 else 0
        penalty = 15 if bias > 0.20 else (10 if bias > 0.15 else 0)

        tot = min(100, max(0, f_adx + f_ma + f_vol + f_pat + f_chip - penalty))
        scores.append(tot)

    df['score'] = scores
    return df

def run_simulation(df_dict, scenario_type):
    """
    scenario_type:
    - 'vol_above_1': 70分以上 + vol_ratio >= 1.0
    - 'vol_below_1': 70分以上 + vol_ratio < 1.0
    """
    cash = INITIAL_CASH
    positions = []
    closed_trades = []

    for sym, df in df_dict.items():
        if df.empty or len(df) < 50:
            continue
        
        pos_entry_price = 0.0
        pos_shares = 0
        in_pos = False

        for i in range(20, len(df)):
            c = df['Close'].iloc[i]
            l = df['Low'].iloc[i]
            st_dir = df['st_dir'].iloc[i]
            sc = df['score'].iloc[i]
            vr = df['vol_ratio'].iloc[i]

            # 離場判斷
            if in_pos:
                stop_price = pos_entry_price * (1.0 - STOP_LOSS)
                is_stop = l <= stop_price or c <= stop_price
                is_st_exit = st_dir == -1

                if is_stop or is_st_exit:
                    exit_price = stop_price if is_stop else c
                    sell_amt = pos_shares * exit_price
                    fee = sell_amt * FEE_RATE
                    tax = sell_amt * TAX_RATE
                    net_sell = sell_amt - fee - tax
                    
                    buy_amt = pos_shares * pos_entry_price
                    pnl_twd = net_sell - buy_amt
                    pnl_pct = (pnl_twd / buy_amt) * 100

                    closed_trades.append({
                        'symbol': sym,
                        'pnl_twd': pnl_twd,
                        'pnl_pct': pnl_pct,
                        'is_win': pnl_twd > 0
                    })

                    cash += net_sell
                    in_pos = False
                    pos_shares = 0

            # 進場判斷 (得分 >= 70 分)
            if not in_pos and sc >= 70 and st_dir == 1:
                condition = False
                if scenario_type == 'vol_above_1' and vr >= 1.0:
                    condition = True
                elif scenario_type == 'vol_below_1' and vr < 1.0:
                    condition = True

                if condition:
                    pos_size = cash * POS_PCT
                    shares = int(pos_size / (c * 1.001425))
                    if shares > 0:
                        buy_cost = shares * c * (1.0 + FEE_RATE)
                        cash -= buy_cost
                        pos_entry_price = c
                        pos_shares = shares
                        in_pos = True

    if not closed_trades:
        return {'tot_ret': 0.0, 'win_rate': 0.0, 'pf': 0.0, 'trades': 0}

    total_pnl = sum(t['pnl_twd'] for t in closed_trades)
    tot_ret = (total_pnl / INITIAL_CASH) * 100
    wins = [t for t in closed_trades if t['is_win']]
    losses = [t for t in closed_trades if not t['is_win']]
    win_rate = (len(wins) / len(closed_trades)) * 100

    gross_profit = sum(t['pnl_twd'] for t in wins)
    gross_loss   = abs(sum(t['pnl_twd'] for t in losses))
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

    return {
        'tot_ret': tot_ret,
        'win_rate': win_rate,
        'pf': pf,
        'trades': len(closed_trades)
    }

def main():
    print("==========================================================================")
    print("🔬 台股 Version 6 策略 — 70分標準下「爆量 >= 1.0x」vs「未爆量 < 1.0x」效益對比")
    print("==========================================================================\n")

    df_dict = {}
    print("📥 下載台股主力熱門標的全歷史 K 線數據...")
    for s in TEST_SYMBOLS:
        try:
            df = yf.download(s['code'], start='2019-01-01', progress=False)
            if isinstance(df.columns, pd.MultiIndex):
                df = df.xs(s['code'], axis=1, level=1)
            df = df.dropna(subset=['Close'])
            if len(df) > 100:
                df_dict[s['name']] = calc_v6_score(df)
        except Exception as e:
            pass

    res_above = run_simulation(df_dict, 'vol_above_1')
    res_below = run_simulation(df_dict, 'vol_below_1')

    print("🏆 【台股 70分標準下量能敏感度回測對比】")
    print("==========================================================================")
    res_data = [
        {
            '量能條件': '🟢 爆量組 (Volume >= 1.0x 均量)',
            '總報酬率 (%)': f"{res_above['tot_ret']:+.2f}%",
            '勝率 Win Rate (%)': f"{res_above['win_rate']:.2f}%",
            '盈虧比 (Profit Factor)': f"{res_above['pf']:.2f}",
            '總交易筆數': res_above['trades']
        },
        {
            '量能條件': '⚪ 未爆量組 (Volume < 1.0x 均量)',
            '總報酬率 (%)': f"{res_below['tot_ret']:+.2f}%",
            '勝率 Win Rate (%)': f"{res_below['win_rate']:.2f}%",
            '盈虧比 (Profit Factor)': f"{res_below['pf']:.2f}",
            '總交易筆數': res_below['trades']
        }
    ]
    print(pd.DataFrame(res_data).to_string(index=False))

if __name__ == '__main__':
    main()
