/* =========================================================
 * core/consent.js — управление согласием пользователя и
 * сохранение прогресса квиза пред-квалификации.
 *
 * Принципы (см. README → «Пред-квалификация»):
 *   1. Никакого скрытого сбора. Куки/localStorage используются
 *      ТОЛЬКО для технически необходимых вещей (session_id) и
 *      ТОЛЬКО для тех данных, которые пользователь сам ввёл в
 *      этой сессии после явного согласия.
 *   2. Согласие версионируется (CONSENT_VERSION). Если текст
 *      согласия изменится — старая запись автоматически считается
 *      недействительной и пользователя спросят повторно.
 *   3. Никогда не читаем куки сторонних доменов. Это и невозможно
 *      из браузера, и было бы нарушением 152-ФЗ.
 *
 * Соответствует:
 *   152-ФЗ «О персональных данных» (явное согласие, цель, срок).
 *   218-ФЗ «О кредитных историях» (запрос КИ — отдельным шагом
 *      и только после явного согласия; реализовано во flow БКИ).
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});

    // Версия текста согласия. Менять при любом изменении формулировок.
    var CONSENT_VERSION = '2026-05-pdn-v1';

    // Ключи в localStorage. Префикс sensei_ — чтобы не пересекаться с чужими.
    var KEYS = {
        cookieBanner: 'sensei_cookie_choice',   // 'all' | 'essential'
        pdn:          'sensei_consent_pdn',     // JSON: {version, ts}
        bki:          'sensei_consent_bki',     // JSON: {version, ts}
        quizProgress: 'sensei_quiz_progress',   // JSON: {category, answers, profile, step, ts}
    };

    // ----- безопасный доступ к localStorage (приватный режим / SSR) -----
    function safeGet(k) {
        try { return window.localStorage.getItem(k); } catch (_e) { return null; }
    }
    function safeSet(k, v) {
        try { window.localStorage.setItem(k, v); return true; } catch (_e) { return false; }
    }
    function safeRemove(k) {
        try { window.localStorage.removeItem(k); } catch (_e) { /* noop */ }
    }

    // ============== Согласия ==============

    function _record(version) {
        return JSON.stringify({ version: version, ts: new Date().toISOString() });
    }

    function _isValid(raw) {
        if (!raw) return false;
        try {
            var obj = JSON.parse(raw);
            return obj && obj.version === CONSENT_VERSION;
        } catch (_e) { return false; }
    }

    /** Сохранить согласие на обработку ПДн (обязательное для квиза). */
    function grantPdn() { safeSet(KEYS.pdn, _record(CONSENT_VERSION)); }
    function revokePdn() { safeRemove(KEYS.pdn); clearQuizProgress(); }
    function hasPdn() { return _isValid(safeGet(KEYS.pdn)); }

    /** Согласие на запрос кредитной истории в БКИ (218-ФЗ).
     *  Опциональное; даётся отдельно, в БКИ-флоу. */
    function grantBki() { safeSet(KEYS.bki, _record(CONSENT_VERSION)); }
    function revokeBki() { safeRemove(KEYS.bki); }
    function hasBki() { return _isValid(safeGet(KEYS.bki)); }

    /** Полный отзыв согласий (для UI «Отозвать согласие»). */
    function revokeAll() {
        revokePdn();
        revokeBki();
        safeRemove(KEYS.cookieBanner);
    }

    // ============== Cookie-баннер ==============

    /** 'all' — пользователь принял UX-куки/storage. 'essential' — только необходимые. */
    function cookieChoice() { return safeGet(KEYS.cookieBanner); }
    function setCookieChoice(v) {
        if (v !== 'all' && v !== 'essential') return;
        safeSet(KEYS.cookieBanner, v);
        if (v === 'essential') {
            // Не сохраняем прогресс квиза, если пользователь выбрал «только необходимые».
            clearQuizProgress();
        }
    }

    // ============== Прогресс квиза ==============

    /** Сохранять прогресс можно только если есть согласие на ПДн
     *  И пользователь не отказался от UX-куков. */
    function _canPersistProgress() {
        if (!hasPdn()) return false;
        var c = cookieChoice();
        // По умолчанию (баннер не дан) — НЕ сохраняем (privacy by default).
        return c === 'all';
    }

    function saveQuizProgress(snapshot) {
        if (!_canPersistProgress()) return;
        try {
            var payload = JSON.stringify({
                category:    snapshot.category,
                answers:     snapshot.answers || {},
                userProfile: snapshot.userProfile || {},
                step:        snapshot.schemaStep || 0,
                version:     CONSENT_VERSION,
                ts:          new Date().toISOString(),
            });
            safeSet(KEYS.quizProgress, payload);
        } catch (_e) { /* noop */ }
    }

    function loadQuizProgress() {
        if (!_canPersistProgress()) return null;
        var raw = safeGet(KEYS.quizProgress);
        if (!raw) return null;
        try {
            var obj = JSON.parse(raw);
            // Если версия согласия сменилась — игнорируем старый прогресс.
            if (!obj || obj.version !== CONSENT_VERSION) {
                safeRemove(KEYS.quizProgress);
                return null;
            }
            return obj;
        } catch (_e) {
            safeRemove(KEYS.quizProgress);
            return null;
        }
    }

    function clearQuizProgress() { safeRemove(KEYS.quizProgress); }

    // ============== Cookie-баннер UI ==============

    function initCookieBanner() {
        var el = document.getElementById('cookie-banner');
        if (!el) return;
        if (cookieChoice()) { el.hidden = true; return; }
        el.hidden = false;
        var btnAll = el.querySelector('[data-cookie="all"]');
        var btnEss = el.querySelector('[data-cookie="essential"]');
        function close() { el.hidden = true; }
        if (btnAll) btnAll.addEventListener('click', function () { setCookieChoice('all'); close(); });
        if (btnEss) btnEss.addEventListener('click', function () { setCookieChoice('essential'); close(); });
    }

    ns.consent = {
        VERSION: CONSENT_VERSION,
        // PDn
        grantPdn: grantPdn,
        revokePdn: revokePdn,
        hasPdn: hasPdn,
        // BKI
        grantBki: grantBki,
        revokeBki: revokeBki,
        hasBki: hasBki,
        // bulk
        revokeAll: revokeAll,
        // cookie banner
        cookieChoice: cookieChoice,
        setCookieChoice: setCookieChoice,
        initCookieBanner: initCookieBanner,
        // quiz progress
        saveQuizProgress: saveQuizProgress,
        loadQuizProgress: loadQuizProgress,
        clearQuizProgress: clearQuizProgress,
    };
})();
