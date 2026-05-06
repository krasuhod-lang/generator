/* =========================================================
 * categories/credits.js — потребительские кредиты (ТЗ §1.2).
 *
 * Шаги: amount → termMonths → purpose → income → employment →
 *       currentLoans → overdue → офферы.
 * Партнёры: Сбер, Тинькофф, Альфа, ВТБ, Почта, Хоум.
 *
 * Фишка §1.2: «Калькулятор переплаты» — overlay-сообщение,
 * сравнивающее выбранный оффер с лучшим в каталоге.
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;

    var BANK_PARTNERS = [
        { id: 'sber',    name: 'Сбербанк',     short: 'СБ', color: '#1a9f4a', baseRate: 12.9 },
        { id: 'tinkoff', name: 'Тинькофф',     short: 'Т',  color: '#ffdd2d', baseRate: 14.5 },
        { id: 'alfa',    name: 'Альфа-Банк',   short: 'А',  color: '#ef3124', baseRate: 13.7 },
        { id: 'vtb',     name: 'ВТБ',          short: 'ВТ', color: '#0a2973', baseRate: 12.5 },
        { id: 'pochta',  name: 'Почта Банк',   short: 'ПБ', color: '#0a4ea2', baseRate: 15.9 },
        { id: 'home',    name: 'Хоум Банк',    short: 'ХБ', color: '#e30613', baseRate: 16.8 },
    ];

    function buildOffers(params, profile) {
        var amount = params.amount;
        var termMonths = params.termMonths;

        var baseScore = 80;
        if (params.income && params.income < 30000) baseScore -= 15;
        if (params.income && params.income > 80000) baseScore += 7;
        if (params.employment === 'self' || params.employment === 'ip') baseScore -= 5;
        if (params.employment === 'pensioner') baseScore -= 8;
        if (params.employment === 'none') baseScore -= 30;
        if (params.currentLoans === '3+') baseScore -= 15;
        if (params.overdue === 'yes') baseScore -= 35;

        return BANK_PARTNERS.map(function (b, idx) {
            var rate = b.baseRate +
                (params.overdue === 'yes' ? 4 : 0) +
                (params.employment === 'self' ? 1.5 : 0);
            var monthly = util.annuityPayment(amount, rate, termMonths);
            var totalCost = monthly * termMonths;
            var probability = Math.max(20, Math.min(96, baseScore - idx * 3));
            return {
                offer_id: 'credit-' + b.id + '-' + amount + '-' + termMonths,
                category: 'credit',
                partner_id: b.id,
                partner_name: b.name,
                partner_short: b.short,
                partner_color: b.color,
                amount: amount,
                term_months: termMonths,
                rate_annual: rate,
                monthly_payment: monthly,
                total_cost: totalCost,
                approval_probability: probability,
                badge: idx === 0 ? 'TOP #1' : null,
            };
        }).sort(function (a, b) {
            // Сортировка: вероятность × (1 - rate_normalized)
            var sa = a.approval_probability * (1 - a.rate_annual / 30);
            var sb = b.approval_probability * (1 - b.rate_annual / 30);
            return sb - sa;
        }).slice(0, 4);
    }

    ns.api.registerMockOffers('credit', buildOffers);

    // Калькулятор переплаты vs лучший
    ns.registerPayload('credit_overpay', function () {
        ns.api.getOffers('credit', ns.state.answers, ns.state.userProfile).then(function (offers) {
            if (!offers.length) return;
            var best = offers.reduce(function (a, b) {
                return a.total_cost < b.total_cost ? a : b;
            });
            var rows = offers.map(function (o) {
                var diff = o.total_cost - best.total_cost;
                return '<tr>' +
                    '<td>' + util.escapeHtml(o.partner_name) + '</td>' +
                    '<td>' + util.fmtPct(o.rate_annual, 1) + '</td>' +
                    '<td>' + util.fmtMoney(o.monthly_payment) + '</td>' +
                    '<td>' + util.fmtMoney(o.total_cost) + '</td>' +
                    '<td class="' + (diff === 0 ? 'good' : 'bad') + '">' +
                        (diff === 0 ? '— лучший' : '+' + util.fmtMoney(diff)) +
                    '</td>' +
                '</tr>';
            }).join('');
            var block = document.createElement('div');
            block.className = 'compare-table';
            block.innerHTML =
                '<div class="compare-title">📊 Калькулятор переплаты</div>' +
                '<table><thead><tr>' +
                    '<th>Банк</th><th>Ставка</th><th>Платёж/мес</th><th>Всего</th><th>Переплата vs лучший</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table>';
            render.appendBlock(block);
        });
    });

    ns.cards.register('credit', function (o) {
        var card = document.createElement('div');
        card.className = 'offer-card';
        card.innerHTML =
            '<div class="offer-card-head">' +
                '<div class="offer-logo" style="background:' + o.partner_color + '">' +
                    util.escapeHtml(o.partner_short) + '</div>' +
                '<div class="offer-name">' + util.escapeHtml(o.partner_name) +
                    (o.badge ? ' <span class="offer-badge">' + util.escapeHtml(o.badge) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="offer-amount">' + util.fmtMoney(o.amount) + '</div>' +
            '<div class="offer-row"><span>Срок</span><b>' + o.term_months + ' мес.</b></div>' +
            '<div class="offer-row"><span>Ставка</span><span class="offer-rate-badge">' +
                util.fmtPct(o.rate_annual, 1) + ' годовых</span></div>' +
            '<div class="offer-row"><span>Ежемесячный платёж</span><b>' +
                util.fmtMoney(o.monthly_payment) + '</b></div>' +
            '<div class="offer-row"><span>Всего к возврату</span><b>' +
                util.fmtMoney(o.total_cost) + '</b></div>' +
            render.probabilityBlock(o.approval_probability) +
            '<button class="btn btn-primary" type="button">Оформить</button>';
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o);
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
            id: 'amount', type: 'number',
            prompt: 'Сколько нужно? Кредит наличными — от <b>50 000 ₽ до 5 000 000 ₽</b>.',
            quickReplies: qr('amount', [
                { label: '100 000 ₽',   value: '100000' },
                { label: '300 000 ₽',   value: '300000' },
                { label: '500 000 ₽',   value: '500000' },
                { label: '1 000 000 ₽', value: '1000000' },
            ]),
            parse: function (text) { return ns.nlp.parseAmount(text); },
            validate: function (v) {
                if (v < 50000) return 'Минимум — 50 000 ₽. Меньше — это уже микрозайм 💰';
                if (v > 5000000) return 'Максимум по потребкредитам — 5 000 000 ₽.';
                return true;
            },
            skipIf: function (s) {
                if (s.preFill && s.preFill.amount && s.preFill.amount >= 50000) {
                    s.answers.amount = s.preFill.amount;
                    return true;
                }
                return false;
            },
        },
        {
            id: 'termMonths', type: 'number',
            prompt: 'На какой срок?',
            quickReplies: qr('termMonths', [
                { label: '6 мес.',  value: '6' },
                { label: '12 мес.', value: '12' },
                { label: '24 мес.', value: '24' },
                { label: '36 мес.', value: '36' },
                { label: '60 мес.', value: '60' },
            ]),
            parse: function (text) {
                var m = text.match(/(\d+)\s*(мес|год|лет)/);
                if (!m) return null;
                var n = parseInt(m[1], 10);
                return /год|лет/.test(m[2]) ? n * 12 : n;
            },
        },
        {
            id: 'purpose', type: 'choice',
            prompt: 'На что планируете потратить?',
            quickReplies: qr('purpose', [
                { label: 'Ремонт',     value: 'repair' },
                { label: 'Авто',       value: 'auto' },
                { label: 'Техника',    value: 'tech' },
                { label: 'Образование', value: 'edu' },
                { label: 'Иное',       value: 'other' },
            ]),
        },
        {
            id: 'income', type: 'number',
            prompt: 'Какой у вас официальный доход в месяц? (₽)',
            quickReplies: qr('income', [
                { label: 'до 30 000', value: '25000' },
                { label: '30–60 тыс.', value: '45000' },
                { label: '60–100 тыс.', value: '80000' },
                { label: '100+ тыс.', value: '120000' },
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
                { label: 'Пенсионер',   value: 'pensioner' },
            ]),
            applyToProfile: function (v, p) { p.employment = v; },
        },
        {
            id: 'currentLoans', type: 'choice',
            prompt: 'Есть ли действующие кредиты?',
            quickReplies: qr('currentLoans', [
                { label: 'Нет',  value: 'none' },
                { label: '1–2', value: '1-2' },
                { label: '3+',   value: '3+', variant: 'warn' },
            ]),
        },
        {
            id: 'overdue', type: 'choice',
            prompt: 'Были ли просрочки за последний год?',
            quickReplies: qr('overdue', [
                { label: 'Нет',  value: 'no' },
                { label: 'Есть', value: 'yes', variant: 'danger' },
            ]),
            applyToProfile: function (v, p) { p.overdue = v === 'yes' ? 'lt30' : 'none'; },
        },
    ];

    function onComplete(answers, profile, state) {
        render.senseiSays(
            ['Анализирую предложения 6 банков-партнёров…',
             'Вот лучшие варианты, отсортированные по выгоде × шансу одобрения:'],
            {
                then: function () {
                    ns.api.getOffers('credit', answers, profile).then(function (offers) {
                        render.renderOffers('credit', offers);
                        render.showAchievement('🏦', 'Подобран кредит');
                        render.renderQuickReplies([
                            { label: '📊 Калькулятор переплаты', payload: 'credit_overpay' },
                            { label: '🔄 Подобрать заново',      payload: 'cat:credit' },
                            { label: '⬅ В меню',                 payload: 'menu' },
                        ]);
                        state.category = null;
                        state.preFill = null;
                    });
                },
            }
        );
    }

    ns.flows.register('credit', {
        schema: schema,
        onComplete: onComplete,
        intro: ['Подберём <b>потребительский кредит</b> в одном из 6 банков-партнёров.'],
    });
})();
