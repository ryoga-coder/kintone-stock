/* =========================================================
 Wood Stock - 出荷履歴ビュー：出荷状況（出荷先別）サマリ
 - 在庫集計と同じ方式：
   1) #ws-ship-summary があればそこだけに描画
   2) 無ければ モバイル headerSpace → PC headerMenuSpace/headerSpace に描画
 - PC/モバイル対応
 - 集計は「この一覧の表示分」（event.records）
 - lastDate は最大日付方式（並び順に依存しない）
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

  // 任意：カスタムビューHTMLに置くならこれ
  const MOUNT_ID = 'ws-ship-summary';

  // ヘッダー等に差し込む時の内部root（重複描画防止）
  const ROOT_ID = 'ws-ship-summary-root';

  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeDate(v) {
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function getMountElLikeStockSummary() {
    // 1) カスタムビューHTMLの mount があるなら最優先
    const el = document.getElementById(MOUNT_ID);
    if (el) return el;

    // 2) 在庫集計と同じ fallback
    try {
      if (kintone.mobile?.app?.getHeaderSpaceElement) {
        const m = kintone.mobile.app.getHeaderSpaceElement();
        if (m) return m;
      }
    } catch (e) {}

    try {
      if (kintone.app?.getHeaderMenuSpaceElement) {
        const p = kintone.app.getHeaderMenuSpaceElement();
        if (p) return p;
      }
    } catch (e) {}

    try {
      if (kintone.app?.getHeaderSpaceElement) {
        const p2 = kintone.app.getHeaderSpaceElement();
        if (p2) return p2;
      }
    } catch (e) {}

    return null;
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

      // lastDate: 最大日付
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
        #${ROOT_ID}.wsShipWrap{background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px;margin:10px 0}
        #${ROOT_ID} .wsShipHead{display:flex;align-items:baseline;gap:12px;margin:2px 0 10px;flex-wrap:wrap}
        #${ROOT_ID} .wsShipTitle{font-weight:700;font-size:14px}
        #${ROOT_ID} .wsShipNote{font-size:12px;color:#666}
        #${ROOT_ID} .wsShipTable{width:100%;border-collapse:collapse;font-size:13px}
        #${ROOT_ID} .wsShipTable th,#${ROOT_ID} .wsShipTable td{border:1px solid #ddd;padding:6px}
        #${ROOT_ID} .wsShipTable th{background:#f0f0f0;text-align:left}
        #${ROOT_ID} .wsR{text-align:right}
        #${ROOT_ID} .wsSum{background:#f7f9ff;font-weight:700}
      </style>

      <div id="${ROOT_ID}" class="wsShipWrap">
        <div class="wsShipHead">
          <div class="wsShipTitle">出荷状況（出荷先別）</div>
          <div class="wsShipNote">※この一覧の表示分で集計（${count}件）</div>
        </div>

        <table class="wsShipTable">
          <thead>
            <tr>
              <th>出荷先一覧</th>
              <th class="wsR">累計</th>
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

  function clearRendered(mount) {
    // header等に差し込んだrootだけ消す（他UIを壊さない）
    try {
      const root = mount?.querySelector?.('#' + ROOT_ID);
      if (root) root.remove();
    } catch (e) {}
  }

  function run(event) {
    // ビュー名が取れないケースもあるので、ここは “一致した時だけ描画” にする
    if (event.viewName !== TARGET_VIEW_NAME) {
      // 他ビューに移動したとき、ヘッダーに残り続けるのが嫌なら消す
      const m = getMountElLikeStockSummary();
      if (m) clearRendered(m);
      return event;
    }

    const mount = getMountElLikeStockSummary();
    if (!mount) return event;

    // 重複描画防止（既にあるなら更新）
    clearRendered(mount);

    const all = Array.isArray(event.records) ? event.records : [];
    const shipRecords = all.filter(r => (r?.[FC.operation]?.value === SHIP_VALUE));
    const rows = aggregate(shipRecords);

    // mount が #ws-ship-summary 自体なら “そこを丸ごと置き換え”
    // header領域なら “追記” でもいいが、ここは一貫して innerHTML追加でなく root挿入にする
    const html = render(rows, shipRecords.length);

    // mountがdivだろうがheaderだろうが、ここでは「rootを追加」する
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const root = wrapper.firstElementChild; // styleタグが先に来るので注意

    // style + root を両方入れたいので、wrapper の子を全部append
    while (wrapper.firstChild) {
      mount.appendChild(wrapper.firstChild);
    }

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);

})();
