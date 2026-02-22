/* =========================================================
 Wood Stock - 出荷履歴ビュー：出荷状況（出荷先別）サマリ
 - PC：#ws-ship-summary にだけ描画（上に出す挙動は完全禁止）
 - モバイル：ボタン→ダイアログで表示（#ws-ship-summary が無い前提）
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
  const BTN_ID = 'ws-ship-summary-btn';
  const MODAL_ID = 'ws-ship-summary-modal';

  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeDate(v) {
    // kintoneの日付/日時が入っても先頭10文字(YYYY-MM-DD)を採る
    const s = String(v || '').slice(0, 10);
    // 空や不正っぽいのは空に倒す（比較が壊れないように）
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function getMountElStrict() {
    return document.getElementById(MOUNT_ID);
  }

  function aggregate(records) {
    // destごとに {total, lastDate(max), lastQty(sum on lastDate), lastSpeciesSet(on lastDate)}
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
          // より新しい日を見つけたら、その日の集計に“作り直す”
          row.lastDate = date;
          row.lastQty = kg;
          row.lastSpeciesSet = new Set();
          if (sp) row.lastSpeciesSet.add(sp);
        } else if (date === row.lastDate) {
          // 同じ日なら加算
          row.lastQty += kg;
          if (sp) row.lastSpeciesSet.add(sp);
        }
      }
    }

    const rows = Array.from(map.values()).map(x => ({
      dest: x.dest,
      total: x.total,
      lastDate: x.lastDate,
      lastQty: x.lastDate ? x.lastQty : 0, // lastDateが無いなら意味ないので0（表示側で空にする）
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
      const lastQtyCell =
        (r.lastQty === '' || r.lastDate === '') ? '' : String(r.lastQty);

      return `
        <tr class="${isSum ? 'wsSum' : ''}">
          <td>${escapeHtml(r.dest)}</td>
          <td class="wsR">${escapeHtml(r.total)}</td>
          <td>${escapeHtml(r.lastDate || '')}</td>
          <td class="wsR">${escapeHtml(lastQtyCell)}</td>
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

  // ===== モバイル：ヘッダーにボタン → モーダルで表示 =====
  function getHeaderSpace(isMobile) {
    if (isMobile) return kintone.mobile?.app?.getHeaderSpaceElement?.() || null;
    return kintone.app?.getHeaderSpaceElement?.() || null;
  }

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

  function ensureButton(space, onClick) {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '出荷集計';
    btn.style.cssText = [
      'margin:8px 0',
      'padding:10px 12px',
      'border:1px solid #ccc',
      'border-radius:10px',
      'background:#fff',
      'cursor:pointer'
    ].join(';');

    btn.addEventListener('click', onClick);
    space.appendChild(btn);
    return btn;
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

  async function run(event) {
    if (event.viewName !== TARGET_VIEW_NAME) return event;

    const isMobile = String(event.type || '').startsWith('mobile.');

    // ---- PC：#ws-ship-summary 以外に出すのは禁止 ----
    if (!isMobile) {
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

    // ---- モバイル：#ws-ship-summary が無い前提 → ボタン→モーダル ----
    const space = getHeaderSpace(true);
    if (!space) return event;

    // クリック時に“その時点の一覧表示分”を集計してモーダルに出す
    ensureButton(space, () => {
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
