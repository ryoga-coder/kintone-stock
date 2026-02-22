/* feature_ship_summary_view.js
 * 出荷状況（出荷先別）サマリ
 * - 対象ビュー: 出荷履歴
 * - 集計データ: 一覧に表示されている records（APIなし）
 * - 前提: 出庫レコードは kg がマイナス保存（表示は見やすく絶対値にする）
 */
(function () {
  'use strict';

  // ===== カスタムは基本ここだけ =====
  const CONFIG = {
    TARGET_VIEW_NAME: '出荷履歴',

    FIELD: {
      DEST: 'shipping_to',
      DATE: 'date',
      QTY: 'kg',
      SPECIES: 'species',
      OP: 'operation',
    },

    SHIP_VALUE: '出庫',

    LABEL: {
      TITLE: '出荷状況（出荷先別）',
      DEST: '出荷先一覧',
      FY_TOTAL: '今年度の累計',
      LAST_DATE: '直近の出荷日',
      LAST_QTY: '直近の出荷量',
      LAST_SPECIES: '出荷樹種',
    },

    // true: kgはマイナス保存でも表示はプラス（見やすい）
    USE_ABS_KG: true,

    // 表の最大高さ（スクロール）
    MAX_HEIGHT: '38vh',
  };
  // ===== カスタムここまで =====

  kintone.events.on('app.record.index.show', (event) => {
    try {
      if (!event) return event;
      if (event.viewName !== CONFIG.TARGET_VIEW_NAME) return event;

      const records = Array.isArray(event.records) ? event.records : [];

      // 保険：ビュー側で絞ってる想定だが、JSでも operation=出庫 を担保
      const shipRecords = records.filter((r) => {
        const op = r?.[CONFIG.FIELD.OP]?.value;
        return op === CONFIG.SHIP_VALUE;
      });

      const box = ensureBox();
      box.innerHTML = '';

      // ヘッダー
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'baseline';
      header.style.gap = '12px';
      header.style.margin = '6px 0 10px';

      const title = document.createElement('div');
      title.textContent = CONFIG.LABEL.TITLE;
      title.style.fontWeight = '700';
      title.style.fontSize = '14px';

      const note = document.createElement('div');
      note.textContent = `※この一覧の表示分で集計（${shipRecords.length}件）`;
      note.style.fontSize = '12px';
      note.style.opacity = '0.7';

      header.appendChild(title);
      header.appendChild(note);
      box.appendChild(header);

      const rows = aggregate(shipRecords);
      const tableWrap = document.createElement('div');
      tableWrap.style.border = '1px solid #ddd';
      tableWrap.style.borderRadius = '8px';
      tableWrap.style.overflow = 'auto';
      tableWrap.style.maxHeight = CONFIG.MAX_HEIGHT;
      tableWrap.appendChild(renderTable(rows));
      box.appendChild(tableWrap);
    } catch (e) {
      console.error('[feature_ship_summary_view] failed', e);
    }
    return event;
  });

  function aggregate(records) {
    const F = CONFIG.FIELD;
    const map = new Map();

    // date降順が理想（ビュー側で設定推奨）
    for (const r of records) {
      const dest = (r?.[F.DEST]?.value ?? '').trim() || '(未設定)';
      const dateRaw = r?.[F.DATE]?.value || '';
      const date = normalizeDate(dateRaw);

      let qty = toNumber(r?.[F.QTY]?.value);
      if (CONFIG.USE_ABS_KG) qty = Math.abs(qty);

      const species = (r?.[F.SPECIES]?.value ?? '').trim();

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

      row.total += qty;

      // 直近：最初に見た日付（降順前提）
      if (!row.lastDate && date) row.lastDate = date;

      // 直近日付が同じなら合算（同日複数行対応）
      if (row.lastDate && date && row.lastDate === date) {
        row.lastQty += qty;
        if (species) row.lastSpeciesSet.add(species);
      }
    }

    const rows = Array.from(map.values()).map((x) => ({
      dest: x.dest,
      total: x.total,
      lastDate: x.lastDate,
      lastQty: x.lastQty,
      lastSpecies: Array.from(x.lastSpeciesSet).join(','),
    }));

    // 累計降順
    rows.sort((a, b) => b.total - a.total);

    // 合計行
    const sum = rows.reduce((acc, r) => acc + r.total, 0);
    rows.push({ dest: '合計', total: sum, lastDate: '', lastQty: '', lastSpecies: '' });

    return rows;
  }

  function renderTable(rows) {
    const L = CONFIG.LABEL;
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '12px';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    [L.DEST, L.FY_TOTAL, L.LAST_DATE, L.LAST_QTY, L.LAST_SPECIES].forEach((t) => {
      const th = document.createElement('th');
      th.textContent = t;
      th.style.position = 'sticky';
      th.style.top = '0';
      th.style.background = '#f7f7f7';
      th.style.borderBottom = '1px solid #ddd';
      th.style.padding = '8px';
      th.style.textAlign = 'left';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (r.dest === '合計') {
        tr.style.fontWeight = '700';
        tr.style.borderTop = '2px solid #ccc';
      }
      const cells = [
        r.dest,
        fmtKg(r.total),
        r.lastDate,
        r.lastQty === '' ? '' : fmtKg(r.lastQty),
        r.lastSpecies,
      ];
      cells.forEach((v) => {
        const td = document.createElement('td');
        td.textContent = v;
        td.style.borderBottom = '1px solid #eee';
        td.style.padding = '8px';
        td.style.whiteSpace = 'nowrap';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function ensureBox() {
    // 一覧の上に差し込む（安全）
    const root =
      document.querySelector('.gaia-argoui-app-index-pager')?.parentElement ||
      document.querySelector('.gaia-argoui-app-index') ||
      document.body;

    let box = document.getElementById('ws-feature-ship-summary');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ws-feature-ship-summary';
      box.style.margin = '10px 0';
      box.style.padding = '10px';
      box.style.background = '#fff';
      box.style.border = '1px solid #ddd';
      box.style.borderRadius = '10px';
      root.insertBefore(box, root.firstChild);
    }
    return box;
  }

  function normalizeDate(v) {
    return String(v || '').slice(0, 10);
  }

  function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtKg(v) {
    // 表示は小数1桁に丸め（お好み）
    const n = Math.round(Number(v) * 10) / 10;
    return `${n}`;
  }
})();
