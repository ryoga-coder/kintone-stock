/* =========================================================
 Wood Stock - 出荷履歴（出荷先別サマリ）
 本番安定版（デバッグ除去済み）
========================================================= */
(function () {
  'use strict';

  // ===== 設定 =====
  const TARGET_VIEW_NAME = '出荷履歴';

  const FC = {
    shipping_to: 'shipping_to',
    date: 'date',
    kg: 'kg',
    species: 'species',
    operation: 'operation'
  };

  const SHIP_VALUE = '出庫';
  const ROOT_ID = 'ws-ship-root';

  // ===== appId取得 =====
  function getAppIdSafe() {
    try { const id = kintone.mobile?.app?.getId?.(); if (id) return id; } catch (e) {}
    try { const id = kintone.app?.getId?.(); if (id) return id; } catch (e) {}
    const m = location.pathname.match(/\/k\/(\d+)\//);
    return m ? Number(m[1]) : null;
  }

  // ===== mount取得 =====
  function getMountEl() {
    try {
      if (kintone.mobile?.app?.getHeaderSpaceElement)
        return kintone.mobile.app.getHeaderSpaceElement();
    } catch (e) {}

    try {
      if (kintone.app?.getHeaderMenuSpaceElement)
        return kintone.app.getHeaderMenuSpaceElement();
    } catch (e) {}

    return null;
  }

  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
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

  async function fetchAllRecords(appId) {
    const url = kintone.api.url('/k/v1/records.json', true);

    const limit = 500;
    let offset = 0;
    const all = [];

    while (true) {
      const query = `order by $id asc limit ${limit} offset ${offset}`;
      const res = await kintone.api(url, 'GET', { app: appId, query });
      const chunk = res.records || [];
      all.push(...chunk);
      if (chunk.length < limit) break;
      offset += limit;
      if (offset > 50000) break;
    }

    return all;
  }

  function isShipRecord(r) {
    if ((r?.[FC.operation]?.value || '') !== SHIP_VALUE) return false;
    const v = r?.[FC.kg]?.value;
    if (v === '' || v === null || typeof v === 'undefined') return false;
    return Number.isFinite(Number(v));
  }

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

    rows.sort((a, b) => b.total - a.total);

    const totalSum = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    rows.push({ dest: '合計', total: totalSum, lastDate: '', lastQty: '', lastSpecies: '' });

    return rows;
  }

  function render(rows, count) {
    const body = rows.map(r => {
      const isSum = r.dest === '合計';
      return `
        <tr class="${isSum ? 'sum' : ''}">
          <td>${escapeHtml(r.dest)}</td>
          <td class="r">${escapeHtml(r.total)}</td>
          <td>${escapeHtml(r.lastDate || '')}</td>
          <td class="r">${escapeHtml(r.lastQty)}</td>
          <td>${escapeHtml(r.lastSpecies)}</td>
        </tr>
      `;
    }).join('');

    return `
      <style>
        #${ROOT_ID}.ws {background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px}
        #${ROOT_ID} table{width:100%;border-collapse:collapse;font-size:13px}
        #${ROOT_ID} th,#${ROOT_ID} td{border:1px solid #ddd;padding:6px}
        #${ROOT_ID} th{background:#f0f0f0;text-align:left}
        #${ROOT_ID} .r{text-align:right}
        #${ROOT_ID} .sum{background:#f7f9ff;font-weight:700}
        #${ROOT_ID} h3{margin:0 0 8px}
        #${ROOT_ID} .note{font-size:12px;color:#666;margin:6px 0 0}
      </style>

      <div class="ws" id="${ROOT_ID}">
        <h3>出荷状況（出荷先別）</h3>
        <div class="note">※出庫レコードで集計（${count}件）</div>
        <table>
          <tr>
            <th>出荷先</th>
            <th class="r">累計(kg)</th>
            <th>直近の出荷日</th>
            <th class="r">直近の出荷量</th>
            <th>出荷樹種</th>
          </tr>
          ${body}
        </table>
      </div>
    `;
  }

  async function run(event) {
    if (event.viewName !== TARGET_VIEW_NAME) return event;

    const mount = getMountEl();
    if (!mount) return event;
    if (mount.querySelector('#' + ROOT_ID)) return event;

    mount.innerHTML = '集計中…';

    try {
      const appId = getAppIdSafe();
      if (!appId) return event;

      const all = await fetchAllRecords(appId);
      const ship = all.filter(isShipRecord);
      const rows = buildSummary(ship);

      mount.innerHTML = render(rows, ship.length);

    } catch (e) {
      mount.innerHTML = '<div style="color:red">集計エラー</div>';
      console.error(e);
    }

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);

})();
