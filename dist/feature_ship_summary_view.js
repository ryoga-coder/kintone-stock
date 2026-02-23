/* =========================================================
 Wood Stock - 出荷履歴（出荷先別サマリ）
 デバッグ強化版：スマホで「描画後に消える」問題の切り分け用
========================================================= */
(function () {
  'use strict';

if (!window.WS_ENV?.assertKnownEnv?.()) return;
  const TARGET_VIEW_NAME = '出荷履歴';

  const ROOT_ID = 'ws-ship-root';
  const BOX_ID = 'ws-ship-box';

  const FC = {
    shipping_to: 'shipping_to',
    date: 'date',
    kg: 'kg',
    species: 'species',
    operation: 'operation',
  };

  const SHIP_VALUE = '出庫';
  const USE_ABS_KG = true;

  function getAppIdFromUrl() {
    try {
      const m = location.pathname.match(/\/k\/(\d+)\//);
      if (m && m[1]) return Number(m[1]);
    } catch (e) {}
    return null;
  }

  function getAppIdSafe() {
    try { const id = kintone.mobile?.app?.getId?.(); if (id) return id; } catch (e) {}
    try { const id = kintone.app?.getId?.(); if (id) return id; } catch (e) {}
    return getAppIdFromUrl();
  }

  // 在庫集計と同等：mount候補を広めに取る（スマホはheaderSpaceが0高さになることがある）
  function getMountEl() {
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

    // 最終手段：body直下（デバッグ用）
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

  function errToText(e) {
    try {
      const obj = (typeof e === 'object' && e !== null) ? e : { message: String(e) };
      const code = obj.code || '';
      const msg = obj.message || obj.error || obj.toString();
      const errs = obj.errors ? JSON.stringify(obj.errors, null, 2) : '';
      return `[${code}] ${msg}\n${errs}`;
    } catch (ex) {
      return String(e);
    }
  }

  async function fetchAllRecords(appId) {
    const recordsUrl = kintone.api.url('/k/v1/records.json', true);

    const limit = 500;
    let offset = 0;
    const out = [];

    async function get(query) {
      return await kintone.api(recordsUrl, 'GET', { app: appId, query });
    }

    while (true) {
      const q = `order by $id asc limit ${limit} offset ${offset}`;
      const res = await get(q);
      const chunk = res.records || [];
      out.push(...chunk);
      if (chunk.length < limit) break;
      offset += limit;
      if (offset > 50000) break;
    }

    console.log('[ship] fetchAllRecords done:', out.length);
    return out;
  }

  function isShipRecord(r) {
    if ((r?.[FC.operation]?.value || '') !== SHIP_VALUE) return false;
    const v = r?.[FC.kg]?.value;
    if (v === '' || v === null || typeof v === 'undefined') return false;
    return Number.isFinite(Number(v));
  }

  function buildShipSummary(records) {
    const map = new Map();

    for (const r of records) {
      const dest = (r?.[FC.shipping_to]?.value ?? '').trim() || '（未設定）';
      const date = normalizeDate(r?.[FC.date]?.value);
      let kg = num(r?.[FC.kg]?.value);
      if (USE_ABS_KG) kg = Math.abs(kg);
      const sp = (r?.[FC.species]?.value ?? '').trim();

      if (!map.has(dest)) {
        map.set(dest, { dest, total: 0, lastDate: '', lastQty: 0, lastSpeciesSet: new Set() });
      }
      const row = map.get(dest);
      row.total += kg;

      if (date) {
        if (!row.lastDate || date > row.lastDate) {
          row.lastDate = date;
          row.lastQty = kg;
          row.lastSpeciesSet = new Set();
          if (sp) row.lastSpeciesSet.add(sp);
        } else if (date === row.lastDate) {
          row.lastQty += kg;
          if (sp) row.lastSpeciesSet.add(sp);
        }
      }
    }

    const rows = Array.from(map.values()).map(x => ({
      dest: x.dest,
      total: x.total,
      lastDate: x.lastDate,
      lastQty: x.lastDate ? x.lastQty : '',
      lastSpecies: x.lastDate ? Array.from(x.lastSpeciesSet).join(',') : '',
    }));

    rows.sort((a, b) => b.total - a.total);
    const sum = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    rows.push({ dest: '合計', total: sum, lastDate: '', lastQty: '', lastSpecies: '' });

    return rows;
  }

  function render(rows, count) {
    const body = rows.map(r => {
      const isSum = (r.dest === '合計');
      return `
        <tr class="${isSum ? 'sum' : ''}">
          <td>${escapeHtml(r.dest)}</td>
          <td class="r">${escapeHtml(r.total)}</td>
          <td>${escapeHtml(r.lastDate || '')}</td>
          <td class="r">${escapeHtml(r.lastQty === '' ? '' : r.lastQty)}</td>
          <td>${escapeHtml(r.lastSpecies || '')}</td>
        </tr>
      `;
    }).join('');

    return `
      <style>
        #${ROOT_ID}.ws{background:#fff;border:3px solid red;border-radius:10px;padding:10px}
        #${ROOT_ID} h3{margin:0 0 8px}
        #${ROOT_ID} .note{font-size:12px;color:#666;margin:6px 0 0}
        #${ROOT_ID} table{width:100%;border-collapse:collapse;font-size:13px}
        #${ROOT_ID} th,#${ROOT_ID} td{border:1px solid #ddd;padding:6px}
        #${ROOT_ID} th{background:#f0f0f0;text-align:left}
        #${ROOT_ID} .r{text-align:right}
        #${ROOT_ID} .sum{background:#f7f9ff;font-weight:700}
      </style>

      <div class="ws" id="${ROOT_ID}">
        <h3>出荷状況（出荷先別）</h3>
        <div class="note">※出庫レコードで集計（${count}件）</div>
        <table>
          <tr>
            <th>出荷先一覧</th>
            <th class="r">累計</th>
            <th>直近の出荷日</th>
            <th class="r">直近の出荷量</th>
            <th>出荷樹種</th>
          </tr>
          ${body}
        </table>
      </div>
    `;
  }

  function ensureBox(mount) {
    let box = mount.querySelector('#' + BOX_ID);
    if (box) return box;

    box = document.createElement('div');
    box.id = BOX_ID;

    // 見えない問題を潰すため、強制的に可視化
    box.style.cssText = 'display:block;';
    mount.appendChild(box);

    return box;
  }

  

  async function run(event) {
    // スマホでviewNameが空になるケース対策
    if (event.viewName && event.viewName !== TARGET_VIEW_NAME) return event;

    const mount = getMountEl();
    const box = ensureBox(mount);



    try {
      const appId = getAppIdSafe();
      const all = await fetchAllRecords(appId);
      const ship = (all || []).filter(isShipRecord);
      const rows = buildShipSummary(ship);

      box.innerHTML = render(rows, ship.length);

          console.warn('[ship] root was removed. rescued to fixed top.');
        }
      }, 300);


    } catch (e) {
      box.innerHTML = `<div style="color:red">集計エラー<br><pre>${escapeHtml(errToText(e))}</pre></div>`;
      console.error(e);
    }

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);

})();
