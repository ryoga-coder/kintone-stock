/* =========================================================
 * 出荷履歴（出荷先別サマリ） 月/年 切替 + クエリエラー時フォールバック版
 * - 対象ビュー: 出荷履歴
 * - 月/年の選択で、その期間の集計を表示
 * - 期間クエリに失敗したら、全件取得→JSフィルタに自動フォールバック
 * ========================================================= */
(function () {
  'use strict';

  const TARGET_VIEW_NAME = '出荷履歴';
  const MOUNT_ID = 'ws-ship-summary';
  const ROOT_ID = 'ws-ship-root';

  // ★必要ならここだけ直す
  const FC = {
    shipping_to: 'shipping_to',
    date: 'date',         // ←違うならここ
    kg: 'kg',
    species: 'species',
    operation: 'operation'
  };

  const SHIP_VALUE = '出庫';

  const LS_KEY_MODE = 'ws_ship_summary_mode'; // 'month' | 'year'
  const LS_KEY_YM = 'ws_ship_summary_ym';     // YYYY-MM
  const LS_KEY_Y = 'ws_ship_summary_y';       // YYYY

  const MONTH_OPTIONS = 18;
  const YEAR_OPTIONS = 5;

  // ===== appId取得 =====
  function getAppIdSafe() {
    try { const id = kintone.mobile?.app?.getId?.(); if (id) return id; } catch (e) {}
    try { const id = kintone.app?.getId?.(); if (id) return id; } catch (e) {}
    try { const m = location.pathname.match(/\/k\/(\d+)\//); if (m && m[1]) return Number(m[1]); } catch (e) {}
    return null;
  }

  // ===== mount取得（HTML優先）=====
  function getMountEl() {
    const el = document.getElementById(MOUNT_ID);
    if (el) return el;
    try { const m = kintone.mobile?.app?.getHeaderSpaceElement?.(); if (m) return m; } catch (e) {}
    try { const p = kintone.app?.getHeaderMenuSpaceElement?.(); if (p) return p; } catch (e) {}
    try { const p2 = kintone.app?.getHeaderSpaceElement?.(); if (p2) return p2; } catch (e) {}
    return null;
  }

  // ===== util =====
  function num(v) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function yyyymm(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  function yyyy(d) { return `${d.getFullYear()}`; }

  function normalizeDate(v) {
    // Date / DateTime どっちでも先頭10桁を日付として扱う
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function monthRange(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    const s = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
    const e = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
    return { start: s, end: e };
  }

  function yearRange(yStr) {
    const y = Number(yStr);
    const s = `${y}-01-01`;
    const e = `${y}-12-31`;
    return { start: s, end: e };
  }

  function lsGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  // ===== API（offsetで全件回収）=====
  async function fetchRecordsByQuery(appId, query) {
    const url = kintone.api.url('/k/v1/records.json', true);
    const limit = 500;
    let offset = 0;
    const all = [];
    while (true) {
      const res = await kintone.api(url, 'GET', { app: appId, query: `${query} limit ${limit} offset ${offset}` });
      const chunk = res.records || [];
      all.push(...chunk);
      if (chunk.length < limit) break;
      offset += limit;
      if (offset > 50000) break;
    }
    return all;
  }

  async function fetchAllRecords(appId) {
    return fetchRecordsByQuery(appId, 'order by $id asc');
  }

  // 期間クエリ（失敗することがあるので try/catch 前提）
  async function fetchShipByRangeQuery(appId, start, end) {
    // DateTimeでも先頭10桁比較で動くケースが多いが、環境差があるので失敗したらフォールバック
    const q = `${FC.operation} = "${SHIP_VALUE}" and ${FC.date} >= "${start}" and ${FC.date} <= "${end}" order by $id asc`;
    return fetchRecordsByQuery(appId, q);
  }

  function isShipRecord(r) {
    if ((r?.[FC.operation]?.value || '') !== SHIP_VALUE) return false;
    const v = r?.[FC.kg]?.value;
    if (v === '' || v === null || typeof v === 'undefined') return false;
    return Number.isFinite(Number(v));
  }

  function filterByPeriod(records, mode, key) {
    // key: YYYY-MM or YYYY
    return records.filter(r => {
      if (!isShipRecord(r)) return false;
      const d = normalizeDate(r?.[FC.date]?.value);
      if (!d) return false;
      if (mode === 'month') return d.slice(0, 7) === key;
      return d.slice(0, 4) === key;
    });
  }

  // ===== 集計 =====
  function buildSummary(records) {
    const map = new Map();

    for (const r of records) {
      const dest = (r?.[FC.shipping_to]?.value ?? '').trim() || '（未設定）';
      const date = normalizeDate(r?.[FC.date]?.value);
      const kg = Math.abs(num(r?.[FC.kg]?.value));
      const sp = (r?.[FC.species]?.value ?? '').trim();

      if (!map.has(dest)) {
        map.set(dest, { dest, total: 0, lastDate: '', lastQty: 0, speciesSet: new Set() });
      }
      const row = map.get(dest);
      row.total += kg;

      if (date) {
        if (!row.lastDate || date > row.lastDate) {
          row.lastDate = date;
          row.lastQty = kg;
          row.speciesSet = new Set();
          if (sp) row.speciesSet.add(sp);
        } else if (date === row.lastDate) {
          row.lastQty += kg;
          if (sp) row.speciesSet.add(sp);
        }
      }
    }

    const rows = Array.from(map.values()).map(x => ({
      dest: x.dest,
      total: x.total,
      lastDate: x.lastDate,
      lastQty: x.lastDate ? x.lastQty : '',
      lastSpecies: x.lastDate ? Array.from(x.speciesSet).join(',') : ''
    }));

    rows.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    const totalSum = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    rows.push({ dest: '合計', total: totalSum, lastDate: '', lastQty: '', lastSpecies: '' });
    return rows;
  }

  // ===== 描画 =====
  function renderShell(mount) {
    mount.innerHTML = `
      <div id="${ROOT_ID}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Noto Sans JP', sans-serif;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin: 6px 0 10px;">
          <div style="font-weight:700;">出荷状況（出荷先別）</div>

          <div style="display:flex; align-items:center; gap:6px;">
            <span style="opacity:.85;">表示</span>
            <select id="ws-mode" style="padding:4px 8px;">
              <option value="month">月</option>
              <option value="year">年</option>
            </select>
          </div>

          <div id="ws-pick-month" style="display:flex; align-items:center; gap:6px;">
            <span style="opacity:.85;">表示月</span>
            <select id="ws-ym" style="padding:4px 8px;"></select>
          </div>

          <div id="ws-pick-year" style="display:none; align-items:center; gap:6px;">
            <span style="opacity:.85;">表示年</span>
            <select id="ws-y" style="padding:4px 8px;"></select>
          </div>

          <div id="ws-meta" style="opacity:.85; font-size:12px;"></div>
        </div>

        <div id="ws-body">集計中…</div>
      </div>
    `;
  }

  function renderMonthOptions(sel, currentYm) {
    const now = new Date();
    const opts = [];
    for (let i = 0; i < MONTH_OPTIONS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push(yyyymm(d));
    }
    sel.innerHTML = opts.map(ym => `<option value="${ym}" ${ym === currentYm ? 'selected' : ''}>${ym}</option>`).join('');
  }

  function renderYearOptions(sel, currentY) {
    const now = new Date();
    const opts = [];
    for (let i = 0; i < YEAR_OPTIONS; i++) {
      const d = new Date(now.getFullYear() - i, 0, 1);
      opts.push(yyyy(d));
    }
    sel.innerHTML = opts.map(y => `<option value="${y}" ${y === currentY ? 'selected' : ''}>${y}</option>`).join('');
  }

  function renderTable(rows) {
    const bodyRows = rows.map(r => {
      const isSum = r.dest === '合計';
      return `
        <tr style="${isSum ? 'font-weight:700; background:#f6f6f6;' : ''}">
          <td style="padding:6px 8px; border-bottom:1px solid #eee;">${escapeHtml(r.dest)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee; text-align:right;">${escapeHtml((Number(r.total) || 0).toLocaleString())}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee;">${escapeHtml(r.lastDate || '')}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee; text-align:right;">${escapeHtml(r.lastQty === '' ? '' : Number(r.lastQty).toLocaleString())}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee;">${escapeHtml(r.lastSpecies || '')}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="overflow:auto;">
        <table style="border-collapse:collapse; width:100%; min-width:640px;">
          <thead>
            <tr style="background:#fafafa;">
              <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #ddd;">出荷先</th>
              <th style="text-align:right; padding:6px 8px; border-bottom:1px solid #ddd;">累計(kg)</th>
              <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #ddd;">直近の出荷日</th>
              <th style="text-align:right; padding:6px 8px; border-bottom:1px solid #ddd;">直近の出荷量</th>
              <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #ddd;">出荷樹種</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  function showError(mount, e) {
    const body = mount.querySelector('#ws-body');
    const meta = mount.querySelector('#ws-meta');
    if (meta) meta.textContent = 'エラー';
    if (body) body.innerHTML = `<div style="color:#c00;">集計エラー：${escapeHtml(e?.message || String(e))}</div>`;
    console.error(e);
  }

  async function refresh(mount, appId, mode, key) {
    const meta = mount.querySelector('#ws-meta');
    const body = mount.querySelector('#ws-body');
    if (meta) meta.textContent = '取得中…';
    if (body) body.textContent = '集計中…';

    let records = [];
    let used = '';

    // まず期間クエリで取得を試す（速い）
    try {
      const range = (mode === 'month') ? monthRange(key) : yearRange(key);
      records = await fetchShipByRangeQuery(appId, range.start, range.end);
      used = '期間クエリ';
    } catch (e) {
      // ダメなら従来方式にフォールバック（確実）
      const all = await fetchAllRecords(appId);
      records = filterByPeriod(all, mode, key);
      used = '全件→JSフィルタ（フォールバック）';
    }

    // 最終フィルタ（念のため）
    const ship = filterByPeriod(records, mode, key);
    const rows = buildSummary(ship);

    if (meta) meta.textContent = `※${mode === 'month' ? key + ' 月' : key + ' 年'}（${ship.length}件） / ${used}`;
    if (body) body.innerHTML = renderTable(rows);
  }

  async function run(event) {
    if (event.viewName && event.viewName !== TARGET_VIEW_NAME) return event;

    const mount = getMountEl();
    if (!mount) return event;
    if (mount.querySelector && mount.querySelector('#' + ROOT_ID)) return event;

    const appId = getAppIdSafe();
    if (!appId) {
      mount.innerHTML = '<div style="color:#c00;">集計エラー：appId取得失敗</div>';
      return event;
    }

    const now = new Date();
    const mode = lsGet(LS_KEY_MODE, 'month');
    const currentYm = lsGet(LS_KEY_YM, yyyymm(now));
    const currentY = lsGet(LS_KEY_Y, yyyy(now));

    renderShell(mount);

    const selMode = mount.querySelector('#ws-mode');
    const pickMonth = mount.querySelector('#ws-pick-month');
    const pickYear = mount.querySelector('#ws-pick-year');
    const selYm = mount.querySelector('#ws-ym');
    const selY = mount.querySelector('#ws-y');

    if (selMode) selMode.value = mode;

    if (selYm) renderMonthOptions(selYm, currentYm);
    if (selY) renderYearOptions(selY, currentY);

    function applyModeUI(m) {
      if (!pickMonth || !pickYear) return;
      if (m === 'month') { pickMonth.style.display = 'flex'; pickYear.style.display = 'none'; }
      else { pickMonth.style.display = 'none'; pickYear.style.display = 'flex'; }
    }
    applyModeUI(mode);

    // 初回
    try {
      await refresh(mount, appId, mode, mode === 'month' ? (selYm?.value || currentYm) : (selY?.value || currentY));
    } catch (e) {
      showError(mount, e);
    }

    // イベント
    if (selMode) {
      selMode.onchange = async () => {
        const m = selMode.value;
        lsSet(LS_KEY_MODE, m);
        applyModeUI(m);
        const key = (m === 'month') ? (selYm?.value || currentYm) : (selY?.value || currentY);
        try { await refresh(mount, appId, m, key); } catch (e) { showError(mount, e); }
      };
    }

    if (selYm) {
      selYm.onchange = async () => {
        const key = selYm.value;
        lsSet(LS_KEY_YM, key);
        try { await refresh(mount, appId, 'month', key); } catch (e) { showError(mount, e); }
      };
    }

    if (selY) {
      selY.onchange = async () => {
        const key = selY.value;
        lsSet(LS_KEY_Y, key);
        try { await refresh(mount, appId, 'year', key); } catch (e) { showError(mount, e); }
      };
    }

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);
})();
