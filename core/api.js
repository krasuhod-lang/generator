/* =========================================================
 * core/api.js — фасад над брокеридж-API.
 *
 * В режиме USE_MOCK=true (Sprint 1/2) работает через
 * локальные mock-генераторы офферов (categories/<x>/offers).
 *
 * В проде (Phase 2 плана) переключается на:
 *   POST /api/v1/offers      — список офферов
 *   POST /api/v1/magic-link  — защищённая ссылка в ЛК
 *   POST /api/v1/chat (SSE)  — токен-стрим LLM-ответа
 *
 * Соответствует ТЗ §3.1 (схема запроса/ответа) и §3.2 (Magic-Link).
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});

    // Глобальный feature-flag. Меняется одной строчкой при подключении бэка.
    var USE_MOCK = true;

    // Реестр mock-генераторов: { [category]: function(params, userProfile) -> Offer[] }
    var mockProviders = {};

    function registerMockOffers(category, fn) {
        mockProviders[category] = fn;
    }

    /**
     * Получить офферы по категории.
     * @returns {Promise<Array<Offer>>}
     */
    function getOffers(category, params, userProfile) {
        if (USE_MOCK) {
            var fn = mockProviders[category];
            if (!fn) return Promise.resolve([]);
            try {
                return Promise.resolve(fn(params || {}, userProfile || {}));
            } catch (e) {
                console.error('[Sensei] mock offers failed', e);
                return Promise.resolve([]);
            }
        }
        // === Прод-вариант (Phase 2) ===
        return fetch('/api/v1/offers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category: category,
                params: params,
                user_profile: userProfile,
                session_id: ns.state.sessionId,
            }),
        })
            .then(function (r) { return r.json(); })
            .then(function (j) { return (j && j.offers) || []; });
    }

    /**
     * Сгенерировать magic-link для конкретного оффера.
     * В mock-режиме — локальная псевдо-ссылка.
     */
    function getMagicLink(offer) {
        if (USE_MOCK) {
            var token = ns.uuid().slice(0, 8);
            var partner = encodeURIComponent(offer.partner_id || offer.partner_name || 'partner');
            return Promise.resolve({
                url: '/secure/lk?token=' + token + '&partner=' + partner +
                     '&offer=' + encodeURIComponent(offer.offer_id || ''),
                token: token,
                expires_in: 900,
            });
        }
        return fetch('/api/v1/magic-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                offer_id: offer.offer_id,
                session_id: ns.state.sessionId,
                amount: offer.amount,
            }),
        }).then(function (r) { return r.json(); });
    }

    /**
     * Запрос кредитной истории в БКИ.
     *
     * Mock. Реальный скоринг — на бэкенде, после согласия (218-ФЗ
     * «О кредитных историях», ст. 6) и идентификации, через API БКИ
     * (НБКИ / ОКБ / Скоринг Бюро).
     *
     * TODO (продакшн): здесь — серверный вызов к НБКИ/ОКБ через бэкенд
     *   POST /api/v1/bki/request
     *   { session_id, consent_id, fio, dob, passport, subject_code }
     *   c обязательным хранением подписанного согласия пользователя
     *   на стороне сервера (не на клиенте!).
     *
     * Поля анкеты (паспорт, ДР, код субъекта КИ) в прототипе
     * НЕ сохраняются нигде — они используются только для имитации
     * вызова и сразу отбрасываются. Это намеренно.
     */
    function getCreditScore(_inquiry) {
        if (USE_MOCK) {
            // Псевдо-случайный, но детерминированный по session_id скор:
            // прототип должен показывать стабильный результат в рамках сессии.
            var sid = (ns.state && ns.state.sessionId) || 'x';
            var seed = 0;
            for (var i = 0; i < sid.length; i++) seed = (seed * 31 + sid.charCodeAt(i)) >>> 0;
            var score = 500 + (seed % 350); // 500..849
            var grade = score >= 750 ? 'A' : score >= 650 ? 'B' : score >= 580 ? 'C' : 'D';
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve({
                        score: score,
                        grade: grade,
                        // Подсветим, что это мок — UI это явно покажет.
                        mock: true,
                        bureau: 'mock-bki',
                        generated_at: new Date().toISOString(),
                    });
                }, 700);
            });
        }
        // === Прод-вариант ===
        // ВАЖНО: запрос идёт ТОЛЬКО на наш бэкенд. Прямые обращения к БКИ
        // из браузера невозможны и небезопасны.
        return fetch('/api/v1/bki/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: ns.state.sessionId,
                // Анкетные поля передаются один раз и не сохраняются на клиенте.
                inquiry: _inquiry,
            }),
        }).then(function (r) { return r.json(); });
    }

    ns.api = {
        getOffers: getOffers,
        getMagicLink: getMagicLink,
        getCreditScore: getCreditScore,
        registerMockOffers: registerMockOffers,
        get useMock() { return USE_MOCK; },
        setUseMock: function (v) { USE_MOCK = !!v; },
    };
})();
