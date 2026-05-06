/* =========================================================
 * categories/loans.js — микрозаймы (Sprint 1 baseline).
 *
 * Соответствует ТЗ §2.2 (Sprint 1) и сохранён для регрессии:
 *   шаги: amount → termDays → overdue → age → employment → офферы.
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;
    var nlp = ns.nlp;

    var MFO_PARTNERS = [
        { id: 'vyruchai-dengi', name: 'МКК «Выручай-деньги»', short: 'ВД', color: '#3b2e8c' },
        { id: 'bystrokredit',   name: 'БыстроКредит',         short: 'БК', color: '#18b86b' },
        { id: 'dengilegko',     name: 'ДеньгиЛегко',          short: 'ДЛ', color: '#5b46d6' },
        { id: 'finansplus',     name: 'ФинансПлюс',           short: 'Ф+', color: '#f5a524' },
        { id: 'kreditdom',      name: 'КредитДом',            short: 'КД', color: '#0ea5e9' },
    ];

    /** Mock-скоринг — возвращает топ-3 оффера. */
    function buildOffers(params, profile) {
        var amount = params.amount;
        var termDays = params.termDays;
        var baseScore = 85;
        if (profile.overdue === 'lt30') baseScore -= 15;
        if (profile.overdue === 'gt90') baseScore -= 40;
        if (profile.employment === 'self') baseScore -= 5;
        if (profile.employment === 'none') baseScore -= 25;
        if (profile.age && (profile.age < 21 || profile.age > 65)) baseScore -= 10;
        if (amount > 100000) baseScore -= 5;

        var rates = ['Первый займ под 0%', '0,8% в день', '0,5% в день', '0,11% в день'];

        return MFO_PARTNERS.slice(0, 3).map(function (mfo, idx) {
            var jitter = [0, -7, -12][idx];
            var probability = Math.max(35, Math.min(98, baseScore + jitter));
            return {
                offer_id: 'loan-' + mfo.id + '-' + amount,
                category: 'loan',
                partner_id: mfo.id,
                partner_name: mfo.name,
                partner_short: mfo.short,
                partner_color: mfo.color,
                amount: amount,
                term_days: termDays,
                rate: idx === 0 ? rates[0] : rates[idx + 1] || '0,5% в день',
                approval_probability: probability,
                badge: idx === 0 ? 'TOP #1' : null,
            };
        });
    }

    ns.api.registerMockOffers('loan', buildOffers);

    // ---- Карточка ----
    ns.cards.register('loan', function (o) {
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
            '<div class="offer-row"><span>Срок</span><b>до ' + o.term_days + ' дн.</b></div>' +
            '<div class="offer-row"><span>Ставка</span><span class="offer-rate-badge">' +
                util.escapeHtml(o.rate) + '</span></div>' +
            render.probabilityBlock(o.approval_probability) +
            '<button class="btn btn-primary" type="button">Оформить в 1 клик</button>';
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o);
        });
        return card;
    });

    // ---- Quick-reply шаблоны ----
    function qr(stepId, items) {
        return items.map(function (it) {
            return { label: it.label, payload: 'answer:' + stepId + ':' + it.value, variant: it.variant };
        });
    }

    // ---- Schema ----
    var schema = [
        {
            id: 'amount',
            type: 'number',
            prompt: 'Сколько вам нужно? Можно сказать просто: «<i>30 тысяч</i>» или «<i>10к</i>».',
            quickReplies: qr('amount', [
                { label: '5 000 ₽',  value: '5000' },
                { label: '15 000 ₽', value: '15000' },
                { label: '30 000 ₽', value: '30000' },
                { label: '50 000 ₽', value: '50000' },
            ]),
            parse: function (text) { return nlp.parseAmount(text); },
            errorPrompt: 'Не уловил сумму 🤔 Попробуйте: «30 тысяч» или «50000».',
            validate: function (v) {
                if (v < 1000) return 'Минимальная сумма займа — 1 000 ₽.';
                if (v > 500000) return 'Сумма больше 500 000 ₽ — это уже потребкредит. Хотите перейти?';
                return true;
            },
            skipIf: function (s) {
                if (s.preFill && s.preFill.amount) {
                    s.answers.amount = s.preFill.amount;
                    return true;
                }
                return s.answers.amount != null;
            },
        },
        {
            id: 'termDays',
            type: 'number',
            prompt: 'На какой срок? До зарплаты, на пару недель?',
            quickReplies: qr('termDays', [
                { label: '7 дней',                value: '7' },
                { label: '14 дней',               value: '14' },
                { label: '30 дней (до зарплаты)', value: '30' },
            ]),
            parse: function (text) { return nlp.parseTerm(text); },
            errorPrompt: 'Не понял срок. Например: «на 14 дней» или «до зарплаты».',
            skipIf: function (s) {
                if (s.preFill && s.preFill.termDays) {
                    s.answers.termDays = s.preFill.termDays;
                    return true;
                }
                return s.answers.termDays != null;
            },
        },
        {
            id: 'overdue',
            type: 'choice',
            intro: ['Отлично, чтобы я подобрал предложения, где вам <b>точно не откажут</b>, уточним пару деталей.'],
            prompt: 'У вас есть текущие просрочки по кредитам?',
            quickReplies: qr('overdue', [
                { label: 'Нет просрочек',       value: 'none' },
                { label: 'Есть, до 30 дней',    value: 'lt30', variant: 'warn' },
                { label: 'Есть, более 90 дней', value: 'gt90', variant: 'danger' },
            ]),
            parse: function (text) {
                var t = text.toLowerCase();
                if (/нет|без|чисто/.test(t)) return 'none';
                if (/90|год|давн/.test(t)) return 'gt90';
                if (/есть|был|прос/.test(t)) return 'lt30';
                return null;
            },
            applyToProfile: function (v, p) { p.overdue = v; },
        },
        {
            id: 'age',
            type: 'number',
            prompt: 'Сколько вам полных лет?',
            quickReplies: qr('age', [
                { label: '18–25', value: '22' },
                { label: '26–40', value: '33' },
                { label: '41–60', value: '50' },
                { label: '60+',   value: '65' },
            ]),
            parse: function (text) {
                var m = text.match(/\d{2}/);
                return m ? parseInt(m[0], 10) : null;
            },
            errorPrompt: 'Подскажите числом, сколько вам полных лет.',
            applyToProfile: function (v, p) { p.age = v; },
        },
        {
            id: 'employment',
            type: 'choice',
            prompt: 'И последний вопрос — ваш тип занятости?',
            quickReplies: qr('employment', [
                { label: 'Найм',        value: 'employed' },
                { label: 'Самозанятый', value: 'self' },
                { label: 'Без работы',  value: 'none', variant: 'warn' },
            ]),
            applyToProfile: function (v, p) { p.employment = v; },
        },
    ];

    // ---- Завершение flow ----
    function onComplete(answers, profile, state) {
        render.senseiSays(
            ['Минуту, изучаю 40+ предложений… 🧘', 'Вот <b>топ-3</b> с максимальным шансом одобрения для вас:'],
            {
                then: function () {
                    ns.api.getOffers('loan', answers, profile).then(function (offers) {
                        render.renderOffers('loan', offers);
                        render.showAchievement('🎯', 'Первая консультация');
                        if (profile.overdue === 'none') {
                            render.setLevel('Самурай', '⚔️');
                            render.showAchievement('⚔️', 'Чистая кредитная история');
                        } else {
                            render.setLevel('Подмастерье', '🌿');
                        }
                        render.renderQuickReplies([
                            { label: '🔄 Подобрать заново', payload: 'cat:loan' },
                            { label: '⬅ В меню',            payload: 'menu' },
                        ]);
                        // финал flow — сбросим state
                        state.category = null;
                        state.preFill = null;
                    });
                },
            }
        );
    }

    ns.flows.register('loan', {
        schema: schema,
        onComplete: onComplete,
        intro: null,
    });
})();
