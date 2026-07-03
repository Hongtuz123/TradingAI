import os

def patch_app():
    app_path = "app.js"
    if not os.path.exists(app_path):
        print("❌ app.js 不存在")
        return
        
    with open(app_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. 插入 RS Percentile 預計算
    # 尋找 let stats = { totalScore: 0 };
    # 注意 app.js 中可能有的空行
    target_stats = "let stats = { totalScore: 0 };"
    rs_calc_code = """
  // --- 預先計算全市場股票的最新 20日漲幅百分位數 (RS Percentile) ---
  let returns = [];
  mockStocks.forEach(st => {
    if (st.kline && st.kline.length >= 21) {
      const lastClose = parseFloat(st.kline[st.kline.length - 1].close);
      const prevClose = parseFloat(st.kline[st.kline.length - 21].close);
      const ret = prevClose > 0 ? (lastClose - prevClose) / prevClose : 0;
      returns.push({ id: st.id, ret: ret });
    } else {
      returns.push({ id: st.id, ret: 0 });
    }
  });
  returns.sort((a, b) => a.ret - b.ret);
  let rsPercentiles = {};
  const totalN = returns.length;
  returns.forEach((item, idx) => {
    rsPercentiles[item.id] = totalN > 1 ? idx / (totalN - 1) : 1.0;
  });
"""
    
    if "rsPercentiles" in content:
        print("ℹ️ RS Percentile 已經存在，跳過。")
    else:
        idx = content.find(target_stats)
        if idx == -1:
            print("❌ 找不到 stats 初始化位置，無法插入 RS Percentile")
            return
        
        # 插入
        content = content[:idx + len(target_stats)] + "\n" + rs_calc_code + content[idx + len(target_stats):]
        print("✅ 成功插入 RS Percentile 預計算")

    # 2. 替換 L2 評分運算段
    # 尋找開頭 anchor
    start_anchor = "      // 1. 200MA 運算"
    # 尋找結尾 anchor
    end_anchor = "      s.passedIndicators = passedIndicators;"
    
    start_pos = content.find(start_anchor)
    end_pos = content.find(end_anchor)
    
    if start_pos == -1 or end_pos == -1:
        print(f"❌ 找不到 L2 評分運算錨點：start={start_pos}, end={end_pos}")
        return
        
    # 我們要把從 start_pos 到 end_pos + len(end_anchor) 的部分替換成新代碼
    new_l2_code = """      // 1. 200MA & 50MA 運算
      const ma200Arr = calculateSMA(candles, 200);
      const ma50Arr = calculateSMA(candles, 50);
      const m200 = ma200Arr.length > 0 ? ma200Arr[ma200Arr.length - 1] : null;
      const m50 = ma50Arr.length > 0 ? ma50Arr[ma50Arr.length - 1] : null;
      const isAbove200MA = m200 && m50 && price > m200.value && m50.value > m200.value;

      // 2. 雙 Supertrend 運算
      const stData = calculateSupertrend(candles, 10, 3);
      const stLongData = calculateSupertrend(candles, 20, 5);
      let isStBull = false;
      if (stData.length > 0 && stLongData.length > 0) {
        const currSt = stData[stData.length - 1];
        const currStLong = stLongData[stLongData.length - 1];
        isStBull = currSt && currSt.trend === 1 && currStLong && currStLong.trend === 1;
      }

      // 3. DMI 運算
      const dmiData = calculateDMI(candles, 14);
      let isDmiBull = false;
      if (dmiData.adx && dmiData.adx.length > 0) {
        const adxVal = dmiData.adx[dmiData.adx.length - 1];
        const plusDIVal = dmiData.plusDI[dmiData.plusDI.length - 1];
        const prevPlusDIVal = dmiData.plusDI[dmiData.plusDI.length - 2];
        const minusDIVal = dmiData.minusDI[dmiData.minusDI.length - 1];
        isDmiBull = adxVal !== null && adxVal > 25 && plusDIVal !== null && minusDIVal !== null && plusDIVal > minusDIVal && prevPlusDIVal !== null && plusDIVal > prevPlusDIVal;
      }

      // 4. 下行趨勢線突破與回踩 且 接近前高
      const tl = calculateTrendlineAt(candles, t);
      let isTrendlineBreak = false;
      if (tl && tl.value !== null) {
        const isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
        const high20d = candles.slice(-20).reduce((max, c) => Math.max(max, c.high), 0);
        isTrendlineBreak = isBreak && price > high20d * 0.95;
      }

      // 5. 量能比與收紅K (價漲量增)
      const gateVolRatio = (() => {
        if (s.kline && s.kline.length >= 20) {
          const cv = s.kline.map(d => ({ volume: parseFloat(d.volume || 0) }));
          const last20sum = cv.slice(-20).reduce((a, c) => a + c.volume, 0);
          const vma20 = last20sum / 20;
          const lastVol = cv[cv.length - 1].volume;
          return vma20 > 0 ? lastVol / vma20 : 0;
        }
        return s.volRatio || 0;
      })();
      const isVolAboveMa = gateVolRatio >= 1.5 && price > curr.open;

      // 6. 均線多頭排列 (5MA > 10MA > 20MA > 60MA)
      const ma5Arr = calculateSMA(candles, 5);
      const ma10Arr = calculateSMA(candles, 10);
      const ma20Arr = calculateSMA(candles, 20);
      const ma60Arr = calculateSMA(candles, 60);
      const m5 = ma5Arr.length > 0 ? ma5Arr[ma5Arr.length - 1] : null;
      const m10 = ma10Arr.length > 0 ? ma10Arr[ma10Arr.length - 1] : null;
      const m20 = ma20Arr.length > 0 ? ma20Arr[ma20Arr.length - 1] : null;
      const m60 = ma60Arr.length > 0 ? ma60Arr[ma60Arr.length - 1] : null;
      const isMaBull = m5 && m10 && m20 && m60 && m5.value > m10.value && m10.value > m20.value && m20.value > m60.value;

      // 7. 相對強弱度 (RS Percentile >= 80%)
      const rsPct = rsPercentiles[s.id] || 0.5;
      const isRsBull = rsPct >= 0.80;

      // 8. RSI(14) 安全區 (50 < RSI < 70)
      const rsiArr = calculateRSI(candles, 14);
      const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1].value : null;
      const isRsiSafe = rsi !== null && rsi > 50 && rsi < 70;

      // 9. 跌破短期均線 20MA
      const isBelow20MA = m20 && price < m20.value;

      // 10. 超買區 RSI > 75 追高
      const isRsiOverheated = rsi !== null && rsi > 75;

      // 11. 成交量萎縮 (今日量 < 20日均量 * 0.5)
      const isVolShrink = gateVolRatio < 0.5;

      // 記錄 L2 狀態旗標 (與 S3 優化條件對齊)
      s.passedL2Flags = {
        above200ma: isAbove200MA,
        stBull: isStBull,
        dmiBull: isDmiBull,
        trendlineBreak: isTrendlineBreak,
        volAboveMa: isVolAboveMa
      };

      // 收集不符合的 L2 指標以供彈窗詳細展示
      let failedL2Indicators = [];
      if (!isAbove200MA) failedL2Indicators.push('趨勢多頭排列未成 (需股價 > 200MA 且 50MA > 200MA)');
      if (!isStBull) failedL2Indicators.push('雙 Supertrend 未皆為多頭 (10,3 及 20,5)');
      if (!isDmiBull) failedL2Indicators.push('DMI 未達強多頭 (需 ADX > 25 且 +DI > -DI 且 +DI 上升)');
      if (!isTrendlineBreak) failedL2Indicators.push('下降壓力線未突破，或收盤未接近 20日高點 95%');
      if (!isVolAboveMa) failedL2Indicators.push('量能未大於 20日均量 1.5x，或當日收盤為黑K');
      s.failedL2Indicators = failedL2Indicators;

      // --- L2 得分計算 (S3 機制：總原始分 145 歸一化為 100 分，再減去扣分) ---
      let passedIndicators = [];
      let rawScore = 0;
      
      if (isAbove200MA) { rawScore += 15; passedIndicators.push('股價多頭排列 (15分)'); }
      if (isStBull) { rawScore += 15; passedIndicators.push('雙 Supertrend 多頭 (15分)'); }
      if (isDmiBull) { rawScore += 20; passedIndicators.push('DMI 強多頭 (20分)'); }
      if (isTrendlineBreak) { rawScore += 25; passedIndicators.push('突破下降軌道且接近前高 (25分)'); }
      if (isVolAboveMa) { rawScore += 25; passedIndicators.push('強勢放量收紅 (25分)'); }
      
      // 新增加分項
      if (isMaBull) { rawScore += 15; passedIndicators.push('均線多頭排列 (+15分)'); }
      if (isRsBull) { rawScore += 20; passedIndicators.push('相對強弱 RS 動能前 20% (+20分)'); }
      if (isRsiSafe) { rawScore += 10; passedIndicators.push('RSI 介於安全區 (+10分)'); }
      
      let normalizedScore = (rawScore / 145) * 100;
      
      // 風控扣分項
      let penalty = 0;
      let penaltyIndicators = [];
      if (isBelow20MA) { penalty += 10; penaltyIndicators.push('跌破 20MA (-10分)'); }
      if (isRsiOverheated) { penalty += 15; penaltyIndicators.push('RSI > 75 追高 (-15分)'); }
      if (isVolShrink) { penalty += 10; penaltyIndicators.push('成交量萎縮 < 0.5x (-10分)'); }
      
      s.penaltyIndicators = penaltyIndicators;
      s.passedIndicators = passedIndicators;
      
      score = Math.max(0, Math.round(normalizedScore - penalty));"""
      
    content = content[:start_pos] + new_l2_code + content[end_pos + len(end_anchor):]
    print("✅ 成功替換 L2 評分運算段")

    # 3. 補上 K線長度不足 else 區塊中的 penaltyIndicators = []
    target_else = "s.failedL2Indicators = ['K線長度不足，無法評估技術面'];"
    idx_else = content.find(target_else)
    if idx_else != -1:
        content = content[:idx_else + len(target_else)] + "\n      s.penaltyIndicators = [];" + content[idx_else + len(target_else):]
        print("✅ 成功補齊 K線長度不足 else 區塊的 penalty 宣告")
    else:
        print("❌ 找不到 K線長度不足 else 錨點")

    # 4. 替換彈窗 alert 的內容與 onclick
    # 宣告 penaltyStr
    target_click = "const failedL2Str = s.failedL2Indicators && s.failedL2Indicators.length > 0"
    idx_click = content.find(target_click)
    if idx_click != -1:
        penalty_decl = """const penaltyStr = s.penaltyIndicators && s.penaltyIndicators.length > 0 
        ? s.penaltyIndicators.map(i => `! ${i}`).join(String.fromCharCode(10)) 
        : '無';\n\n      """
        content = content[:idx_click] + penalty_decl + content[idx_click:]
        print("✅ 成功插入 penaltyStr 宣告")
    else:
        print("❌ 找不到 failedL2Str 宣告錨點")

    # 修改 alert 拼接
    # 舊的 alert：
    # alert(`【${s.id} ${s.name}】\n荳荳評分：${s.dynamicScore} 分 (滿分100)\n\n🟢 通過的技術指標與加分項：\n${passedStr}\n\n⚠️ 未符合的 L2 技術指標：\n${failedL2Str}\n\n🔴 未符合的過濾/資金門檻：\n${failedStr}\n\n${advice}`);
    # 我們直接尋找這個特定的 alert 字串並替換它！
    old_alert = "alert(`【${s.id} ${s.name}】\\n荳荳評分：${s.dynamicScore} 分 (滿分100)\\n\\n🟢 通過的技術指標與加分項：\\n${passedStr}\\n\\n⚠️ 未符合的 L2 技術指標：\\n${failedL2Str}\\n\\n🔴 未符合的過濾/資金門檻：\\n${failedStr}\\n\\n${advice}`);"
    new_alert = "alert(`【${s.id} ${s.name}】\\n荳荳評分：${s.dynamicScore} 分 (滿分100)\\n\\n🟢 通過的技術指標與加分項：\\n${passedStr}\\n\\n🔴 扣分防護觸發：\\n${penaltyStr}\\n\\n⚠️ 未符合的 L2 技術指標：\\n${failedL2Str}\\n\\n🔴 未符合的過濾/資金門檻：\\n${failedStr}\\n\\n${advice}`);"
    
    idx_alert = content.find(old_alert)
    if idx_alert != -1:
        content = content.replace(old_alert, new_alert)
        print("✅ 成功修改 alert 提示，加入扣分防護顯示")
    else:
        # 如果因為換行或空格找不到，用一個比較寬鬆的 replace
        # 尋找 alert(`【${s.id} ${s.name}】
        anchor_alert = "alert(`【${s.id} ${s.name}】"
        idx_a = content.find(anchor_alert)
        if idx_a != -1:
            print("⚠️ 找到 alert 開頭但沒有完全匹配，嘗試手動替換...")
            # 找到這行 alert 結尾的 `);`
            idx_end_a = content.find(");", idx_a)
            if idx_end_a != -1:
                # 取代
                old_alert_block = content[idx_a : idx_end_a + 2]
                new_alert_block = old_alert_block.replace("🟢 通過的技術指標與加分項：\\n${passedStr}", "🟢 通過的技術指標與加分項：\\n${passedStr}\\n\\n🔴 扣分防護觸發：\\n${penaltyStr}")
                content = content.replace(old_alert_block, new_alert_block)
                print("✅ 成功透過寬鬆替換修改 alert 提示")
            else:
                print("❌ 找不到 alert 結尾")
        else:
            print("❌ 找不到 alert 提示錨點")

    # 5. 以原本的換行符寫回，避免 Git 換行符混亂
    with open(app_path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    print("🎉 app.js 替換完成！")

if __name__ == "__main__":
    patch_app()
