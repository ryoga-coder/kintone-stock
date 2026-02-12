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
