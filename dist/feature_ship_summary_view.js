/* feature_ship_summary_view.js
 * 出荷状況（出荷先別）サマリ
 * - 対象ビュー: 出荷履歴
 * - 描画先: #ws-ship-summary（一覧カスタマイズHTMLに置く）
 * - PC/モバイル両対応
 */
(function () {
  'use strict';

  const CONFIG = {
    TARGET_VIEW_NAME: '出荷履歴',
    CONTAINER_ID: 'ws-ship-summary',
    FIELD: {
      DEST: 'shipping_to',
      DATE: 'date',
      QTY: 'kg',
      SPECIES: 'species',
      OP: 'operation',
    },
    SHIP_VALUE: '出庫',
    USE_ABS_KG: true,
  };

  const EVENTS = [
    'app.record.index.show',
    'mobile.app.record.index.show',
  ];

  kintone.events.on(EVENTS, (event) => {
    try {
      if (!event) return event;
      if (event.viewName !== CONFIG.TARGET_VIEW_NAME) return event;

      const root = document.getElementById(CONFIG.CONTAINER_ID);
      if (!root) {
        // HTMLを触ってない/反映漏れの場合に気づけるようログ
        console.warn(`[ship-summary] #${CONFIG.CONTAINER_ID} が見つからない。出荷履歴ビューをカスタマイズし、HTMLに div を置いてね。`);
        return event;
      }

      const records = Array.isArray(event.records) ? event.records : [];
      const shipRecords = records.filter(r => r?.[CONFIG.FIELD.OP]?.value === CONFIG.SHIP_VALUE);

      root.innerHTML = '';
      root.appendChild(render(shipRecords));
    } catch (e) {
      console.error('[ship-summary] failed', e);
    }
    return event;
  });

  function render(records) {
    const wrap = document.createElement('div');
    wrap.style.background = '#fff';
    wrap.style.border = '1px solid #ddd';
    wrap.style.borderRadius = '10px';
    wrap.style.padding = '10px';

    const title = document.createElement('div');
    title.textContent = `出荷状況（出荷先別） ※この一覧の表示分で集計（${records.length}件）`;
    title.style.fontWeight = '700';
    title.style.margin = '4px 0 10px';
    wrap.appendChild(title);

    const rows = aggregate(records);
    wrap.appendChild(table(rows));
    return wrap;
  }

  function aggregate(records) {
    const F = CONFIG.FIELD;
    const map = new Map();

    for (const r of records) {
      const dest = (r?.[F.DEST]?.value ?? '').trim() || '(未設定)';
      const date = String(r?.[F.DATE]?.value || '').slice(0, 10);
      let qty = Number(r?.[F.QTY]?.value || 0);
      if (CONFIG.USE_ABS_KG) qty = Math.abs(qty);
      const species = (r?.[F.SPECIES]?.value ?? '').trim();

      if (!map.has(dest)) {
        map.set(dest, { dest, total: 0, lastDate: '', lastQty: 0, lastSpeciesSet: new Set() });
      }
      const row = map.get(dest);
      row.total += qty;

      if (!row.lastDate && date) row.lastDate = date;
      if (row.lastDate && date && row.lastDate === date) {
        row.lastQty += qty;
        if (species) row.lastSpeciesSet.add(species);
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

  function table(rows) {
    const t = document.createElement('table');
    t.style.width = '100%';
    t.style.borderCollapse = 'collapse';
    t.style.fontSize = '12px';

    const head = document.createElement('tr');
    ['出荷先一覧', '今年度の累計', '直近の出荷日', '直近の出荷量', '出荷樹種'].forEach(txt => {
      const th = document.createElement('th');
      th.textContent = txt;
      th.style.textAlign = 'left';
      th.style.padding = '8px';
      th.style.background = '#f7f7f7';
      th.style.borderBottom = '1px solid #ddd';
      head.appendChild(th);
    });
    t.appendChild(document.createElement('thead')).appendChild(head);

    const tb = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      if (r.dest === '合計') {
        tr.style.fontWeight = '700';
        tr.style.borderTop = '2px solid #ccc';
      }
      [r.dest, fmt(r.total), r.lastDate, r.lastQty === '' ? '' : fmt(r.lastQty), r.lastSpecies].forEach(v => {
        const td = document.createElement('td');
        td.textContent = v;
        td.style.padding = '8px';
        td.style.borderBottom = '1px solid #eee';
        td.style.whiteSpace = 'nowrap';
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  function fmt(v) {
    const n = Math.round(Number(v) * 10) / 10;
    return `${n}`;
  }
})();
