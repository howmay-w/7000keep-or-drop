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
      const path = "./data.csv";
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const { headers, rows } = parseCSV(text);
      if (!headers.length) throw new Error("empty headers");
      const filtered = filterRowsByExclude(rows, headers);
      rawRows = filtered;
      entries = mapEntries(filtered, headers);
      fileName = path.replace(/^.\//, "");
      // 更新 UI 狀態
      els.countTotal.textContent = String(entries.length);
      updateStats();
      els.startBtn.disabled = entries.length === 0;
      console.info(`[autoLoad] 已載入主要資料：${path}（${entries.length} 筆）`);
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
      const action = typeof d === "string" ? d : (d && d.action);
      if (action === "keep") keep++;
      else if (action === "drop") drop++;
      else if (action === "skip") skip++;
    }
    return { keep, drop, skip };
  }

  /** 顯示當前項目 */
  function renderCurrent() {
    if (!entries.length) return;
    const total = entries.length;
    const decisions = loadDecisions();
    els.indexTotal.textContent = String(total);

    // 找到第一個未決策項（若 idx 已決策，往後找）
    idx = Math.max(0, Math.min(idx, total - 1));
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
    const entry = entries[idx];
    els.indexNow.textContent = String(idx + 1);
    els.seqDisplay.textContent = entry.id ? `序號 ${entry.id}` : "";
    els.charDisplay.textContent = entry.char || "—";
    els.unicodeDisplay.textContent = entry.unicode ? `U+${entry.unicode}` : "";
    els.fieldSet.textContent = entry.set || "—";
    els.fieldCategory.textContent = entry.category || "—";
    els.fieldNote.textContent = entry.note || "—";
    // 帶入既有筆記
    const d = decisions[entry.id];
    const note = typeof d === "object" && d ? d.note || "" : "";
    if (els.userNote) els.userNote.value = note;
    els.finishBanner.classList.add("hidden");
  }

  function showFinished() {
    els.finishBanner.classList.remove("hidden");
    els.indexNow.textContent = String(entries.length);
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
    // 依需求：只輸出「決策、評選者筆記」兩欄
    const outHeaders = ["決策", "評選者筆記"];
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
      const row = [action, note];
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

  /** 綁定事件 */
  function bindEvents() {
    els.startBtn.addEventListener("click", () => {
      if (!entries.length) return;
      els.uploadPanel.classList.remove("hidden");
      els.reviewPanel.classList.remove("hidden");
      renderCurrent();
    });
    els.exportBtn.addEventListener("click", exportCSV);
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

    els.btnKeep.addEventListener("click", () => decideCurrent("keep"));
    els.btnDrop.addEventListener("click", () => decideCurrent("drop"));
    els.btnSkip.addEventListener("click", () => decideCurrent("skip"));
    els.btnUndo.addEventListener("click", undoLast);

    window.addEventListener("keydown", (e) => {
      // 避免影響輸入框
      const tag =
        e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        decideCurrent("keep");
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        e.preventDefault();
        decideCurrent("drop");
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
        e.preventDefault();
        decideCurrent("skip");
      } else if (e.key === "Backspace" || e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoLast();
      }
    });
  }

  // 初始化：先載入排除清單 → 嘗試自動載入主要資料 → 綁定事件與初始統計
  loadExcludeList()
    .then(autoLoadPrimaryData)
    .finally(() => {
      bindEvents();
      updateStats();
    });
})();
