/* =========================================================
 * categories/mortgages.js — Ипотека (ТЗ §1.3).
 *
 * Шаги: propertyType → price → downPayment → termYears →
 *       income → familyStatus → region → program → офферы.
 *
 * Особенности:
 *   - Автоопределение льготной/семейной/IT-программы по ответам
 *   - Сравнительная таблица "С господдержкой vs Рыночная"
 *   - Дисклеймер о предварительности расчёта
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;

    var BANK_PARTNERS = [
        { id: 'domrf',  name: 'ДОМ.РФ',     short: 'ДРФ', color: '#19a39c' },
        { id: 'sber',   name: 'Сбербанк',   short: 'СБ',  color: '#1a9f4a' },
        { id: 'vtb',    name: 'ВТБ',        short: 'ВТ',  color: '#0a2973' },
        { id: 'alfa',   name: 'Альфа-Банк', short: 'А',   color: '#ef3124' },
        { id: 'rosbank', name: 'Росбанк',   short: 'РБ',  color: '#d4002a' },
    ];

    /** Автоопределение программы по answers + userProfile. */
    function detectProgram(answers) {
        if (answers.program && answers.program !== 'auto') return answers.program;
        if (answers.familyStatus === 'kids_under_7') return 'family';      // Семейная 6%
        if (answers.familyStatus === 'it_specialist') return 'it';         // IT-ипотека ~5%
        if (answers.propertyType === 'new') return 'subsidized';           // Льготная 8%
        return 'market';
    }

    var PROGRAM_RATES = {
        family:     { rate: 6.0, label: 'Семейная ипотека (6%)' },
        it:         { rate: 5.0, label: 'IT-ипотека (5%)' },
        subsidized: { rate: 8.0, label: 'Льготная ипотека (8%)' },
        market:     { rate: 16.5, label: 'Рыночная программа' },
    };

    function buildOffers(params) {
        var program = detectProgram(params);
        var p = PROGRAM_RATES[program];
        var price = params.price;
        var downPct = params.downPaymentPct || 20;
        var loan = price * (1 - downPct / 100);
        var months = (params.termYears || 20) * 12;

        return BANK_PARTNERS.map(function (b, idx) {
            // Программа едина для всех банков, но банки немного варьируют ставку
            var rate = p.rate + idx * 0.2;
            var marketRate = PROGRAM_RATES.market.rate + idx * 0.2;
            var monthly = util.annuityPayment(loan, rate, months);
            var totalPaid = monthly * months;
            var marketMonthly = util.annuityPayment(loan, marketRate, months);
            var marketTotal = marketMonthly * months;
            return {
                offer_id: 'mortgage-' + b.id + '-' + price,
                category: 'mortgage',
                partner_id: b.id,
                partner_name: b.name,
                partner_short: b.short,
                partner_color: b.color,
                price: price,
                loan_amount: loan,
                down_payment_pct: downPct,
                term_years: params.termYears,
                program: program,
                program_label: p.label,
                rate_annual: rate,
                market_rate_annual: marketRate,
                monthly_payment: monthly,
                market_monthly_payment: marketMonthly,
                total_paid: totalPaid,
                market_total_paid: marketTotal,
                overpayment: totalPaid - loan,
                approval_probability: Math.max(40, 88 - idx * 5),
                badge: idx === 0 ? 'TOP #1' : null,
            };
        }).slice(0, 4);
    }

    ns.api.registerMockOffers('mortgage', buildOffers);

    ns.cards.register('mortgage', function (o) {
        var card = document.createElement('div');
        card.className = 'offer-card offer-card-wide';
        card.innerHTML =
            '<div class="offer-card-head">' +
                '<div class="offer-logo" style="background:' + o.partner_color + '">' +
                    util.escapeHtml(o.partner_short) + '</div>' +
                '<div class="offer-name">' + util.escapeHtml(o.partner_name) +
                    (o.badge ? ' <span class="offer-badge">' + util.escapeHtml(o.badge) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="program-tag">' + util.escapeHtml(o.program_label) + '</div>' +
            '<div class="offer-amount">' + util.fmtMoney(o.monthly_payment) + ' / мес.</div>' +
            '<table class="mortgage-compare">' +
                '<thead><tr><th></th><th>Господдержка</th><th>Рыночная</th></tr></thead>' +
                '<tbody>' +
                    '<tr><td>Ставка</td><td><b>' + util.fmtPct(o.rate_annual, 1) + '</b></td>' +
                        '<td>' + util.fmtPct(o.market_rate_annual, 1) + '</td></tr>' +
                    '<tr><td>Платёж/мес</td><td><b>' + util.fmtMoney(o.monthly_payment) + '</b></td>' +
                        '<td>' + util.fmtMoney(o.market_monthly_payment) + '</td></tr>' +
                    '<tr><td>Всего за срок</td><td><b>' + util.fmtMoney(o.total_paid) + '</b></td>' +
                        '<td>' + util.fmtMoney(o.market_total_paid) + '</td></tr>' +
                '</tbody>' +
            '</table>' +
            '<div class="offer-row"><span>Сумма кредита</span><b>' + util.fmtMoney(o.loan_amount) + '</b></div>' +
            '<div class="offer-row"><span>Срок</span><b>' + o.term_years + ' лет</b></div>' +
            render.probabilityBlock(o.approval_probability) +
            '<button class="btn btn-primary" type="button">Записаться на консультацию</button>';
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o, {
                successMessage: 'Отличный выбор! 🏠',
                lastStep: 'попадёте к ипотечному менеджеру для финального расчёта',
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
            id: 'propertyType', type: 'choice',
            prompt: 'Какую недвижимость планируете?',
            quickReplies: qr('propertyType', [
                { label: 'Новостройка', value: 'new' },
                { label: 'Вторичка',    value: 'secondary' },
                { label: 'Таунхаус',    value: 'townhouse' },
            ]),
        },
        {
            id: 'price', type: 'number',
            prompt: 'Какова стоимость объекта? (₽)',
            quickReplies: qr('price', [
                { label: '5 млн',  value: '5000000' },
                { label: '10 млн', value: '10000000' },
                { label: '15 млн', value: '15000000' },
                { label: '25 млн', value: '25000000' },
            ]),
            parse: function (text) { return ns.nlp.parseAmount(text); },
            validate: function (v) {
                if (v < 1000000) return 'Слишком маленькая сумма для ипотеки. Минимум — 1 000 000 ₽.';
                return true;
            },
        },
        {
            id: 'downPaymentPct', type: 'number',
            prompt: 'Какой первоначальный взнос? Введите % или сумму в ₽.',
            quickReplies: qr('downPaymentPct', [
                { label: '15%', value: '15' },
                { label: '20%', value: '20' },
                { label: '30%', value: '30' },
                { label: '50%', value: '50' },
            ]),
            parse: function (text, state) {
                var t = text.toLowerCase();
                var pctMatch = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
                if (pctMatch) return parseFloat(pctMatch[1].replace(',', '.'));
                var amount = ns.nlp.parseAmount(t);
                if (amount && state.answers.price) {
                    return Math.round((amount / state.answers.price) * 1000) / 10;
                }
                var n = parseFloat(t.replace(',', '.'));
                return isNaN(n) ? null : n;
            },
            validate: function (v) {
                if (v < 10) return 'Минимальный первоначальный взнос — 10%.';
                if (v > 95) return 'Слишком большой взнос — может, оформить покупку без ипотеки?';
                return true;
            },
        },
        {
            id: 'termYears', type: 'number',
            prompt: 'На какой срок?',
            quickReplies: qr('termYears', [
                { label: '5 лет',  value: '5' },
                { label: '10 лет', value: '10' },
                { label: '15 лет', value: '15' },
                { label: '20 лет', value: '20' },
                { label: '25 лет', value: '25' },
                { label: '30 лет', value: '30' },
            ]),
            parse: function (text) {
                var m = text.match(/(\d+)\s*(год|лет|year)/);
                return m ? parseInt(m[1], 10) : null;
            },
        },
        {
            id: 'income', type: 'number',
            prompt: 'Какой у вас официальный доход в месяц? (₽)',
            quickReplies: qr('income', [
                { label: '50–100 тыс.',  value: '75000' },
                { label: '100–200 тыс.', value: '150000' },
                { label: '200–400 тыс.', value: '300000' },
                { label: '400+ тыс.',    value: '500000' },
            ]),
            parse: function (text) { return ns.nlp.parseAmount(text); },
        },
        {
            id: 'familyStatus', type: 'choice',
            prompt: 'Семейный статус?',
            intro: ['Это нужно, чтобы автоматически подобрать вам <b>программу господдержки</b>.'],
            quickReplies: qr('familyStatus', [
                { label: 'Одинок/одинока',         value: 'single' },
                { label: 'В браке, без детей',     value: 'married' },
                { label: 'Дети до 7 лет',          value: 'kids_under_7' },
                { label: 'Аккредитованный IT-спец', value: 'it_specialist' },
            ]),
        },
        {
            id: 'region', type: 'text',
            prompt: 'В каком регионе планируете покупку? (например: Москва, 77, Краснодарский край)',
            quickReplies: qr('region', [
                { label: 'Москва',            value: 'Москва' },
                { label: 'СПб',               value: 'Санкт-Петербург' },
                { label: 'Краснодарский край', value: 'Краснодарский край' },
            ]),
            parse: function (text) { return text.trim() || null; },
            applyToProfile: function (v, p) { p.region = v; },
        },
    ];

    function onComplete(answers, profile, state) {
        var program = detectProgram(answers);
        var p = PROGRAM_RATES[program];
        var detectedMsg = '';
        if (program === 'family') {
            detectedMsg = 'По вашим ответам подходит <b>Семейная ипотека под 6%</b> 🎉';
        } else if (program === 'it') {
            detectedMsg = 'По вашему статусу IT-специалиста доступна <b>IT-ипотека под 5%</b> 🎉';
        } else if (program === 'subsidized') {
            detectedMsg = 'Для новостроек действует <b>Льготная ипотека под 8%</b> 🎉';
        } else {
            detectedMsg = 'Под ваши параметры подходит <b>рыночная программа</b>.';
        }

        render.senseiSays(
            [
                detectedMsg,
                '⚠️ <b>Это предварительный расчёт.</b> Финальная ставка зависит от оценки объекта банком ' +
                'и подтверждённого дохода.',
                'Сравните предложения банков-партнёров — обратите внимание на колонки ' +
                '«Господдержка» vs «Рыночная»:',
            ],
            {
                then: function () {
                    ns.api.getOffers('mortgage', answers, profile).then(function (offers) {
                        render.renderOffers('mortgage', offers);
                        render.showAchievement('🏠', 'Подобрана ипотека');
                        render.renderQuickReplies([
                            { label: '🔄 Подобрать заново', payload: 'cat:mortgage' },
                            { label: '⬅ В меню',            payload: 'menu' },
                        ]);
                        state.category = null;
                    });
                },
            }
        );
    }

    ns.flows.register('mortgage', {
        schema: schema,
        onComplete: onComplete,
        intro: ['Подберём <b>ипотеку</b>. Я учту льготные программы (Семейная, IT, Льготная 8%) автоматически.'],
    });
})();
