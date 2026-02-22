/* =========================================================
 Wood Stock - 出荷履歴ビュー：出荷状況（出荷先別）サマリ
 - #ws-ship-summary にだけ描画（上に出す挙動は完全禁止）
 - PC/モバイル対応
 - 集計は「この一覧の表示分」（event.records）
========================================================= */
(function () {
  'use strict';

  if (!window.WS_ENV?.assertKnownEnv?.()) return;
  window.WS_ENV.showDevBadge();

  const TARGET_VIEW_NAME = '出荷履歴';

  const FC = {
    shipping_to: 'shipping_to',
    date: 'date',
    kg: 'kg',
    species: 'species',
    operation: 'operation',
  };

  const SHIP_VALUE = '出庫';
  const USE_ABS_KG = true;

  // HTML側に置いた div id（ここ以外には出さない）
  const MOUNT_ID = 'ws-ship-summary';

  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function normalizeDate(v) {
    return String(v || '').slice(0, 10);
  }

  function getMountElStrict() {
    return document.getElementById(MOUNT_ID);
  }

  function aggregate(records) {
    const map = new Map();

    for (const r of records) {
      const dest = (r?.[FC.shipping_to]?.value ?? '').trim() || '（未設定）';
      const date = normalizeDate(r?.[FC.date]?.value);
      let kg = num(r?.[FC.kg]?.value);
      if (USE_ABS_KG) kg = Math.abs(kg);
      const sp = (r?.[FC.species]?.value ?? '').trim();

      if (!map.has(dest)) {
        map.set(dest, {
          dest,
          total: 0,
          lastDate: '',
          lastQty: 0,
          lastSpeciesSet: new Set(),
        });
      }
      const row = map.get(dest);
      row.total += kg;

      if (!row.lastDate && date) row.lastDate = date;

      if (row.lastDate && date && row.lastDate === date) {
        row.lastQty += kg;
        if (sp) row.lastSpeciesSet.add(sp);
      }
    }

    const rows = Array.from(map.values()).map(x => ({
      dest: x.dest,
      total: x.total,
      lastDate: x.lastDate,
      lastQty: x.lastQty,
      lastSpecies: Array.from(x.lastSpeciesSet).join(','),
    }));

    rows.sort((a, b) => b.total - a.total);

    const sum = rows.reduce((acc, r) => acc + r.total, 0);
    rows.push({ dest: '合計', total: sum, lastDate: '', lastQty: '', lastSpecies: '' });

    return rows;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function render(rows, count) {
    const body = rows.map(r => {
      const isSum = (r.dest === '合計');
      return `
        <tr class="${isSum ? 'wsSum' : ''}">
          <td>${escapeHtml(r.dest)}</td>
          <td class="wsR">${escapeHtml(r.total)}</td>
          <td>${escapeHtml(r.lastDate || '')}</td>
          <td class="wsR">${escapeHtml(r.lastQty === '' ? '' : r.lastQty)}</td>
          <td>${escapeHtml(r.lastSpecies || '')}</td>
        </tr>
      `;
    }).join('');

    return `
      <style>
        .wsShipWrap{background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px;margin:10px 0}
        .wsShipHead{display:flex;align-items:baseline;gap:12px;margin:2px 0 10px}
        .wsShipTitle{font-weight:700;font-size:14px}
        .wsShipNote{font-size:12px;color:#666}
        .wsShipTable{width:100%;border-collapse:collapse;font-size:13px}
        .wsShipTable th,.wsShipTable td{border:1px solid #ddd;padding:6px}
        .wsShipTable th{background:#f0f0f0;text-align:left}
        .wsR{text-align:right}
        .wsSum{background:#f7f9ff;font-weight:700}
      </style>

      <div class="wsShipWrap">
        <div class="wsShipHead">
          <div class="wsShipTitle">出荷状況（出荷先別）</div>
          <div class="wsShipNote">※この一覧の表示分で集計（${count}件）</div>
        </div>

        <table class="wsShipTable">
          <thead>
            <tr>
              <th>出荷先一覧</th>
              <th class="wsR">今年度の累計</th>
              <th>直近の出荷日</th>
              <th class="wsR">直近の出荷量</th>
              <th>出荷樹種</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  async function run(event) {
    if (event.viewName !== TARGET_VIEW_NAME) return event;

    const mount = getMountElStrict();
    if (!mount) {
      // HTMLが未反映なら、上に出さずに「何もしない」
      console.warn(`[ship-summary] #${MOUNT_ID} が見つからない。出荷履歴ビューHTMLに <div id="${MOUNT_ID}"></div> を置いてね。`);
      return event;
    }

    mount.innerHTML = '集計中…';

    try {
      const all = Array.isArray(event.records) ? event.records : [];
      const shipRecords = all.filter(r => (r?.[FC.operation]?.value === SHIP_VALUE));
      const rows = aggregate(shipRecords);
      mount.innerHTML = render(rows, shipRecords.length);
    } catch (e) {
      console.error('[ship-summary] failed', e);
      mount.innerHTML = `<div style="color:red">集計エラー</div>`;
    }

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);

})();
