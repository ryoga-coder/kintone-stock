/* =========================================================
 Wood Stock - 出荷履歴（通常一覧ビュー）出荷状況（出荷先別）サマリ
 - PC/モバイル対応
 - 集計は「この一覧の表示分」（event.records）
 - 表は常時表示しない：右下ボタン → モーダル
 - lastDate は最大日付方式（並び順に依存しない）
========================================================= */
(function () {
  'use strict';

  if (!window.WS_ENV?.assertKnownEnv?.()) return;
  window.WS_ENV.showDevBadge();

  // ★ここを「通常一覧で作ったビュー名」に合わせて変更
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

  const FAB_ID = 'ws-ship-summary-fab';
  const MODAL_ID = 'ws-ship-summary-modal';

  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function normalizeDate(v) {
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
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

      // lastDate = 最大日付（並び順に依存しない）
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
        .wsShipWrap{background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px;margin:0}
        .wsShipHead{display:flex;align-items:baseline;gap:12px;margin:2px 0 10px;flex-wrap:wrap}
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

  // ===== モーダル =====
  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,.45)',
      'display:none',
      'z-index:99999'
    ].join(';');

    modal.innerHTML = `
      <div style="
        position:absolute;
        inset: 6vh 4vw;
        background:#fff;
        border-radius:12px;
        box-shadow:0 10px 30px rgba(0,0,0,.25);
        display:flex;
        flex-direction:column;
        overflow:hidden;
      ">
        <div style="
          padding:12px 14px;
          border-bottom:1px solid #e5e5e5;
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
        ">
          <div style="font-weight:700;">出荷状況（出荷先別）</div>
          <button type="button" id="ws-ship-summary-close" style="
            padding:8px 10px;
            border:1px solid #ccc;
            border-radius:10px;
            background:#fff;
            cursor:pointer;
          ">閉じる</button>
        </div>

        <div id="ws-ship-summary-body" style="
          padding:12px 14px;
          overflow:auto;
          -webkit-overflow-scrolling:touch;
        "></div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideModal();
    });

    document.body.appendChild(modal);
    modal.querySelector('#ws-ship-summary-close').addEventListener('click', hideModal);

    return modal;
  }

  function showModal(html) {
    const modal = ensureModal();
    modal.querySelector('#ws-ship-summary-body').innerHTML = html;
    modal.style.display = 'block';
  }

  function hideModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
  }

  // ===== 右下ボタン =====
  function ensureFab(onClick) {
    let btn = document.getElementById(FAB_ID);
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = FAB_ID;
    btn.type = 'button';
    btn.textContent = '出荷集計';
    btn.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:99998',
      'padding:12px 14px',
      'border-radius:999px',
      'border:1px solid #999',
      'background:#fff',
      'box-shadow:0 6px 18px rgba(0,0,0,.18)',
      'font-size:13px',
      'cursor:pointer'
    ].join(';');

    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);
    return btn;
  }

  function removeFab() {
    const btn = document.getElementById(FAB_ID);
    if (btn) btn.remove();
  }

  function buildFromEvent(event) {
    const all = Array.isArray(event.records) ? event.records : [];
    const shipRecords = all.filter(r => (r?.[FC.operation]?.value === SHIP_VALUE));
    const rows = aggregate(shipRecords);
    return { html: render(rows, shipRecords.length) };
  }

  function run(event) {
    if (event.viewName !== TARGET_VIEW_NAME) {
      // 他ビューに移動したらボタン消す（邪魔防止）
      removeFab();
      return event;
    }

    // このビューにいる時だけボタンを保証
    ensureFab(() => {
      try {
        const { html } = buildFromEvent(event);
        showModal(html);
      } catch (e) {
        console.error('[ship-summary] failed', e);
        showModal('<div style="color:red">集計エラー</div>');
      }
    });

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);

})();
