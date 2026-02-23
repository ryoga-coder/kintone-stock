/* =========================================================
 Wood Stock - 出荷履歴：出荷状況（出荷先別）サマリ
 - クリックでAPI取得→集計（event.records依存しない）
 - PC/モバイル共通：右下ボタン → モーダル
========================================================= */
alert('ship-summary loaded');

(function () {
  'use strict';

 console.log('[ship-summary] FILE LOADED', location.href);

  // ★ここがスマホで false になってる可能性があるので、まずは“通す”
  // if (!window.WS_ENV?.assertKnownEnv?.()) return;
  // window.WS_ENV.showDevBadge();

  const TARGET_VIEW_NAME = '出荷履歴'; // 一応残す（取れない環境もある）

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

  // ★URLから appId を抜く（/k/181/ など）
  function getAppIdFromUrl() {
    try {
      const m = location.pathname.match(/\/k\/(\d+)\//);
      if (m && m[1]) return Number(m[1]);
    } catch (e) {}
    return null;
  }

  // ★最強 appId 取得（mobile → pc → url）
  function getAppIdSafe() {
    try {
      if (kintone.mobile?.app?.getId) {
        const id = kintone.mobile.app.getId();
        if (id) return id;
      }
    } catch (e) {}

    try {
      if (kintone.app?.getId) {
        const id = kintone.app.getId();
        if (id) return id;
      }
    } catch (e) {}

    return getAppIdFromUrl();
  }

  function isIndexLikeScreen() {
    // “一覧っぽい”ところでだけ出す（厳密には取れないのでゆるめ）
    // detail/edit/create っぽいURLなら出さない
    const href = location.href;
    if (/record=/.test(href)) return false;
    if (/mode=edit/.test(href)) return false;
    if (/mode=new/.test(href)) return false;
    return /\/k\/\d+\//.test(location.pathname);
  }

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

  function render(rows, note) {
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
          <div class="wsShipNote">${escapeHtml(note)}</div>
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

  async function fetchRecentShipRecords(appId) {
    const recordsUrl = kintone.api.url('/k/v1/records.json', true);
    // ★「直近500件の出庫」を取る（フィルタや並び順に依存しない）
    // dateが空のレコードがあるなら order by $id desc の方が安全。必要なら変えて。
    const query = `${FC.operation} = "${SHIP_VALUE}" order by ${FC.date} desc limit 500`;
    const res = await kintone.api(recordsUrl, 'GET', { app: appId, query });
    return res.records || [];
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

  async function openSummary() {
    try {
      showModal('集計中…');

      const appId = getAppIdSafe();
      if (!appId) {
        showModal('<div style="color:red">appId が取得できません</div>');
        return;
      }

      const records = await fetchRecentShipRecords(appId);
      const rows = aggregate(records);
      const note = `直近500件の出庫から集計（${records.length}件）`;
      showModal(render(rows, note));
    } catch (e) {
      console.error(e);
      showModal('<div style="color:red">集計エラー</div>');
    }
  }

  // ★イベントに依存せず「画面にいたら出す」
  function tick() {
    if (!isIndexLikeScreen()) return;
    ensureFab(openSummary);
  }

  // すぐ＋しつこく
  tick();
  setInterval(tick, 800);

  // ついでにイベントでも叩く（取れればラッキー）
  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    // viewName取れるなら一応絞る（取れない環境もある）
    if (event.viewName && event.viewName !== TARGET_VIEW_NAME) return event;
    tick();
    return event;
  });

})();
