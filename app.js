/* =======================================================================
   字集評選工具 - 前端邏輯
   - 支援本地 CSV 上傳（RFC 4180 風格，含引號、多行欄位）
   - 交友式操作：保留 / 不保留 / 跳過 + 快捷鍵
   - 本地儲存進度（localStorage），可中斷後續接續
   - 匯出決策結果為 CSV
   ======================================================================= */
(function () {
  const els = {
    startBtn: document.getElementById("startBtn"),
    exportBtn: document.getElementById("exportBtn"),
    clearBtn: document.getElementById("clearBtn"),
    card: document.querySelector("#reviewPanel .card"),
    // 更多功能選單
    menuBtn: document.getElementById("menuBtn"),
    moreMenu: document.getElementById("moreMenu"),
    searchChar: document.getElementById("searchChar"),
    searchGo: document.getElementById("searchGo"),
    jumpUnreviewed: document.getElementById("jumpUnreviewed"),
    countTotal: document.getElementById("countTotal"),
    countKeep: document.getElementById("countKeep"),
    countDrop: document.getElementById("countDrop"),
    countSkip: document.getElementById("countSkip"),
    progressFill: document.getElementById("progressFill"),
    reviewPanel: document.getElementById("reviewPanel"),
    uploadPanel: document.getElementById("uploadPanel"),
    finishBanner: document.getElementById("finishBanner"),
    // 卡片內容
    seqDisplay: document.getElementById("seqDisplay"),
    charDisplay: document.getElementById("charDisplay"),
    unicodeDisplay: document.getElementById("unicodeDisplay"),
    copyCharBtn: document.getElementById("copyCharBtn"),
    fieldSet: document.getElementById("fieldSet"),
    fieldCategory: document.getElementById("fieldCategory"),
    fieldNote: document.getElementById("fieldNote"),
    userNote: document.getElementById("userNote"),
    // 控制鈕
    btnKeep: document.getElementById("btnKeep"),
    btnDrop: document.getElementById("btnDrop"),
    btnSkip: document.getElementById("btnSkip"),
    btnUndo: document.getElementById("btnUndo"),
    indexNow: document.getElementById("indexNow"),
    indexTotal: document.getElementById("indexTotal"),
  };

  const STORAGE_KEYS = Object.freeze({
    decisions: "hanziReviewDecisions",
    history: "hanziReviewHistory",
  });

  /** 狀態 */
  let rawRows = []; // 原始 rows，物件陣列
  let entries = []; // {id, char, unicode, set, category, note, raw}
  let idx = 0; // 目前 index
  let headerMap = {}; // 欄位對應
  let fileName = ""; // 檔名（匯出用）
  let excludeSet = new Set(); // 需排除之漢字（來自 4808.csv）

  /** 讀 storage */
  function loadDecisions() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.decisions) || "{}");
    } catch {
      return {};
    }
  }
  function saveDecisions(obj) {
    localStorage.setItem(STORAGE_KEYS.decisions, JSON.stringify(obj));
  }
  function pushHistory(entryId) {
    const arr = getHistory();
    arr.push(entryId);
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(arr));
  }
  function popHistory() {
    const arr = getHistory();
    const last = arr.pop();
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(arr));
    return last;
  }
  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");
    } catch {
      return [];
    }
  }

  /** 依排除清單過濾 rows（用「漢字」欄位的首字判定） */
  function filterRowsByExclude(rows, headers) {
    const hm = buildHeaderMap(headers);
    if (!hm.char || excludeSet.size === 0) return rows;
    return rows.filter((o) => {
      const c = String(o[hm.char] ?? "").trim();
      const firstChar = c ? [...c][0] : "";
      return firstChar && !excludeSet.has(firstChar);
    });
  }

  /** 嘗試載入主要資料（僅 data.csv） */
  async function autoLoadPrimaryData() {
    try {
      // 查詢字串避免 CDN／瀏覽器沿用舊版 data.csv（GitHub Pages 常設 max-age）
      const path = `./data.csv?_=${Date.now()}`;
      const res = await fetch(path, { cache: "reload" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const { headers, rows } = parseCSV(text);
      if (!headers.length) throw new Error("empty headers");
      const filtered = filterRowsByExclude(rows, headers);
      rawRows = filtered;
      entries = mapEntries(filtered, headers);
      fileName = "data.csv";
      // 更新 UI 狀態
      els.countTotal.textContent = String(entries.length);
      updateStats();
      els.startBtn.disabled = entries.length === 0;
      console.info(
        `[autoLoad] 已載入主要資料：${path}（${entries.length} 筆）`
      );
    } catch (err) {
      console.error("[autoLoad] data.csv 載入失敗，請確認檔案是否存在。", err);
    }
  }

  /** CSV 解析（RFC 4180，支援多行、引號、雙引號跳脫） */
  function parseCSV(text) {
    const rows = [];
    const row = [];
    let i = 0;
    let cur = "";
    let inQuotes = false;

    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          const next = text[i + 1];
          if (next === '"') {
            // 轉義雙引號
            cur += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i += 1;
            continue;
          }
        } else {
          cur += ch;
          i += 1;
          continue;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i += 1;
          continue;
        }
        if (ch === ",") {
          row.push(cur);
          cur = "";
          i += 1;
          continue;
        }
        if (ch === "\n") {
          row.push(cur);
          rows.push(row.slice());
          row.length = 0;
          cur = "";
          i += 1;
          continue;
        }
        if (ch === "\r") {
          // 處理 CRLF
          const next = text[i + 1];
          if (next === "\n") {
            row.push(cur);
            rows.push(row.slice());
            row.length = 0;
            cur = "";
            i += 2;
            continue;
          } else {
            // 少見邊界：單獨 CR 當作換行
            row.push(cur);
            rows.push(row.slice());
            row.length = 0;
            cur = "";
            i += 1;
            continue;
          }
        }
        // 一般字元
        cur += ch;
        i += 1;
      }
    }
    // 最後一格
    if (cur.length > 0 || inQuotes || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    if (rows.length === 0) return { headers: [], rows: [] };
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const objects = dataRows.map((r) => {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = r[j] ?? "";
      }
      return obj;
    });
    return { headers, rows: objects };
  }

  /** 嘗試以常見中文欄位名稱建立映射 */
  function buildHeaderMap(headers) {
    // 來自你的 CSV：序號, 漢字, Unicode, 字集, ..., 分類, 附註
    const map = {};
    const norm = (s) => String(s || "").trim();
    headers.forEach((h) => {
      const n = norm(h);
      if (!map.id && (n === "序號" || n === "編號" || n.toLowerCase() === "id"))
        map.id = h;
      if (!map.char && (n === "漢字" || n === "字" || n === "字符"))
        map.char = h;
      if (!map.unicode && (n === "Unicode" || n.toLowerCase() === "unicode"))
        map.unicode = h;
      if (!map.set && (n === "字集" || n === "來源" || n === "表")) map.set = h;
      if (!map.category && (n === "分類" || n === "類別")) map.category = h;
      if (
        !map.note &&
        (n === "附註" || n === "備註" || n === "說明" || n === "備注")
      )
        map.note = h;
    });
    return map;
  }

  /** 載入 4808.csv，建立排除字集合（只採用每行第一個非空白字元） */
  async function loadExcludeList() {
    try {
      const res = await fetch("./4808.csv", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      const set = new Set();
      for (const raw of lines) {
        const line = (raw || "").trim();
        if (!line) continue;
        const firstChar = [...line][0]; // 正確切分首個 code point
        if (firstChar) set.add(firstChar);
      }
      excludeSet = set;
      console.info(`[4808.csv] 排除清單載入完成：${excludeSet.size} 字`);
    } catch (err) {
      console.warn("[4808.csv] 載入失敗，將不套用排除清單。", err);
      excludeSet = new Set();
    }
  }

  /** 將原始物件列映射為顯示用 entries */
  function mapEntries(objects, headers) {
    headerMap = buildHeaderMap(headers);
    return objects.map((o) => ({
      id: String(o[headerMap.id] ?? ""),
      char: String(o[headerMap.char] ?? ""),
      unicode: String(o[headerMap.unicode] ?? ""),
      set: String(o[headerMap.set] ?? ""),
      category: String(o[headerMap.category] ?? ""),
      note: String(o[headerMap.note] ?? ""),
      raw: o,
    }));
  }

  function getCounts() {
    const decisions = loadDecisions();
    let keep = 0,
      drop = 0,
      skip = 0;
    for (const e of entries) {
      const d = decisions[e.id];
      const action = typeof d === "string" ? d : d && d.action;
      if (action === "keep") keep++;
      else if (action === "drop") drop++;
      else if (action === "skip") skip++;
    }
    return { keep, drop, skip };
  }

  /** 顯示當前項目 */
  function renderCurrent(forceShow = false) {
    if (!entries.length) return;
    const total = entries.length;
    const decisions = loadDecisions();
    els.indexTotal.textContent = String(total);

    // 找到第一個未決策項（若 idx 已決策，往後找）
    idx = Math.max(0, Math.min(idx, total - 1));
    if (!forceShow) {
      for (let i = 0; i < total; i++) {
        const j = (idx + i) % total;
        const e = entries[j];
        if (!decisions[e.id]) {
          idx = j;
          break;
        }
        if (i === total - 1) {
          // 全部完成
          showFinished();
          return;
        }
      }
    } else {
      // 強制顯示模式：確保 idx 在範圍內即可
      idx = Math.max(0, Math.min(idx, total - 1));
    }
    const entry = entries[idx];
    els.indexNow.textContent = String(idx + 1);
    els.seqDisplay.textContent = entry.id ? `序號 ${entry.id}` : "";
    // 顯示漢字，沒有資料時顯示「-」並添加灰色樣式
    const char = entry.char || "";
    els.charDisplay.textContent = char || "-";
    if (!char) {
      els.charDisplay.classList.add("empty");
    } else {
      els.charDisplay.classList.remove("empty");
    }
    // Unicode 顯示
    const unicode = entry.unicode || "";
    els.unicodeDisplay.textContent = unicode ? `U+${unicode}` : "-";
    if (!unicode) {
      els.unicodeDisplay.classList.add("empty");
    } else {
      els.unicodeDisplay.classList.remove("empty");
    }
    // 其他欄位
    const set = entry.set || "";
    els.fieldSet.textContent = set || "-";
    if (!set) {
      els.fieldSet.classList.add("empty");
    } else {
      els.fieldSet.classList.remove("empty");
    }
    const category = entry.category || "";
    els.fieldCategory.textContent = category || "-";
    if (!category) {
      els.fieldCategory.classList.add("empty");
    } else {
      els.fieldCategory.classList.remove("empty");
    }
    const entryNote = entry.note || "";
    els.fieldNote.textContent = entryNote || "-";
    if (!entryNote) {
      els.fieldNote.classList.add("empty");
    } else {
      els.fieldNote.classList.remove("empty");
    }
    // 帶入既有筆記
    const d = decisions[entry.id];
    const userNoteValue = typeof d === "object" && d ? d.note || "" : "";
    if (els.userNote) els.userNote.value = userNoteValue;
    // 重置複製連結文字
    if (els.copyCharBtn) {
      els.copyCharBtn.textContent = "複製此字";
    }
    els.finishBanner.classList.add("hidden");
  }

  function showFinished() {
    els.finishBanner.classList.remove("hidden");
    els.indexNow.textContent = String(entries.length);
  }

  /** 依輸入字串取第一個 code point 作比較用 */
  function normalizeFirstChar(text) {
    const t = String(text || "").trim();
    if (!t) return "";
    const first = [...t][0];
    return first || "";
  }
  /** 尋找第一個首字等於指定漢字的索引（找不到回 -1） */
  function findIndexByFirstChar(ch) {
    const target = normalizeFirstChar(ch);
    if (!target) return -1;
    for (let i = 0; i < entries.length; i++) {
      const c = normalizeFirstChar(entries[i].char);
      if (c === target) return i;
    }
    return -1;
  }
  /** 從指定起點尋找下一個未決策的索引，找不到回 -1 */
  function findNextUndecidedIndexFrom(startIdx) {
    const total = entries.length;
    if (!total) return -1;
    const decisions = loadDecisions();
    for (let i = 0; i < total; i++) {
      const j = (startIdx + i) % total;
      const e = entries[j];
      if (!decisions[e.id]) return j;
    }
    return -1;
  }

  /** 更新統計與進度條 */
  function updateStats() {
    const { keep, drop, skip } = getCounts();
    const total = entries.length;
    els.countTotal.textContent = String(total);
    els.countKeep.textContent = String(keep);
    els.countDrop.textContent = String(drop);
    els.countSkip.textContent = String(skip);
    const pct = total ? Math.round(((keep + drop + skip) / total) * 100) : 0;
    els.progressFill.style.width = `${pct}%`;
    // 匯出按鈕狀態
    els.exportBtn.disabled = keep + drop + skip === 0;
  }

  /** 對當前項目做決策，然後前往下一個 */
  function decideCurrent(decision) {
    const entry = entries[idx];
    const decisions = loadDecisions();
    // 讀取使用者筆記，儲存成物件以支援筆記
    const note = els.userNote ? String(els.userNote.value || "") : "";
    decisions[entry.id] = { action: decision, note };
    saveDecisions(decisions);
    pushHistory(entry.id);

    // 移動到下一個未決策
    const total = entries.length;
    let moved = false;
    for (let i = 1; i <= total; i++) {
      const j = (idx + i) % total;
      const e = entries[j];
      if (!decisions[e.id]) {
        idx = j;
        moved = true;
        break;
      }
    }
    if (!moved) {
      // 全數完成
      idx = Math.min(idx + 1, total - 1);
      showFinished();
    }
    // 統計更新與鼓勵訊息
    updateStats();
    const { keep, drop, skip } = getCounts();
    const decided = keep + drop + skip;
    if (decided > 0 && decided % 100 === 0) {
      alert(`完成 ${decided} 字了，你好棒！`);
    }
    renderCurrent();
  }

  /** 上一步：撤銷上一筆決策 */
  function undoLast() {
    const lastId = popHistory();
    if (!lastId) return;
    const decisions = loadDecisions();
    delete decisions[lastId];
    saveDecisions(decisions);
    // 回到該項目
    const pos = entries.findIndex((e) => e.id === lastId);
    if (pos >= 0) idx = pos;
    updateStats();
    renderCurrent();
  }

  /** 匯出結果（原欄位 + 決策） */
  function exportCSV() {
    if (!rawRows.length) return;
    const decisions = loadDecisions();
    // 匯出「漢字、決策、評選者筆記」三欄，保留漢字本體
    const outHeaders = ["漢字", "決策", "評選者筆記"];
    const lines = [];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    lines.push(outHeaders.map(esc).join(","));
    for (const o of rawRows) {
      const id = String(o[headerMap.id] ?? "");
      const d = decisions[id];
      const action = typeof d === "string" ? d : (d && d.action) || "";
      const note = typeof d === "object" && d ? d.note || "" : "";
      // 取得漢字本體：優先使用原 CSV 的「漢字」欄位，否則回退至 entries
      const charField = headerMap.char;
      const charValue =
        (charField ? String(o[charField] ?? "") : "") ||
        (entries.find((e) => e.id === id)?.char ?? "");
      const row = [charValue, action, note];
      lines.push(row.map(esc).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    const base = fileName ? fileName.replace(/\.csv$/i, "") : "review";
    a.download = `${base}-decisions.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  /** 帶動畫的決策函數 */
  function decideWithAnimation(decision) {
    const target = els.card;
    if (!target) {
      decideCurrent(decision);
      return;
    }
    const maxRotateDeg = 10;

    // 先保存當前卡片的 transform 狀態（用於 ghost）
    const currentTransform = getComputedStyle(target).transform;
    const rect = target.getBoundingClientRect();

    // 計算動畫目標位置
    const width = rect.width || 300;
    const height = rect.height || 200;
    let outX = 0,
      outY = 0,
      outRot = 0;

    if (decision === "keep") {
      outX = width * 1.1;
      outRot = maxRotateDeg;
    } else if (decision === "drop") {
      outX = -width * 1.1;
      outRot = -maxRotateDeg;
    } else if (decision === "skip") {
      outY = -height * 1.1;
      outRot = 0;
    }

    // 先決策以立即換下一張（在創建 ghost 之前）
    decideCurrent(decision);

    // 現在創建 ghost 卡片（基於更新後的卡片內容，但使用舊的位置）
    const ghost = target.cloneNode(true);

    // 設置幽靈卡片樣式
    ghost.style.position = "fixed";
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    ghost.style.margin = "0";
    ghost.style.zIndex = "999";
    ghost.style.pointerEvents = "none";
    ghost.style.willChange = "transform";
    // 使用保存的 transform 或當前位置
    ghost.style.transform =
      currentTransform || "translate(0px, 0px) rotate(0deg)";
    ghost.style.transition = "none";
    document.body.appendChild(ghost);

    // 強制重排，確保初始狀態已渲染
    ghost.offsetHeight;

    // 底層卡片歸位（在 ghost 創建後）
    target.style.transition = "";
    target.style.transform = "";

    // 使用雙重 requestAnimationFrame 確保動畫觸發
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ghost.style.transition = "transform 350ms ease";
        if (decision === "skip") {
          ghost.style.transform = `translate(0px, ${outY}px) rotate(0deg)`;
        } else {
          ghost.style.transform = `translate(${outX}px, 0px) rotate(${outRot}deg)`;
        }
        setTimeout(() => {
          if (ghost && ghost.parentNode) {
            ghost.style.willChange = "auto";
            ghost.parentNode.removeChild(ghost);
          }
        }, 360);
      });
    });
  }

  /** 綁定滑動手勢（左右滑動決策） */
  function bindSwipe() {
    const target = els.card;
    if (!target) return;
    // 完全控制卡片上的手勢，避免與頁面滾動衝突
    try {
      // 使用 none 完全控制手勢，避免瀏覽器預設滾動行為
      target.style.touchAction = "none";
      // 讓預覽卡片可以絕對定位在面板內
      if (
        els.reviewPanel &&
        getComputedStyle(els.reviewPanel).position === "static"
      ) {
        els.reviewPanel.style.position = "relative";
      }
      // 確保被滑動的卡片能以 z-index 疊在預覽之上
      if (getComputedStyle(target).position === "static") {
        target.style.position = "relative";
      }
    } catch {}
    let isDragging = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let deltaY = 0;
    let previewEl = null; // 預覽卡片（下一張，80% 濃度）
    const swipeThresholdPx = 80; // 觸發滑動的必要位移（水平）
    const swipeThresholdUpPx = 100; // 觸發上滑的必要位移（垂直，降低以更容易觸發）
    const maxRotateDeg = 10;
    const setTransform = (x, y, rot) => {
      target.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
    };
    const resetTransform = (withAnim = true) => {
      if (withAnim) target.style.transition = "transform 200ms ease";
      setTransform(0, 0, 0);
      if (withAnim) {
        setTimeout(() => {
          target.style.transition = "";
        }, 200);
      }
    };
    function removePreview() {
      if (previewEl && previewEl.parentNode) {
        previewEl.parentNode.removeChild(previewEl);
      }
      previewEl = null;
      target.style.zIndex = "";
    }
    function findNextUndecidedIndex() {
      const total = entries.length;
      if (!total) return -1;
      const decisions = loadDecisions();
      for (let i = 1; i <= total; i++) {
        const j = (idx + i) % total;
        const e = entries[j];
        if (!decisions[e.id]) return j;
      }
      return -1;
    }
    function ensurePreview() {
      if (previewEl) return;
      const nextIdx = findNextUndecidedIndex();
      if (nextIdx < 0) return;
      const next = entries[nextIdx];
      const panel = els.reviewPanel;
      if (!panel) return;
      const panelRect = panel.getBoundingClientRect();
      const cardRect = target.getBoundingClientRect();
      const left = cardRect.left - panelRect.left;
      const top = cardRect.top - panelRect.top;
      // 建立預覽卡片（避免重複 id）
      const el = document.createElement("div");
      el.className = "card";
      el.style.position = "absolute";
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${cardRect.width}px`;
      el.style.height = `${cardRect.height}px`;
      el.style.opacity = "0.8";
      el.style.pointerEvents = "none";
      el.style.zIndex = "1";
      el.style.transform = "none";
      const decisionsPrev = loadDecisions();
      const dPrev = decisionsPrev[next.id];
      const notePreview =
        (typeof dPrev === "object" && dPrev ? dPrev.note || "" : "") || "";
      const nextPos = nextIdx + 1;
      const total = entries.length;
      el.innerHTML = `
        <div class="char-area">
          <div class="seq-row">
            <div class="unicode">${next.id ? `序號 ${next.id}` : ""}</div>
          </div>
          <div class="hanzi">${next.char || "-"}</div>
          <div class="unicode">${next.unicode ? `U+${next.unicode}` : "-"}</div>
        </div>
        <div class="meta-area">
          <div class="meta-grid">
            <div class="meta-item">
              <div class="meta-label">字集</div>
              <div class="meta-value">${next.set || "-"}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">分類</div>
              <div class="meta-value">${next.category || "-"}</div>
            </div>
            <div class="meta-item span-2">
              <div class="meta-label">附註</div>
              <div class="meta-value pre-wrap">${next.note || "-"}</div>
            </div>
            <div class="meta-item span-2">
              <div class="meta-label">評選者筆記</div>
              <div class="meta-value">
                <textarea rows="2" placeholder="請留言去留理由🥹" disabled>${notePreview}</textarea>
              </div>
            </div>
          </div>
        </div>
      `;
      panel.appendChild(el);
      previewEl = el;
      // 確保拖曳中的卡片在上層
      target.style.zIndex = "2";
    }
    const handleCommit = (direction) => {
      // 若有預覽，先移除（底層將立刻換下一張）
      removePreview();

      // 根據方向調用帶動畫的決策函數
      // decideWithAnimation 會自己處理重置和動畫
      if (direction === "right") {
        decideWithAnimation("keep");
      } else if (direction === "left") {
        decideWithAnimation("drop");
      } else if (direction === "up") {
        decideWithAnimation("skip");
      }
    };
    const onPointerDown = (e) => {
      if (isDragging) return;
      // 如果點擊的是按鈕、輸入框或其他可交互元素，不攔截事件
      const tag = e.target?.tagName?.toLowerCase();
      const isInteractive =
        tag === "button" ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "a";
      if (
        isInteractive ||
        e.target.closest("button") ||
        e.target.closest("input") ||
        e.target.closest("textarea")
      ) {
        return;
      }
      // 阻止預設行為，避免頁面滾動
      e.preventDefault();
      pointerId = e.pointerId;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      deltaX = 0;
      deltaY = 0;
      target.style.transition = "";
      // 顯示下一張預覽
      ensurePreview();
      try {
        target.setPointerCapture(pointerId);
      } catch {}
    };
    const onPointerMove = (e) => {
      if (!isDragging || e.pointerId !== pointerId) return;
      // 阻止預設行為，避免頁面滾動
      e.preventDefault();
      deltaX = e.clientX - startX;
      deltaY = e.clientY - startY;
      // 只在水平主導時提供回饋
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        const width = target.offsetWidth || 300;
        const rotate = Math.max(
          -maxRotateDeg,
          Math.min(maxRotateDeg, (deltaX / width) * maxRotateDeg)
        );
        setTransform(deltaX, 0, rotate);
      } else {
        // 垂直主導時提供上/下移動回饋（不旋轉）
        setTransform(0, deltaY, 0);
      }
    };
    const onPointerUpOrCancel = (e) => {
      if (!isDragging || e.pointerId !== pointerId) return;
      isDragging = false;
      try {
        target.releasePointerCapture(pointerId);
      } catch {}
      const movedX = deltaX;
      const movedY = deltaY;
      // 決定是否觸發滑動行為
      if (
        Math.abs(movedX) > Math.abs(movedY) &&
        Math.abs(movedX) >= swipeThresholdPx
      ) {
        // 水平滑動：保留或踢掉
        handleCommit(movedX > 0 ? "right" : "left");
      } else if (
        Math.abs(movedY) > Math.abs(movedX) &&
        movedY <= -swipeThresholdUpPx
      ) {
        // 上滑觸發「猶豫」（降低閾值以更容易觸發）
        handleCommit("up");
      } else {
        resetTransform(true);
        removePreview();
      }
    };
    // 使用 passive: false 以允許阻止預設行為
    target.addEventListener("pointerdown", onPointerDown, { passive: false });
    target.addEventListener("pointermove", onPointerMove, { passive: false });
    target.addEventListener("pointerup", onPointerUpOrCancel, {
      passive: false,
    });
    target.addEventListener("pointercancel", onPointerUpOrCancel, {
      passive: false,
    });
  }

  /** 綁定事件 */
  function bindEvents() {
    els.startBtn.addEventListener("click", () => {
      if (!entries.length) return;
      els.reviewPanel.classList.remove("hidden");
      renderCurrent();
    });
    els.exportBtn.addEventListener("click", exportCSV);
    // 綁定滑動手勢
    bindSwipe();
    if (els.clearBtn) {
      els.clearBtn.addEventListener("click", () => {
        const ok = confirm("確定要清除所有評選紀錄與筆記嗎？此動作無法復原。");
        if (!ok) return;
        localStorage.removeItem(STORAGE_KEYS.decisions);
        localStorage.removeItem(STORAGE_KEYS.history);
        idx = 0;
        if (els.userNote) els.userNote.value = "";
        updateStats();
        renderCurrent();
        alert("已清除所有紀錄。");
      });
    }

    els.btnKeep.addEventListener("click", () => decideWithAnimation("keep"));
    els.btnDrop.addEventListener("click", () => decideWithAnimation("drop"));
    els.btnSkip.addEventListener("click", () => decideWithAnimation("skip"));
    els.btnUndo.addEventListener("click", undoLast);

    // 複製漢字功能
    if (els.copyCharBtn) {
      els.copyCharBtn.addEventListener("click", async (e) => {
        e.preventDefault(); // 阻止連結預設行為
        e.stopPropagation(); // 阻止事件冒泡，避免觸發滑動手勢
        const char = els.charDisplay.textContent.trim();
        if (!char || char === "-") return;
        try {
          await navigator.clipboard.writeText(char);
          // 文字變為「已複製」
          els.copyCharBtn.textContent = "已複製";
        } catch (err) {
          // 降級方案：使用傳統方法
          const textArea = document.createElement("textarea");
          textArea.value = char;
          textArea.style.position = "fixed";
          textArea.style.opacity = "0";
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand("copy");
            // 文字變為「已複製」
            els.copyCharBtn.textContent = "已複製";
          } catch (fallbackErr) {
            console.error("複製失敗", fallbackErr);
            alert("複製失敗，請手動選取文字");
          }
          document.body.removeChild(textArea);
        }
      });
    }

    // 更多選單：顯示/隱藏
    if (els.menuBtn && els.moreMenu) {
      els.menuBtn.addEventListener("click", () => {
        els.moreMenu.classList.toggle("hidden");
        const isHidden = els.moreMenu.classList.contains("hidden");
        els.moreMenu.setAttribute("aria-hidden", isHidden ? "true" : "false");
        if (!isHidden && els.searchChar) {
          // 聚焦輸入框
          try {
            els.searchChar.focus();
          } catch {}
        }
      });
    }
    // 搜尋跳至該字
    if (els.searchGo && els.searchChar) {
      const doSearch = () => {
        const input = String(els.searchChar.value || "");
        const ch = normalizeFirstChar(input);
        if (!ch) {
          alert("請輸入欲查找的漢字（取第一個字）");
          return;
        }
        const pos = findIndexByFirstChar(ch);
        if (pos >= 0) {
          idx = pos;
          renderCurrent(true); // 強制顯示該字，即使已評選
          els.moreMenu && els.moreMenu.classList.add("hidden");
        } else {
          alert("找不到該字。");
        }
      };
      els.searchGo.addEventListener("click", doSearch);
      els.searchChar.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doSearch();
        }
      });
    }
    // 跳到尚未評選
    if (els.jumpUnreviewed) {
      els.jumpUnreviewed.addEventListener("click", () => {
        const pos = findNextUndecidedIndexFrom(0);
        if (pos >= 0) {
          idx = pos;
          renderCurrent();
          els.moreMenu && els.moreMenu.classList.add("hidden");
        } else {
          alert("太棒了！目前沒有尚未評選的項目。");
        }
      });
    }

    window.addEventListener("keydown", (e) => {
      // 避免影響輸入框
      const tag =
        e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        decideWithAnimation("keep");
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        e.preventDefault();
        decideWithAnimation("drop");
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
        e.preventDefault();
        decideWithAnimation("skip");
      } else if (e.key === "Backspace" || e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoLast();
      }
    });
  }

  // 初始化：先載入排除清單 → 嘗試自動載入主要資料 → 綁定事件與初始統計
  // 確保 review panel 一開始是隱藏的
  els.reviewPanel.classList.add("hidden");
  loadExcludeList()
    .then(autoLoadPrimaryData)
    .finally(() => {
      bindEvents();
      updateStats();
    });
})();
