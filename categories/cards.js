/* =========================================================
 * categories/cards.js — Кредитные карты (ТЗ §1.4).
 *
 * Шаги: purpose → limit → employment → spendStyle → офферы.
 * Фишка: «Сколько кэшбэка за год» — расчёт по avgCheck.
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;

    var CARD_PARTNERS = [
        { id: 'tinkoff_platinum', name: 'Тинькофф Platinum',  short: 'Т',  color: '#ffdd2d',
          gracePeriod: 120, annualFee: 0,    cashbackBase: 1, cashbackBonus: 5, mile: false },
        { id: 'alfa_100',         name: 'Альфа «100 дней»',   short: 'А',  color: '#ef3124',
          gracePeriod: 100, annualFee: 0,    cashbackBase: 1, cashbackBonus: 10, mile: false },
        { id: 'sber_credit',      name: 'СберКарта Кредитная', short: 'СБ', color: '#1a9f4a',
          gracePeriod: 120, annualFee: 0,    cashbackBase: 1.5, cashbackBonus: 10, mile: false },
        { id: 'tinkoff_allair',   name: 'Tinkoff All Airlines', short: 'TA', color: '#003d6e',
          gracePeriod: 55,  annualFee: 1890, cashbackBase: 1, cashbackBonus: 0, mile: true },
        { id: 'rsb_rassrochka',   name: 'РСБ «Карта рассрочки»', short: 'РБ', color: '#7b2d8e',
          gracePeriod: 240, annualFee: 0,    cashbackBase: 0, cashbackBonus: 0, mile: false },
    ];

    function buildOffers(params) {
        var purpose = params.purpose;
        var limit = params.limit;
        // Фильтруем по цели
        var filtered = CARD_PARTNERS.filter(function (c) {
            if (purpose === 'cashback') return c.cashbackBase > 0;
            if (purpose === 'rassrochka') return c.gracePeriod >= 100;
            if (purpose === 'travel') return c.mile;
            return true;
        });
        if (!filtered.length) filtered = CARD_PARTNERS.slice();

        var avgMonthlySpend = limit * 0.6; // эвристика: тратят ~60% лимита
        return filtered.map(function (c, idx) {
            var avgCashbackPct = (c.cashbackBase + c.cashbackBonus * 0.3); // часть трат в категориях
            var yearlyCashback = c.cashbackBase > 0
                ? Math.round(avgMonthlySpend * 12 * avgCashbackPct / 100)
                : 0;
            return {
                offer_id: 'card-' + c.id,
                category: 'card',
                partner_id: c.id,
                partner_name: c.name,
                partner_short: c.short,
                partner_color: c.color,
                limit: limit,
                grace_period: c.gracePeriod,
                annual_fee: c.annualFee,
                cashback_base: c.cashbackBase,
                cashback_bonus: c.cashbackBonus,
                yearly_cashback: yearlyCashback,
                mile: c.mile,
                approval_probability: Math.max(50, 92 - idx * 5),
                badge: idx === 0 ? 'TOP #1' : null,
            };
        }).slice(0, 4);
    }

    ns.api.registerMockOffers('card', buildOffers);

    ns.cards.register('card', function (o) {
        var card = document.createElement('div');
        card.className = 'offer-card';
        var cashbackLine = o.cashback_base > 0
            ? util.fmtPct(o.cashback_base, 1) + ' на всё, до ' + util.fmtPct(o.cashback_bonus, 0) + ' в категориях'
            : (o.mile ? 'Мили за каждую покупку' : 'Без кэшбэка, рассрочка до ' + o.grace_period + ' дн.');

        card.innerHTML =
            '<div class="offer-card-head">' +
                '<div class="offer-logo" style="background:' + o.partner_color + '">' +
                    util.escapeHtml(o.partner_short) + '</div>' +
                '<div class="offer-name">' + util.escapeHtml(o.partner_name) +
                    (o.badge ? ' <span class="offer-badge">' + util.escapeHtml(o.badge) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="offer-amount">Лимит: ' + util.fmtMoney(o.limit) + '</div>' +
            '<div class="offer-row"><span>Льготный период</span><b>' + o.grace_period + ' дней</b></div>' +
            '<div class="offer-row"><span>Обслуживание</span><b>' +
                (o.annual_fee === 0 ? 'Бесплатно' : util.fmtMoney(o.annual_fee) + ' / год') + '</b></div>' +
            '<div class="offer-row"><span>Кэшбэк</span><span class="offer-rate-badge">' +
                util.escapeHtml(cashbackLine) + '</span></div>' +
            (o.yearly_cashback > 0
                ? '<div class="offer-highlight">💰 За год вернёте ~<b>' +
                  util.fmtMoney(o.yearly_cashback) + '</b> кэшбэка</div>'
                : '') +
            render.probabilityBlock(o.approval_probability) +
            '<button class="btn btn-primary" type="button">Оформить</button>';
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o, { lastStep: 'получите карту с курьером или заберёте в офисе' });
        });
        return card;
    });

    function qr(stepId, items) {
        return items.map(function (it) {
            return { label: it.label, payload: 'answer:' + stepId + ':' + it.value, variant: it.variant };
        });
    }

    var schema = [
        {
            id: 'purpose', type: 'choice',
            prompt: 'Какая основная цель карты?',
            quickReplies: qr('purpose', [
                { label: 'Кэшбэк',          value: 'cashback' },
                { label: 'Рассрочка',       value: 'rassrochka' },
                { label: 'Путешествия (мили)', value: 'travel' },
                { label: 'Накопление',      value: 'savings' },
            ]),
        },
        {
            id: 'limit', type: 'number',
            prompt: 'Какой кредитный лимит вам нужен?',
            quickReplies: qr('limit', [
                { label: '50 000 ₽',  value: '50000' },
                { label: '100 000 ₽', value: '100000' },
                { label: '300 000 ₽', value: '300000' },
                { label: '500 000 ₽', value: '500000' },
            ]),
            parse: function (text) { return ns.nlp.parseAmount(text); },
        },
        {
            id: 'employment', type: 'choice',
            prompt: 'Тип занятости?',
            quickReplies: qr('employment', [
                { label: 'Найм',        value: 'employed' },
                { label: 'ИП',          value: 'ip' },
                { label: 'Самозанятый', value: 'self' },
                { label: 'Студент',     value: 'student' },
            ]),
            applyToProfile: function (v, p) { p.employment = v; },
        },
        {
            id: 'spendStyle', type: 'choice',
            prompt: 'Где чаще платите картой?',
            quickReplies: qr('spendStyle', [
                { label: 'Онлайн',       value: 'online' },
                { label: 'В магазинах',  value: 'offline' },
                { label: 'Смешанно',     value: 'mixed' },
            ]),
        },
    ];

    function onComplete(answers, profile, state) {
        render.senseiSays(
            ['Подбираю карту под ваш профиль трат…',
             'Я уже посчитал, сколько вы вернёте <b>кэшбэком за год</b> 💰'],
            {
                then: function () {
                    ns.api.getOffers('card', answers, profile).then(function (offers) {
                        render.renderOffers('card', offers);
                        render.showAchievement('💳', 'Подобрана карта');
                        render.renderQuickReplies([
                            { label: '🔄 Подобрать заново', payload: 'cat:card' },
                            { label: '⬅ В меню',            payload: 'menu' },
                        ]);
                        state.category = null;
                    });
                },
            }
        );
    }

    ns.flows.register('card', {
        schema: schema,
        onComplete: onComplete,
        intro: ['Подберём <b>кредитную карту</b> под ваш стиль трат и цель.'],
    });
})();
