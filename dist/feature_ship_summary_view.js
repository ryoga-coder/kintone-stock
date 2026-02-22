/* =========================================================
 Wood Stock - 出荷履歴ビュー：出荷状況（出荷先別）サマリ
 - PC：#ws-ship-summary にだけ描画（上に出す挙動は完全禁止）
 - モバイル：右下フローティングボタン → モーダル表示（ヘッダーに依存しない）
 - 集計は「この一覧の表示分」（event.records）
 - lastDate は “最大日付” を採用（並び順に依存しない）
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

  // PCカスタムビューHTML側に置いた div id（PCはここ以外には出さない）
  const MOUNT_ID = 'ws-ship-summary';

  // モバイル用：ボタン/モーダルID
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

      // lastDateは最大日付（並び順に依存しない）
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

  function buildHtmlFromEventRecords(event) {
    const all = Array.isArray(event.records) ? event.records : [];
    const shipRecords = all.filter(r => (r?.[FC.operation]?.value === SHIP_VALUE));
    const rows = aggregate(shipRecords);
    return {
      html: render(rows, shipRecords.length),
      shipCount: shipRecords.length
    };
  }

  // ===== モバイル：モーダル =====
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

  // ===== モバイル：右下フローティングボタン =====
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

  async function run(event) {
    const isMobile = String(event.type || '').startsWith('mobile.');

    // ---- PC：ビュー名一致のみ、#ws-ship-summary 以外に出すのは禁止 ----
    if (!isMobile) {
      if (event.viewName !== TARGET_VIEW_NAME) return event;

      const mount = getMountElStrict();
      if (!mount) {
        console.warn(`[ship-summary] #${MOUNT_ID} が見つからない。出荷履歴ビューHTMLに <div id="${MOUNT_ID}"></div> を置いてね。`);
        return event;
      }

      mount.innerHTML = '集計中…';
      try {
        const { html } = buildHtmlFromEventRecords(event);
        mount.innerHTML = html;
      } catch (e) {
        console.error('[ship-summary] failed', e);
        mount.innerHTML = `<div style="color:red">集計エラー</div>`;
      }
      return event;
    }

    // ---- モバイル：ビュー名が一致しないことがあるので、ゆるめに判定 ----
    // 1) まず viewName が取れて一致するならそれを優先
    // 2) 取れない/違う場合でも、一覧表示中にボタンが出るのは許容（致命傷回避）
    const onTarget = (event.viewName === TARGET_VIEW_NAME) || !event.viewName;

    if (!onTarget) return event;

    // FABは1個だけ作る
    ensureFab(() => {
      try {
        const { html } = buildHtmlFromEventRecords(event);
        showModal(html);
      } catch (e) {
        console.error('[ship-summary] mobile modal failed', e);
        showModal(`<div style="color:red">集計エラー</div>`);
      }
    });

    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);

})();
