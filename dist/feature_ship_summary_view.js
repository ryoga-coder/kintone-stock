/* =========================================================
 * Wood Stock - 出荷履歴（出荷先別サマリ） 月切替対応版
 * - 対象ビュー: 出荷履歴
 * - 表示: 出荷先ごとの累計(kg)、直近の出荷日/量/樹種
 * - 月選択: ヘッダー or ビューHTML(#ws-ship-summary)内にセレクタ表示
 * - 取得: 選択月の範囲だけAPIで取得（高速）
 * ========================================================= */
(function () {
  'use strict';

  const TARGET_VIEW_NAME = '出荷履歴';
  const MOUNT_ID = 'ws-ship-summary'; // ビューHTMLに置く div
  const ROOT_ID = 'ws-ship-root';

  const FC = {
    shipping_to: 'shipping_to',
    date: 'date',
    kg: 'kg',
    species: 'species',
    operation: 'operation'
  };

  const SHIP_VALUE = '出庫';
  const LS_KEY = 'ws_ship_summary_selected_ym'; // localStorage で月を保持
  const MONTH_OPTIONS = 18; // 過去Nヶ月ぶん表示

  // ===== appId取得（PC一覧でgetId取れない対策含む）=====
  function getAppIdSafe() {
    try {
      const id = kintone.mobile?.app?.getId?.();
      if (id) return id;
    } catch (e) {}
    try {
      const id = kintone.app?.getId?.();
      if (id) return id;
    } catch (e) {}
    try {
      const m = location.pathname.match(/\/k\/(\d+)\//);
      if (m && m[1]) return Number(m[1]);
    } catch (e) {}
    return null;
  }

  // ===== mount取得（HTML優先）=====
  function getMountEl() {
    // 1) ビューHTMLに置いた div を最優先
    const el = document.getElementById(MOUNT_ID);
    if (el) return el;

    // 2) フォールバック：ヘッダー
    try {
      const m = kintone.mobile?.app?.getHeaderSpaceElement?.();
      if (m) return m;
    } catch (e) {}
    try {
      const p = kintone.app?.getHeaderMenuSpaceElement?.();
      if (p) return p;
    } catch (e) {}
    try {
      const p2 = kintone.app?.getHeaderSpaceElement?.();
      if (p2) return p2;
    } catch (e) {}
    return null;
  }

  // ===== util =====
  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function yyyymm(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function normalizeDate(v) {
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
    // ym: 'YYYY-MM'
    const [y, m] = String(ym).split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0); // 月末
    const s = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
    const e = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
    return { start: s, end: e };
  }

  function getDefaultYm() {
    const saved = (() => {
      try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; }
    })();
    if (/^\d{4}-\d{2}$/.test(saved)) return saved;
    return yyyymm(new Date());
  }

  function setSavedYm(ym) {
    try { localStorage.setItem(LS_KEY, ym); } catch (e) {}
  }

  // ===== API：選択月の出庫レコードだけ取得（offsetで全件回収）=====
  async function fetchShipRecordsByMonth(appId, ym) {
    const url = kintone.api.url('/k/v1/records.json', true);
    const { start, end } = monthRange(ym);

    const limit = 500;
    let offset = 0;
    const all = [];

    while (true) {
      const query =
        `${FC.operation} = "${SHIP_VALUE}"` +
        ` and ${FC.date} >= "${start}" and ${FC.date} <= "${end}"` +
        ` order by $id asc limit ${limit} offset ${offset}`;

      const res = await kintone.api(url, 'GET', { app: appId, query });
      const chunk = res.records || [];
      all.push(...chunk);

      if (chunk.length < limit) break;
      offset += limit;
      if (offset > 50000) break; // 念のため安全弁
    }

    return all;
  }

  function isShipRecord(r) {
    if ((r?.[FC.operation]?.value || '') !== SHIP_VALUE) return false;
    const v = r?.[FC.kg]?.value;
    if (v === '' || v === null || typeof v === 'undefined') return false;
    return Number.isFinite(Number(v));
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
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin: 6px 0 10px;">
          <div style="font-weight:700;">出荷状況（出荷先別）</div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="opacity:.85;">表示月</span>
            <select id="ws-ship-month" style="padding:4px 8px;"></select>
          </div>
          <div id="ws-ship-meta" style="opacity:.85; font-size:12px;"></div>
        </div>

        <div id="ws-ship-body">集計中…</div>
      </div>
    `;
  }

  function renderMonthOptions(selectEl, currentYm) {
    const now = new Date();
    const opts = [];
    for (let i = 0; i < MONTH_OPTIONS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = yyyymm(d);
      opts.push(ym);
    }

    selectEl.innerHTML = opts
      .map(ym => `<option value="${ym}" ${ym === currentYm ? 'selected' : ''}>${ym}</option>`)
      .join('');
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
    `;
  }

  async function refresh(mount, appId, ym) {
    const metaEl = mount.querySelector('#ws-ship-meta');
    const bodyEl = mount.querySelector('#ws-ship-body');

    if (metaEl) metaEl.textContent = '取得中…';
    if (bodyEl) bodyEl.textContent = '集計中…';

    const recs = await fetchShipRecordsByMonth(appId, ym);
    const ship = recs.filter(isShipRecord); // 念のため
    const rows = buildSummary(ship);

    if (metaEl) metaEl.textContent = `※${ym} の出庫レコードで集計（${ship.length}件）`;
    if (bodyEl) bodyEl.innerHTML = `<div style="overflow:auto;">${renderTable(rows)}</div>`;
  }

  async function run(event) {
    // スマホで viewName が空/undefined のケース許容（現行踏襲）:contentReference[oaicite:2]{index=2}
    if (event.viewName && event.viewName !== TARGET_VIEW_NAME) return event;

    const mount = getMountEl();
    if (!mount) {
      console.warn('[ship-summary] mount not found. view HTMLに #' + MOUNT_ID + ' を置くと安定します。');
      return event;
    }

    // 二重描画防止
    if (mount.querySelector && mount.querySelector('#' + ROOT_ID)) return event;

    const appId = getAppIdSafe();
    if (!appId) {
      mount.innerHTML = '<div>集計エラー（appId取得失敗）</div>';
      return event;
    }

    const ym = getDefaultYm();

    renderShell(mount);

    const sel = mount.querySelector('#ws-ship-month');
    if (sel) {
      renderMonthOptions(sel, ym);

      sel.addEventListener('change', async () => {
        const nextYm = sel.value;
        setSavedYm(nextYm);
        try {
          await refresh(mount, appId, nextYm);
        } catch (e) {
          console.error(e);
          const bodyEl = mount.querySelector('#ws-ship-body');
          if (bodyEl) bodyEl.innerHTML = '<div>集計エラー</div>';
        }
      });
    }

    try {
      await refresh(mount, appId, ym);
    } catch (e) {
      console.error(e);
      const bodyEl = mount.querySelector('#ws-ship-body');
      if (bodyEl) bodyEl.innerHTML = '<div>集計エラー</div>';
    }

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);
})();
