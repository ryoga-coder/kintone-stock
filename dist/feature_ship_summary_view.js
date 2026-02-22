/* =========================================================
 Wood Stock - 出荷履歴ビュー：出荷状況（出荷先別）サマリ
 - HTML編集なしで動く版（あれば #ws-ship-summary に描画）
 - PC/モバイル対応
 - 集計は「この一覧の表示分」で行う（event.records）
========================================================= */
(function () {
  'use strict';

  if (!window.WS_ENV?.assertKnownEnv?.()) return;
  window.WS_ENV.showDevBadge();
  const log = window.WS_ENV.log;

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

  const BOX_ID = 'ws-ship-summary-box';
  const MOUNT_ID = 'ws-ship-summary'; // HTMLに置けるならここに描画する（今は無くてもOK）

  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function normalizeDate(v) {
    return String(v || '').slice(0, 10);
  }
  function safeText(v) {
    return (v === null || typeof v === 'undefined') ? '' : String(v);
  }

  function removeBoxIfExists() {
    const box = document.getElementById(BOX_ID);
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

 function getMountEl() {
  // HTMLに置いたdivにしか出さない（見つからなければ何も出さない）
  return document.getElementById('ws-ship-summary');
}
    //    モバイル：ヘッダースペースが取れるならそこ（最後の手段）
    try {
      if (kintone.mobile?.app?.getHeaderSpaceElement) {
        const m = kintone.mobile.app.getHeaderSpaceElement();
        if (m) {
          let box = document.getElementById(BOX_ID);
          if (!box) {
            box = document.createElement('div');
            box.id = BOX_ID;
            m.appendChild(box);
          }
          return box;
        }
      }
    } catch (e) {}

    return null;
  }

  function aggregate(records) {
    const map = new Map();

    // date降順の一覧が理想（ビュー設定で date 降順にしておくと直近判定が確実）
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

      // 直近日（最初に遭遇した日付が直近扱い：date降順前提）
      if (!row.lastDate && date) row.lastDate = date;

      // 直近日と同日のものは合算、樹種は集合でまとめる
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

  function render(rows, count) {
    const style = `
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
    `;

    const bodyRows = rows.map(r => {
      const isSum = (r.dest === '合計');
      const trClass = isSum ? 'wsSum' : '';
      const total = safeText(r.total);
      const lastQty = (r.lastQty === '' ? '' : safeText(r.lastQty));
      return `
        <tr class="${trClass}">
          <td>${escapeHtml(r.dest)}</td>
          <td class="wsR">${escapeHtml(total)}</td>
          <td>${escapeHtml(r.lastDate || '')}</td>
          <td class="wsR">${escapeHtml(lastQty)}</td>
          <td>${escapeHtml(r.lastSpecies || '')}</td>
        </tr>
      `;
    }).join('');

    return `
      ${style}
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
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  // 最低限のHTMLエスケープ（表示だけ用）
  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function run(event) {
    // 目的のビュー以外では消す（他ビューで邪魔しない）
    if (event.viewName !== TARGET_VIEW_NAME) {
      removeBoxIfExists();
      return event;
    }

    const mount = getMountEl();
    if (!mount) return event;

    // 二重描画防止（同じ場所で既に描いてるなら更新だけ）
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
