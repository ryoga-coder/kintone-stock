/* env_base.js : Dev/Prod 判定 + Logger（共通） */
//GITいれたぜ//
(function () {
  'use strict';

  const CONFIG = {
    APP_IDS: {
      DEV: [186],      // ← Dev appId はこれでOK
      PROD: [181], // ← 後で入れる
    },
    LOG_LEVEL: { DEV: 'debug', PROD: 'warn' },
    VERSION: '0.1.0',
  };

  function detectEnv(appId) {
    if (CONFIG.APP_IDS.DEV.includes(appId)) return 'DEV';
    if (CONFIG.APP_IDS.PROD.includes(appId)) return 'PROD';
    return 'UNKNOWN';
  }

  function getAppIdSafe() {
    try { if (kintone.mobile?.app?.getId) { const id = kintone.mobile.app.getId(); if (id) return id; } } catch (e) {}
    try { if (kintone.app?.getId) { const id = kintone.app.getId(); if (id) return id; } } catch (e) {}
    try { const m = location.pathname.match(/\/k\/(\d+)\//); if (m && m[1]) return Number(m[1]); } catch (e) {}
    return null;
  }

  const APP_ID = getAppIdSafe();
  const ENV = detectEnv(APP_ID);
  const LOG_LEVEL = (CONFIG.LOG_LEVEL[ENV] || 'info');

  const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40, silent: 999 };
  function canLog(level) { return LEVEL_ORDER[level] >= LEVEL_ORDER[LOG_LEVEL]; }

  const log = {
    debug: (...a) => { if (canLog('debug')) console.log('[DEBUG]', ...a); },
    info:  (...a) => { if (canLog('info'))  console.log('[INFO]',  ...a); },
    warn:  (...a) => { if (canLog('warn'))  console.warn('[WARN]', ...a); },
    error: (...a) => { if (canLog('error')) console.error('[ERROR]', ...a); },
  };

  function showDevBadge() {
    if (ENV !== 'DEV') return;
    try {
      const el = document.createElement('div');
      el.textContent = `DEV / v${CONFIG.VERSION} / app:${APP_ID}`;
      el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;padding:6px 10px;border-radius:8px;font-size:12px;background:rgba(0,0,0,0.75);color:#fff;';
      document.body.appendChild(el);
    } catch (e) {}
  }

  function assertKnownEnv() {
    if (ENV === 'UNKNOWN') {
      console.warn('[kintone] ENV UNKNOWN: appId not registered', APP_ID);
      return false;
    }
    return true;
  }

  // 共有（グローバルに置く：他ファイルから使えるようにする）
  window.WS_ENV = { CONFIG, APP_ID, ENV, log, assertKnownEnv, showDevBadge, getAppIdSafe };
})();

/* =========================================================
 wood_stock_field_logic.js（全文差し替え版）
 共通ロジック（PC/モバイル両対応）

 - 入庫：qty×unit→kg 自動換算
 - 出庫：kg×unit→qty 自動算出（余り切り捨て）
 - 生産日×樹種→乾燥状態 自動判定（入庫のみ）
 - 出庫UI制御
    * 生産日：空欄＋入力不可
    * 乾燥状態：「乾燥」固定＋入力不可
    * 数量：入力不可
 - submit時チェック
    * 出庫：kg必須
    * 出庫：出荷先必須
    * 出庫：未乾燥出庫は禁止（管理者例外）
 - 入庫/出庫で kg 符号を正規化（出庫はマイナス）
 - sp_form 自動生成（任意・フィールドがあれば）
========================================================= */
(function () {
  'use strict';

    // 追加：ENVの初期化（UNKNOWNなら動かさない）
  if (!window.WS_ENV?.assertKnownEnv?.()) return;
  window.WS_ENV.showDevBadge();
  const log = window.WS_ENV.log;

  // ↓ここから下は今のコードそのまま

  // ====== フィールドコード（必要ならここだけ変える）======
  const FC = {
    operation: 'operation',        // 入庫 / 出庫
    species: 'species',
    unit: 'unit',                  // バラ / 束 / 箱
    qty: 'qty',
    kg: 'kg',
    production_date: 'production_date',
    dry: 'dry__state',
    shipping_to: 'shipping_to',    // 出荷先（ルックアップ）
    sp_form: 'sp_form'             // あれば自動生成（任意）
  };

  // 形態→kg換算係数
  const UNIT_TO_KG = { '箱': 220, '束': 7, 'バラ': 1 };

  // 樹種ごとの乾燥必要日数
  const DRY_DAYS = { 'ナラ': 365, 'スギ': 180 };

  // 管理者例外（未乾燥出庫を許可）
  const ADMIN_USER_CODES = ['yasu-r@hajimerinsan.com'];

  // ====== ユーティリティ ======
  function withMobile(events) {
    const out = [];
    events.forEach(e => { out.push(e); out.push('mobile.' + e); });
    return out;
  }

  function isAdmin() {
    try {
      const u = kintone.getLoginUser();
      return ADMIN_USER_CODES.includes(u.code);
    } catch (e) {
      return false;
    }
  }

  function n(v) {
    const x = Number(v || 0);
    return Number.isFinite(x) ? x : 0;
  }

  function getCoef(record) {
    const unit = record[FC.unit]?.value;
    if (!unit || !UNIT_TO_KG[unit]) return null;
    return UNIT_TO_KG[unit];
  }

  // 入庫：qty→kg
  function recalcKgFromQty(record) {
    const coef = getCoef(record);
    if (!coef) return;
    const qty = n(record[FC.qty]?.value);
    if (record[FC.kg]) record[FC.kg].value = qty * coef;
  }

  // 出庫：kg→qty（余り切り捨て）
  // ※kgは上書きしない（ユーザー入力値を尊重）
  function recalcQtyFromKg(record) {
    const coef = getCoef(record);
    if (!coef) return;
    const kgAbs = Math.abs(n(record[FC.kg]?.value));
    const qty = Math.floor(kgAbs / coef);
    if (record[FC.qty]) record[FC.qty].value = qty;
  }

  // 出庫時のUI/値制御
  function applyOperationRule(record) {
    const op = record[FC.operation]?.value;

    if (op === '出庫') {
      // 生産日：空欄＋入力不可
      if (record[FC.production_date]) {
        record[FC.production_date].value = '';
        record[FC.production_date].disabled = true;
      }
      // 乾燥状態：乾燥固定＋入力不可
      if (record[FC.dry]) {
        record[FC.dry].value = '乾燥';
        record[FC.dry].disabled = true;
      }
      // 数量：入力不可（kgから自動算出）
      if (record[FC.qty]) record[FC.qty].disabled = true;

      // いまのkgが入っていれば qty を即算出
      recalcQtyFromKg(record);
      return;
    }

    // 入庫（または未選択）
    if (record[FC.production_date]) record[FC.production_date].disabled = false;
    if (record[FC.dry]) record[FC.dry].disabled = false;
    if (record[FC.qty]) record[FC.qty].disabled = false;

    // 入庫のときは qty→kg を即反映
    recalcKgFromQty(record);
  }

  // ====== 画面表示時に初期適用 ======
  kintone.events.on(withMobile([
    'app.record.create.show',
    'app.record.edit.show'
  ]), function (event) {
    try {
      applyOperationRule(event.record);
      return event;
    } catch (e) {
      console.error(e);
      return event;
    }
  });

  // ====== 操作種別変更時 ======
  kintone.events.on(withMobile([
    'app.record.create.change.' + FC.operation,
    'app.record.edit.change.' + FC.operation
  ]), function (event) {
    try {
      applyOperationRule(event.record);
      return event;
    } catch (e) {
      console.error(e);
      return event;
    }
  });

  // ====== 入庫：qty/unit変更 → kg再計算 ======
  kintone.events.on(withMobile([
    'app.record.create.change.' + FC.qty,
    'app.record.create.change.' + FC.unit,
    'app.record.edit.change.' + FC.qty,
    'app.record.edit.change.' + FC.unit
  ]), function (event) {
    const r = event.record;
    try {
      const op = r[FC.operation]?.value;
      if (op === '出庫') {
        // 出庫では unit 変更時に kg→qty を再計算
        recalcQtyFromKg(r);
        return event;
      }
      // 入庫では qty→kg
      recalcKgFromQty(r);
      return event;
    } catch (e) {
      console.error(e);
      return event;
    }
  });

  // ====== 出庫：kg変更 → qty自動算出 ======
  kintone.events.on(withMobile([
    'app.record.create.change.' + FC.kg,
    'app.record.edit.change.' + FC.kg
  ]), function (event) {
    const r = event.record;
    try {
      const op = r[FC.operation]?.value;
      if (op !== '出庫') return event;

      recalcQtyFromKg(r);
      return event;
    } catch (e) {
      console.error(e);
      return event;
    }
  });

  // ====== 生産日×樹種→乾燥状態（入庫のみ） ======
  kintone.events.on(withMobile([
    'app.record.create.change.' + FC.production_date,
    'app.record.create.change.' + FC.species,
    'app.record.edit.change.' + FC.production_date,
    'app.record.edit.change.' + FC.species
  ]), function (event) {
    const r = event.record;
    try {
      const op = r[FC.operation]?.value;
      if (op === '出庫') return event; // 出庫は乾燥固定

      const pd = r[FC.production_date]?.value;
      const sp = r[FC.species]?.value;

      if (!pd || !sp || !DRY_DAYS[sp]) return event;

      const base = new Date(pd);
      base.setDate(base.getDate() + DRY_DAYS[sp]);

      const today = new Date();
      if (r[FC.dry]) r[FC.dry].value = (today >= base) ? '乾燥' : '未乾燥';

      return event;
    } catch (e) {
      console.error(e);
      return event;
    }
  });

  // ====== submit 最小チェック + kg符号正規化 + sp_form自動生成（任意）======
  kintone.events.on(withMobile([
    'app.record.create.submit',
    'app.record.edit.submit'
  ]), function (event) {
    const r = event.record;

    try {
      const op = r[FC.operation]?.value;     // 入庫 / 出庫
      const kgVal = n(r[FC.kg]?.value);
      const dry = r[FC.dry]?.value;
      const shipping = r[FC.shipping_to]?.value;

      // 出庫：kg必須
      if (op === '出庫' && kgVal === 0) {
        event.error = '出庫時は kg を入力してください。';
        return event;
      }

      // 出庫：出荷先必須
      if (op === '出庫' && !shipping) {
        event.error = '出庫時は「出荷先」を必ず選択してください。';
        return event;
      }

      // 未乾燥出庫は禁止（管理者例外）
      if (op === '出庫' && dry === '未乾燥' && !isAdmin()) {
        event.error = '未乾燥の薪は出庫できません（管理者のみ例外許可）。';
        return event;
      }

      // 符号正規化（最終保証）
      if (op === '出庫' && r[FC.kg]) r[FC.kg].value = -Math.abs(kgVal);
      if (op === '入庫' && r[FC.kg]) r[FC.kg].value = Math.abs(kgVal);

      // sp_form（任意）
      if (r[FC.sp_form] && r[FC.species] && r[FC.unit]) {
        const sp = r[FC.species].value || '';
        const unit = r[FC.unit].value || '';
        r[FC.sp_form].value = (sp && unit) ? (sp + '_' + unit) : '';
      }

      return event;

    } catch (e) {
      console.error(e);
      event.error = '入力チェック処理でエラーが発生しました。';
      return event;
    }
  });

})();

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


/* ===== 出荷先別サマリ（追加機能） ===== */
(function () {
  'use strict';

  // ▼▼▼ ここだけ自分のアプリに合わせて設定 ▼▼▼
 const SHIP_SUMMARY = {
  ENABLE: true,
  TARGET_VIEW_NAME: null,        // 特定ビューだけにしたいなら '一覧名' を入れる
  FISCAL_YEAR_START_MONTH: 4,
  FIELD: {
    DEST: 'shipping_to',
    DATE: 'date',
    QTY: 'kg',
    SPECIES: 'species',
    IO_TYPE: 'operation',
  },
  SHIP_VALUE: '出庫',            // ★ここは operation の実値に合わせて必要なら変更
  LABEL: {
    TITLE: '出荷状況（出荷先別）',
    DEST: '出荷先一覧',
    FY_TOTAL: '今年度の累計',
    LAST_DATE: '直近の出荷日',
    LAST_QTY: '直近の出荷量',
    LAST_SPECIES: '出荷樹種',
  },
  FETCH_LIMIT: 5000,
};

  // ▲▲▲ 設定ここまで ▲▲▲

  if (!SHIP_SUMMARY.ENABLE) return;

  const INDEX_SHOW = 'app.record.index.show';

  kintone.events.on(INDEX_SHOW, async (event) => {
    try {
      const viewName = event?.viewName || null;
      if (SHIP_SUMMARY.TARGET_VIEW_NAME && viewName !== SHIP_SUMMARY.TARGET_VIEW_NAME) return event;

      // 既存の集計を残したまま、別枠を追加
      const space = getOrCreateSummarySpace();
      space.innerHTML = ''; // 再描画用

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '12px';
      header.style.margin = '8px 0';

      const title = document.createElement('div');
      title.textContent = SHIP_SUMMARY.LABEL.TITLE;
      title.style.fontWeight = '700';
      title.style.fontSize = '14px';

      const reloadBtn = document.createElement('button');
      reloadBtn.textContent = '更新';
      reloadBtn.className = 'kintoneplugin-button-normal';
      reloadBtn.style.padding = '4px 10px';

      const status = document.createElement('div');
      status.style.fontSize = '12px';
      status.style.opacity = '0.75';

      header.appendChild(title);
      header.appendChild(reloadBtn);
      header.appendChild(status);
      space.appendChild(header);

      const tableWrap = document.createElement('div');
      tableWrap.style.border = '1px solid #ddd';
      tableWrap.style.borderRadius = '6px';
      tableWrap.style.overflow = 'auto';
      tableWrap.style.maxHeight = '40vh';
      space.appendChild(tableWrap);

      reloadBtn.onclick = () => run(status, tableWrap);

      await run(status, tableWrap);
    } catch (e) {
      console.error('[SHIP_SUMMARY] failed', e);
    }
    return event;
  });

  function getOrCreateSummarySpace() {
    // 既存集計がどこに刺さってるか不明なので、一覧の上部に安全に差し込む
    const root = document.querySelector('.gaia-argoui-app-index-pager')?.parentElement
      || document.querySelector('.gaia-argoui-app-index') 
      || document.body;

    let box = document.getElementById('ws-ship-summary-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ws-ship-summary-box';
      box.style.margin = '10px 0';
      box.style.padding = '10px';
      box.style.background = '#fff';
      box.style.border = '1px solid #ddd';
      box.style.borderRadius = '8px';
      // 先頭寄りに入れる（邪魔なら insertBefore の場所変えてOK）
      root.insertBefore(box, root.firstChild);
    }
    return box;
  }

  async function run(statusEl, tableWrapEl) {
    statusEl.textContent = '集計中…';
    tableWrapEl.innerHTML = '';

    const appId = (window.WS_ENV?.getAppIdSafe?.() || null);
    if (!appId) {
      statusEl.textContent = 'appId取得失敗（一覧コンテキスト問題）';
      console.error('APP_ID_EMPTY');
      return;
    }

    const { start, end } = getFiscalRange(new Date(), SHIP_SUMMARY.FISCAL_YEAR_START_MONTH);
    const startStr = toYMD(start);
    const endStr = toYMD(end);

    const q = buildQuery(startStr, endStr);
    const records = await fetchRecordsAll(appId, q, SHIP_SUMMARY.FETCH_LIMIT);

    const rows = aggregate(records);
    renderTable(rows, tableWrapEl);

    statusEl.textContent = `対象：${startStr}〜${endStr} / ${records.length}件`;
  }

  function buildQuery(startStr, endStr) {
    const F = SHIP_SUMMARY.FIELD;
    const parts = [];

    if (F.IO_TYPE) {
      parts.push(`${F.IO_TYPE} = "${escapeKintoneValue(SHIP_SUMMARY.SHIP_VALUE)}"`);
    }

    // 日付範囲
    parts.push(`${F.DATE} >= "${startStr}"`);
    parts.push(`${F.DATE} <= "${endStr}"`);

    // 並び：日付降順（直近計算が楽）
    return `${parts.join(' and ')} order by ${F.DATE} desc`;
  }

  async function fetchRecordsAll(appId, query, maxTotal) {
    // cursorで取る（失敗したらoffset方式にフォールバック）
    try {
      return await fetchByCursor(appId, query);
    } catch (e) {
      console.warn('[SHIP_SUMMARY] cursor failed -> fallback offset', e);
      return await fetchByOffset(appId, query, maxTotal);
    }
  }

  async function fetchByCursor(appId, query) {
    const F = SHIP_SUMMARY.FIELD;
    const fields = [F.DEST, F.DATE, F.QTY, F.SPECIES].filter(Boolean);

    const createResp = await kintone.api('/k/v1/records/cursor.json', 'POST', {
      app: appId,
      query,
      fields,
      size: 500,
    });

    const cursorId = createResp.id;
    const all = [];
    while (true) {
      const resp = await kintone.api('/k/v1/records/cursor.json', 'GET', { id: cursorId });
      all.push(...resp.records);
      if (!resp.next) break;
    }
    await kintone.api('/k/v1/records/cursor.json', 'DELETE', { id: cursorId });
    return all;
  }

  async function fetchByOffset(appId, query, maxTotal) {
    const F = SHIP_SUMMARY.FIELD;
    const fields = [F.DEST, F.DATE, F.QTY, F.SPECIES].filter(Boolean);

    const all = [];
    const pageSize = 500;
    for (let offset = 0; offset < maxTotal; offset += pageSize) {
      const resp = await kintone.api('/k/v1/records.json', 'GET', {
        app: appId,
        query: `${query} limit ${pageSize} offset ${offset}`,
        fields,
      });
      all.push(...resp.records);
      if (!resp.records || resp.records.length < pageSize) break;
    }
    return all;
  }

  function aggregate(records) {
    const F = SHIP_SUMMARY.FIELD;
    const map = new Map();

    // recordsは日付desc想定
    for (const r of records) {
      const dest = (r[F.DEST]?.value ?? '').trim() || '(未設定)';
      const date = r[F.DATE]?.value || null;
      const qty = num(r[F.QTY]?.value);
      const species = (r[F.SPECIES]?.value ?? '').trim();

      if (!map.has(dest)) {
        map.set(dest, {
          dest,
          fyTotal: 0,
          lastDate: null,
          lastQty: 0,
          lastSpeciesSet: new Set(),
        });
      }
      const row = map.get(dest);

      row.fyTotal += qty;

      // 直近は最初に見た日付（descなので）
      if (!row.lastDate && date) {
        row.lastDate = date;
      }
      // 直近日付と同じなら直近量は合算（同日複数行対応）
      if (row.lastDate && date && normalizeDate(row.lastDate) === normalizeDate(date)) {
        row.lastQty += qty;
        if (species) row.lastSpeciesSet.add(species);
      }
    }

    const rows = Array.from(map.values()).map((x) => ({
      dest: x.dest,
      fyTotal: x.fyTotal,
      lastDate: x.lastDate ? normalizeDate(x.lastDate) : '',
      lastQty: x.lastQty,
      lastSpecies: Array.from(x.lastSpeciesSet).join(','),
    }));

    // 今年度累計の多い順
    rows.sort((a, b) => (b.fyTotal - a.fyTotal));

    // 合計行
    const total = rows.reduce(
      (acc, r) => {
        acc.fyTotal += r.fyTotal;
        acc.lastQty += r.lastQty; // これは「各社の直近量合計」なので、必要なら消してOK
        if (r.lastDate && (!acc.maxLastDate || r.lastDate > acc.maxLastDate)) acc.maxLastDate = r.lastDate;
        return acc;
      },
      { fyTotal: 0, lastQty: 0, maxLastDate: '' }
    );

    rows.push({
      dest: '合計',
      fyTotal: total.fyTotal,
      lastDate: total.maxLastDate,
      lastQty: '',
      lastSpecies: '',
    });

    return rows;
  }

  function renderTable(rows, wrap) {
    const L = SHIP_SUMMARY.LABEL;

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
    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      if (r.dest === '合計') {
        tr.style.fontWeight = '700';
        tr.style.borderTop = '2px solid #ccc';
      }
      const cells = [
        r.dest,
        fmtKg(r.fyTotal),
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

    wrap.appendChild(table);
  }

  // ===== util =====
  function getFiscalRange(now, startMonth) {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const fyYear = (m >= startMonth) ? y : (y - 1);
    const start = new Date(fyYear, startMonth - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end };
  }

  function toYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function normalizeDate(v) {
    // kintoneは date: "YYYY-MM-DD" / datetime: "YYYY-MM-DDTHH:mm:ssZ"
    return String(v).slice(0, 10);
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtKg(v) {
    // 表示はお好みで（整数/小数）
    const n = Math.round(Number(v) * 10) / 10;
    return `${n}`;
  }

  function escapeKintoneValue(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

})();
