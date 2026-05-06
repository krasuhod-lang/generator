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

    ns.api = {
        getOffers: getOffers,
        getMagicLink: getMagicLink,
        registerMockOffers: registerMockOffers,
        get useMock() { return USE_MOCK; },
        setUseMock: function (v) { USE_MOCK = !!v; },
    };
})();
