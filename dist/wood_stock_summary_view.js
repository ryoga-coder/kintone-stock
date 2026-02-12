/* =========================================================
 Wood Stock - 在庫集計ビュー（kg + 数量(kg逆算) 横持ち/切替）
 超安全版：appId取得強化（PC/モバイル対応）
========================================================= */
(function () {
  'use strict';

   if (!window.WS_ENV?.assertKnownEnv?.()) return;
  window.WS_ENV.showDevBadge();
  const log = window.WS_ENV.log;

  const TARGET_VIEW_NAME = '在庫集計（モバイル対応）';

  const FC = {
    species: 'species',
    unit: 'unit',
    dry: 'dry__state',
    kg: 'kg'
  };

  const UNIT_COLS = ['箱', '束', 'バラ'];
  const UNIT_TO_KG = { '箱': 220, '束': 7, 'バラ': 1 };

  const WS_STATE = {
    qtyHtml: { '合計': '', '乾燥': '', '未乾燥': '', '不明': '' }
  };

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

  function getMountEl() {
    const el = document.getElementById('ws-summary');
    if (el) return el;

    try { if (kintone.mobile?.app?.getHeaderSpaceElement) return kintone.mobile.app.getHeaderSpaceElement(); } catch (e) {}
    try { if (kintone.app?.getHeaderMenuSpaceElement) return kintone.app.getHeaderMenuSpaceElement(); } catch (e) {}
    return null;
  }

  function normalizeDry(v) {
    if (v === '乾燥') return '乾燥';
    if (v === '未乾燥') return '未乾燥';
    return '不明';
  }

  function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function hasKg(record) {
    const f = record[FC.kg];
    if (!f) return false;
    const v = f.value;
    if (v === '' || v === null || typeof v === 'undefined') return false;
    return Number.isFinite(Number(v));
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

  /* =========================
   全件取得（records.jsonのみ）
   - fields指定なし
   - queryは  order+$id+offset → offsetのみ → limitのみ
  ========================= */
  async function fetchAllRecords(appId) {
    const recordsUrl = kintone.api.url('/k/v1/records.json', true);

    const limit = 500;
    let offset = 0;
    const out = [];

    async function get(query) {
      // ★ここで app が必須
      return await kintone.api(recordsUrl, 'GET', { app: appId, query });
    }

    async function fetchWithOffsetOrdered() {
      offset = 0; out.length = 0;
      while (true) {
        const q = `order by $id asc limit ${limit} offset ${offset}`;
        const res = await get(q);
        const chunk = res.records || [];
        out.push(...chunk);
        if (chunk.length < limit) break;
        offset += limit;
        if (offset > 50000) break;
      }
      return { mode: 'order+$id+offset', records: out };
    }

    async function fetchWithOffsetNoOrder() {
      offset = 0; out.length = 0;
      while (true) {
        const q = `limit ${limit} offset ${offset}`;
        const res = await get(q);
        const chunk = res.records || [];
        out.push(...chunk);
        if (chunk.length < limit) break;
        offset += limit;
        if (offset > 50000) break;
      }
      return { mode: 'offset-only', records: out };
    }

    async function fetchLimitOnly() {
      const q = `limit ${limit}`;
      const res = await get(q);
      return { mode: 'limit-only(500)', records: (res.records || []) };
    }

    try {
      const r = await fetchWithOffsetOrdered();
      console.log('[fetchAllRecords] using mode:', r.mode);
      return r.records;
    } catch (e1) {
      console.warn('[fetchAllRecords] ordered failed:', errToText(e1));
    }

    try {
      const r = await fetchWithOffsetNoOrder();
      console.log('[fetchAllRecords] using mode:', r.mode);
      return r.records;
    } catch (e2) {
      console.warn('[fetchAllRecords] offset-only failed:', errToText(e2));
    }

    const r = await fetchLimitOnly();
    console.log('[fetchAllRecords] using mode:', r.mode);
    return r.records;
  }

  function buildPivotKg(records) {
    const UNIT_ORDER = ['バラ', '束', '箱'];
    const p = {};

    records.forEach(r => {
      const sp = r[FC.species]?.value || '（未設定）';
      const unit = r[FC.unit]?.value || '（未設定）';
      const dry = normalizeDry(r[FC.dry]?.value);
      const kg = num(r[FC.kg]?.value);

      if (!p[sp]) p[sp] = {};
      if (!p[sp][unit]) p[sp][unit] = { '乾燥': 0, '未乾燥': 0, '不明': 0 };
      p[sp][unit][dry] += kg;
    });

    p.__UNIT_ORDER__ = UNIT_ORDER;
    return p;
  }

  function renderKg(pivot) {
    const UNIT_ORDER = pivot.__UNIT_ORDER__ || ['バラ', '束', '箱'];

    let html = `
      <h3 style="margin:0 0 8px">在庫集計（kg）</h3>
      <table>
        <tr><th>樹種 / 形態</th><th>乾燥</th><th>未乾燥</th><th>不明</th><th>合計</th></tr>
    `;

    let G = { d:0,u:0,x:0,t:0 };

    Object.keys(pivot).filter(k => k !== '__UNIT_ORDER__').forEach(sp => {
      let S = { d:0,u:0,x:0,t:0 };
      html += `<tr class="sum"><td>${sp}</td><td></td><td></td><td></td><td></td></tr>`;

      const units = Object.keys(pivot[sp] || {});
      const ordered = [...UNIT_ORDER.filter(u=>units.includes(u)), ...units.filter(u=>!UNIT_ORDER.includes(u))];

      ordered.forEach(u => {
        const c = pivot[sp][u];
        const d = num(c['乾燥']), un = num(c['未乾燥']), x = num(c['不明']);
        const t = d+un+x;
        S.d+=d;S.u+=un;S.x+=x;S.t+=t;
        html += `<tr><td>└ ${u}</td><td class="r">${d}</td><td class="r">${un}</td><td class="r">${x}</td><td class="r">${t}</td></tr>`;
      });

      html += `<tr class="sum"><td>${sp} 合計</td><td class="r">${S.d}</td><td class="r">${S.u}</td><td class="r">${S.x}</td><td class="r">${S.t}</td></tr>`;
      G.d+=S.d;G.u+=S.u;G.x+=S.x;G.t+=S.t;
    });

    html += `<tr class="sum"><td>総合計</td><td class="r">${G.d}</td><td class="r">${G.u}</td><td class="r">${G.x}</td><td class="r">${G.t}</td></tr>`;
    html += `</table>`;
    return html;
  }

  function buildKgSumByUnitDry(records) {
    const p = {};
    records.forEach(r => {
      const sp = r[FC.species]?.value || '（未設定）';
      const unit = r[FC.unit]?.value || '（未設定）';
      const dry = normalizeDry(r[FC.dry]?.value);
      const kg = num(r[FC.kg]?.value);

      if (!p[sp]) p[sp] = {};
      if (!p[sp][unit]) p[sp][unit] = { '乾燥': 0, '未乾燥': 0, '不明': 0 };
      p[sp][unit][dry] += kg;
    });
    return p;
  }

  function getKgByMode(bucket, mode) {
    const d = num(bucket['乾燥']);
    const u = num(bucket['未乾燥']);
    const x = num(bucket['不明']);
    if (mode === '乾燥') return d;
    if (mode === '未乾燥') return u;
    if (mode === '不明') return x;
    return d + u + x;
  }

  function fmtQty(qty, unit) { return `${qty} ${unit}`; }

  function renderQtyWide(kgSumByUnitDry, mode) {
    let html = `
      <h3 style="margin:0 0 8px">数量（${mode} / kgから逆算）</h3>
      <table>
        <tr><th>樹種</th><th>箱</th><th>束</th><th>バラ</th><th>kg（参考）</th></tr>
    `;

    Object.keys(kgSumByUnitDry).forEach(sp => {
      let rowKgTotal = 0;

      const cells = UNIT_COLS.map(unit => {
        const coef = UNIT_TO_KG[unit];
        const bucket = kgSumByUnitDry[sp][unit] || { '乾燥':0,'未乾燥':0,'不明':0 };
        const kg = getKgByMode(bucket, mode);
        rowKgTotal += kg;

        const qty = Math.trunc(kg / coef);
        const remain = kg - (qty * coef);
        const titleAttr = `title="kg=${kg} / 係数=${coef} / 残りkg=${remain}"`;

        return `<td class="r" ${titleAttr}>${fmtQty(qty, unit)}</td>`;
      });

      html += `<tr><td>${sp}</td>${cells.join('')}<td class="r">${rowKgTotal}</td></tr>`;
    });

    html += `</table>`;
    return html;
  }

  function renderShell(pivotKg) {
    return `
      <style>
        .ws{background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{border:1px solid #ddd;padding:6px}
        th{background:#f0f0f0}
        .r{text-align:right}
        .sum{background:#f7f9ff;font-weight:700}
        details{margin-top:10px}
        summary{cursor:pointer;font-weight:700;user-select:none}
        .note{font-size:12px;color:#666;margin:6px 0 0}
        .btns{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
        .btn{border:1px solid #999;background:#fff;border-radius:999px;padding:6px 10px;font-size:12px}
        .btn.active{border-color:#1a73e8;box-shadow:0 0 0 2px rgba(26,115,232,.15)}
      </style>

      <div class="ws" id="ws-root">
        ${renderKg(pivotKg)}
        <details style="margin-top:12px">
          <summary>数量（箱・束・バラ）を表示（乾燥/未乾燥/不明/合計 切替）</summary>
          <div class="btns">
            <button type="button" class="btn active" data-mode="合計">合計</button>
            <button type="button" class="btn" data-mode="乾燥">乾燥</button>
            <button type="button" class="btn" data-mode="未乾燥">未乾燥</button>
            <button type="button" class="btn" data-mode="不明">不明</button>
          </div>
          <div id="ws-qty-panel"></div>
          <div class="note">
            ※数量は「kg ÷ 係数」を0方向に丸めた整数です（出庫はマイナスになり得ます）。<br>
            ※各セルを押す/PCならホバーで「残りkg」などの詳細が見れます。
          </div>
        </details>
      </div>
    `;
  }

  function bindToggle() {
    const root = document.getElementById('ws-root');
    if (!root) return;
    const panel = root.querySelector('#ws-qty-panel');
    const btns = Array.from(root.querySelectorAll('.btn[data-mode]'));

    function setMode(mode) {
      btns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      panel.innerHTML = WS_STATE.qtyHtml[mode] || '';
    }
    btns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    setMode('合計');
  }

  async function run(event) {
    if (event.viewName !== TARGET_VIEW_NAME) return event;

    const mount = getMountEl();
    if (!mount) return event;
    if (mount.querySelector && mount.querySelector('#ws-root')) return event;

    mount.innerHTML = '集計中…';

    try {
      const appId = getAppIdSafe();
      if (!appId) {
        throw { code: 'APP_ID_EMPTY', message: 'appId が取得できません（URLや画面コンテキストを確認してください）', errors: { app: { messages: ['必須です。'] } } };
      }

      const all = await fetchAllRecords(appId);
      const records = (all || []).filter(hasKg);

      const pivotKg = buildPivotKg(records);
      const kgSumByUnitDry = buildKgSumByUnitDry(records);

      WS_STATE.qtyHtml['合計'] = renderQtyWide(kgSumByUnitDry, '合計');
      WS_STATE.qtyHtml['乾燥'] = renderQtyWide(kgSumByUnitDry, '乾燥');
      WS_STATE.qtyHtml['未乾燥'] = renderQtyWide(kgSumByUnitDry, '未乾燥');
      WS_STATE.qtyHtml['不明'] = renderQtyWide(kgSumByUnitDry, '不明');

      mount.innerHTML = renderShell(pivotKg);
      bindToggle();

    } catch (e) {
      mount.innerHTML = `<div style="color:red">集計エラー<br><pre>${errToText(e)}</pre></div>`;
      console.error(e);
    }
    return event;
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], run);

})();
