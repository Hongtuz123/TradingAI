import os

app_path = r"c:\GoogleAntigravity\2026Trading1\app.js"

with open(app_path, "r", encoding="utf-8") as rf:
    content = rf.read()

# 標準化以防 Windows \r\n 導致匹配失敗
normalized_content = content.replace("\r\n", "\n")

start_anchor = "  // 1. 台股評分系統 (直接對接後端 0 - 100 分)"
end_anchor = "  if (!isHealthy || hasFailedStocks) {"

start_idx = normalized_content.find(start_anchor)
end_idx = normalized_content.find(end_anchor)

if start_idx != -1 and end_idx != -1:
    replacement = """  // 1. 台股評分系統 (直接對接後端 0 - 100 分)
  const twTotalScore = marketData.tw_health_score !== undefined ? marketData.tw_health_score : 0;
  
  let twRating = '普通';
  let twColor = 'var(--warning)';
  let twBg = 'rgba(245, 158, 11, 0.15)';
  if (twTotalScore < 60) {
    twRating = '偏空';
    twColor = 'var(--danger)';
    twBg = 'rgba(239, 68, 68, 0.15)';
  } else if (twTotalScore >= 80) {
    twRating = '多';
    twColor = 'var(--success)';
    twBg = 'rgba(16, 185, 129, 0.15)';
  }
  
  // 更新台股標題旁邊的分數 Badge
  const twScoreBadge = document.getElementById('twMarketScoreBadge');
  if (twScoreBadge) {
    twScoreBadge.innerText = `${twTotalScore}分 (${twRating})`;
    twScoreBadge.style.color = twColor;
    twScoreBadge.style.background = twBg;
  }
  
  // 保持舊隱藏欄位值（供防禦性防錯）
  const twGradeEl = document.getElementById('twHealthGrade');
  if (twGradeEl) {
    twGradeEl.innerText = `${twRating} (${twTotalScore}分)`;
    twGradeEl.style.color = twColor;
    twGradeEl.style.background = twBg;
  }
 
  // 2. 美股評分系統 (直接對接後端 0 - 100 分)
  const usTotalScore = marketData.us_health_score !== undefined ? marketData.us_health_score : 0;
  
  let usRating = '普通';
  let usColor = 'var(--warning)';
  let usBg = 'rgba(245, 158, 11, 0.15)';
  if (usTotalScore < 60) {
    usRating = '偏空';
    usColor = 'var(--danger)';
    usBg = 'rgba(239, 68, 68, 0.15)';
  } else if (usTotalScore >= 80) {
    usRating = '多';
    usColor = 'var(--success)';
    usBg = 'rgba(16, 185, 129, 0.15)';
  }
  
  // 更新美股標題旁邊的分數 Badge
  const usScoreBadge = document.getElementById('usMarketScoreBadge');
  if (usScoreBadge) {
    usScoreBadge.innerText = `${usTotalScore}分 (${usRating})`;
    usScoreBadge.style.color = usColor;
    usScoreBadge.style.background = usBg;
  }

  // 保持舊隱藏欄位值（供防禦性防錯）
  const usGradeEl = document.getElementById('usHealthGrade');
  if (usGradeEl) {
    usGradeEl.innerText = `${usRating} (${usTotalScore}分)`;
    usGradeEl.style.color = usColor;
    usGradeEl.style.background = usBg;
  }
 
  // 3. 綜合評級 (雙強則多，雙空則空，其餘安全偏向防守)
  const isHealthy = (twTotalScore >= 80) && (usTotalScore >= 80);
  
  const failedStocks = marketData.price_failed_stocks || [];
  const hasFailedStocks = failedStocks.length > 0;
 
  let overallText = '多頭安全';
  let overallColor = 'var(--success)';
  let overallBg = 'rgba(16, 185, 129, 0.2)';
  let badgeText = '市場偏多';
 
  if (twTotalScore < 60 && usTotalScore < 60) {
    overallText = '全面看空';
    overallColor = 'var(--danger)';
    overallBg = 'rgba(239, 68, 68, 0.2)';
    badgeText = '建議降低部位';
  } else if (twTotalScore < 60) {
    overallText = '防守 (台股偏弱)';
    overallColor = 'var(--warning)';
    overallBg = 'rgba(245, 158, 11, 0.2)';
    badgeText = '台股震盪，加強防守';
  } else if (usTotalScore < 60) {
    overallText = '防守 (美股偏弱)';
    overallColor = 'var(--warning)';
    overallBg = 'rgba(245, 158, 11, 0.2)';
    badgeText = '美股偏弱，警惕拉回';
  } else if (twTotalScore < 80 || usTotalScore < 80) {
    overallText = '多頭防守';
    overallColor = 'var(--warning)';
    overallBg = 'rgba(245, 158, 11, 0.2)';
    badgeText = '市場整理中，偏向防守';
  }
 
  // 加上分數統計顯示
  document.getElementById('healthGrade').innerText = `${overallText} [台:${twTotalScore}分/美:${usTotalScore}分]`;
  document.getElementById('healthGrade').style.color = overallColor;
  document.getElementById('healthGrade').style.background = overallBg;
  
  badge.style.backgroundColor = overallBg;
  badge.style.color = overallColor;
  badge.querySelector('.status-dot').style.backgroundColor = overallColor;
  text.innerText = `${badgeText} (台:${twTotalScore}分/美:${usTotalScore}分)`;
  
  """
    
    # 執行替換
    new_content = normalized_content[:start_idx] + replacement + normalized_content[end_idx:]
    
    # 還原換行符號
    if "\r\n" in content:
        content = new_content.replace("\n", "\r\n")
    else:
        content = new_content
        
    print("Replace success using anchors!")
else:
    print(f"Replace failed: start_idx={start_idx}, end_idx={end_idx}")

with open(app_path, "w", encoding="utf-8") as wf:
    wf.write(content)
