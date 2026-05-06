/* =========================================================
 * categories/refinancing.js — Рефинансирование (ТЗ §1.7).
 *
 * Шаги: debtType → currentRate → balance → monthsLeft → currentBank → офферы.
 * Фишка: «точка безубыточности» — расчёт, выгодно ли переходить.
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;

    var BANK_PARTNERS = [
        { id: 'sber',    name: 'Сбербанк',     short: 'СБ', color: '#1a9f4a' },
        { id: 'tinkoff', name: 'Тинькофф',     short: 'Т',  color: '#ffdd2d' },
        { id: 'alfa',    name: 'Альфа-Банк',   short: 'А',  color: '#ef3124' },
        { id: 'vtb',     name: 'ВТБ',          short: 'ВТ', color: '#0a2973' },
        { id: 'gazprom', name: 'Газпромбанк',  short: 'ГБ', color: '#0a4d8c' },
    ];

    var DEBT_TYPE_RATES = {
        consumer: 12.5,  // потребкредит
        mortgage: 9.0,
        card:     17.0,
        microloan: 22.0,
    };

    function buildOffers(params) {
        var debtType = params.debtType || 'consumer';
        var balance = params.balance;
        var monthsLeft = params.monthsLeft;
        var currentRate = params.currentRate;

        var newBaseRate = DEBT_TYPE_RATES[debtType];
        // Текущий ежемесячный платёж по старому кредиту
        var oldMonthly = util.annuityPayment(balance, currentRate, monthsLeft);
        var oldTotal = oldMonthly * monthsLeft;

        return BANK_PARTNERS.map(function (b, idx) {
            var newRate = newBaseRate + idx * 0.4;
            var newMonthly = util.annuityPayment(balance, newRate, monthsLeft);
            var newTotal = newMonthly * monthsLeft;
            var monthlySaving = oldMonthly - newMonthly;
            var totalSaving = oldTotal - newTotal;
            // Точка безубыточности: при ~1% от баланса closing costs
            var closingCosts = balance * 0.01;
            var breakEvenMonths = monthlySaving > 0 ? Math.ceil(closingCosts / monthlySaving) : null;
            return {
                offer_id: 'refi-' + b.id + '-' + balance,
                category: 'refinancing',
                partner_id: b.id,
                partner_name: b.name,
                partner_short: b.short,
                partner_color: b.color,
                debt_type: debtType,
                balance: balance,
                term_months: monthsLeft,
                old_rate: currentRate,
                new_rate: newRate,
                old_monthly: oldMonthly,
                new_monthly: newMonthly,
                monthly_saving: monthlySaving,
                total_saving: totalSaving,
                closing_costs: closingCosts,
                break_even_months: breakEvenMonths,
                worthwhile: monthlySaving > 0 && breakEvenMonths != null && breakEvenMonths < monthsLeft / 2,
                approval_probability: Math.max(40, 88 - idx * 6),
                badge: idx === 0 ? 'Максимальная экономия' : null,
            };
        }).sort(function (a, b) { return b.total_saving - a.total_saving; }).slice(0, 4);
    }

    ns.api.registerMockOffers('refinancing', buildOffers);

    ns.cards.register('refinancing', function (o) {
        var card = document.createElement('div');
        card.className = 'offer-card';
        var savingClass = o.monthly_saving > 0 ? 'good' : 'bad';
        card.innerHTML =
            '<div class="offer-card-head">' +
                '<div class="offer-logo" style="background:' + o.partner_color + '">' +
                    util.escapeHtml(o.partner_short) + '</div>' +
                '<div class="offer-name">' + util.escapeHtml(o.partner_name) +
                    (o.badge ? ' <span class="offer-badge">' + util.escapeHtml(o.badge) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="offer-amount ' + savingClass + '">' +
                (o.monthly_saving > 0 ? '−' : '+') +
                util.fmtMoney(Math.abs(o.monthly_saving)) + ' / мес' +
            '</div>' +
            '<div class="offer-row"><span>Ставка</span><span class="offer-rate-badge">' +
                util.fmtPct(o.old_rate, 1) + ' → <b>' + util.fmtPct(o.new_rate, 1) + '</b></span></div>' +
            '<div class="offer-row"><span>Платёж/мес</span><b>' +
                util.fmtMoney(o.new_monthly) + '</b></div>' +
            '<div class="offer-row"><span>Экономия за весь срок</span><b class="' + savingClass + '">' +
                (o.total_saving > 0 ? util.fmtMoney(o.total_saving) : '—') + '</b></div>' +
            (o.break_even_months
                ? '<div class="offer-row"><span>Окупится за</span><b>' + o.break_even_months + ' мес.</b></div>'
                : '') +
            (o.worthwhile
                ? '<div class="offer-highlight">✅ Рефинансирование выгодно</div>'
                : '<div class="offer-highlight warn">⚠️ Выгода сомнительна — проверьте расчёт</div>') +
            render.probabilityBlock(o.approval_probability) +
            '<button class="btn btn-primary" type="button">Подать заявку</button>';
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o, {
                successMessage: 'Замечательно! 🔄',
                lastStep: 'банк свяжется с вами для перехода старого кредита',
            });
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
            id: 'debtType', type: 'choice',
            prompt: 'Какой тип долга хотите рефинансировать?',
            quickReplies: qr('debtType', [
                { label: 'Потребкредит', value: 'consumer' },
                { label: 'Ипотека',      value: 'mortgage' },
                { label: 'Кредитная карта', value: 'card' },
                { label: 'Микрозайм',    value: 'microloan' },
            ]),
        },
        {
            id: 'currentRate', type: 'number',
            prompt: 'Какая у вас сейчас ставка в %?',
            quickReplies: qr('currentRate', [
                { label: '15%', value: '15' },
                { label: '20%', value: '20' },
                { label: '25%', value: '25' },
                { label: '30%+', value: '32' },
            ]),
            parse: function (text) {
                var m = text.match(/(\d+(?:[.,]\d+)?)\s*%?/);
                return m ? parseFloat(m[1].replace(',', '.')) : null;
            },
        },
        {
            id: 'balance', type: 'number',
            prompt: 'Какой остаток долга?',
            quickReplies: qr('balance', [
                { label: '100 000 ₽',   value: '100000' },
                { label: '500 000 ₽',   value: '500000' },
                { label: '1 000 000 ₽', value: '1000000' },
                { label: '3 000 000 ₽', value: '3000000' },
            ]),
            parse: function (text) { return ns.nlp.parseAmount(text); },
        },
        {
            id: 'monthsLeft', type: 'number',
            prompt: 'Сколько ещё платить (в месяцах)?',
            quickReplies: qr('monthsLeft', [
                { label: '12 мес.',  value: '12' },
                { label: '24 мес.',  value: '24' },
                { label: '60 мес.',  value: '60' },
                { label: '120+',     value: '120' },
            ]),
            parse: function (text) {
                var m = text.match(/(\d+)\s*(мес|год|лет)/);
                if (!m) return null;
                var n = parseInt(m[1], 10);
                return /год|лет/.test(m[2]) ? n * 12 : n;
            },
        },
        {
            id: 'currentBank', type: 'text',
            prompt: 'В каком банке сейчас обслуживаетесь?',
            quickReplies: qr('currentBank', [
                { label: 'Сбер',     value: 'Сбер' },
                { label: 'ВТБ',      value: 'ВТБ' },
                { label: 'Тинькофф', value: 'Тинькофф' },
                { label: 'Другой',   value: 'Другой' },
            ]),
            parse: function (text) { return text.trim() || null; },
        },
    ];

    function onComplete(answers, profile, state) {
        render.senseiSays(
            ['Считаю вашу выгоду от рефинансирования…',
             '🧮 Учитываю расходы на оформление (~1% от остатка) и точку безубыточности.'],
            {
                then: function () {
                    ns.api.getOffers('refinancing', answers, profile).then(function (offers) {
                        render.renderOffers('refinancing', offers);
                        // Общая рекомендация по лучшему офферу
                        var best = offers[0];
                        if (best && best.worthwhile) {
                            render.senseiSays(
                                'Лучшее предложение окупит расходы за <b>' +
                                best.break_even_months + ' мес.</b>, после чего вы будете экономить ' +
                                util.fmtMoney(best.monthly_saving) + ' ежемесячно. Рекомендую перейти.'
                            );
                        } else if (best) {
                            render.senseiSays(
                                'По вашим параметрам выгода от перехода сомнительна — расходы на ' +
                                'оформление могут не окупиться. Возможно, стоит сначала поискать ' +
                                'варианты получше или дождаться снижения ставок.'
                            );
                        }
                        render.showAchievement('🔄', 'Просчитано рефинансирование');
                        render.renderQuickReplies([
                            { label: '🔄 Пересчитать',  payload: 'cat:refinancing' },
                            { label: '⬅ В меню',         payload: 'menu' },
                        ]);
                        state.category = null;
                    });
                },
            }
        );
    }

    ns.flows.register('refinancing', {
        schema: schema,
        onComplete: onComplete,
        intro: ['Помогу понять, выгодно ли вам сейчас <b>рефинансировать</b> текущий долг.'],
    });
})();
