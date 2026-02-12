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
