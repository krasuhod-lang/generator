/* =========================================================
 * categories/deposits.js — Вклады и накопления (ТЗ §1.6).
 *
 * Шаги: amount → termMonths → topUp → capitalization → офферы.
 * Фишка: «Счётчик дохода» — анимированный rAF-тикер.
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;

    var BANK_PARTNERS = [
        { id: 'sber',    name: 'Сбербанк',     short: 'СБ', color: '#1a9f4a', baseRate: 14.5 },
        { id: 'vtb',     name: 'ВТБ',          short: 'ВТ', color: '#0a2973', baseRate: 15.0 },
        { id: 'tinkoff', name: 'Тинькофф',     short: 'Т',  color: '#ffdd2d', baseRate: 15.5 },
        { id: 'alfa',    name: 'Альфа-Банк',   short: 'А',  color: '#ef3124', baseRate: 14.8 },
        { id: 'gazprom', name: 'Газпромбанк',  short: 'ГБ', color: '#0a4d8c', baseRate: 15.2 },
    ];

    function buildOffers(params) {
        var amount = params.amount;
        var months = params.termMonths;
        var topUp = params.topUp === 'yes';
        var cap = params.capitalization === 'yes';

        return BANK_PARTNERS.map(function (b, idx) {
            var rate = b.baseRate;
            // Корректировки: с пополнением — обычно ниже на 0.5–1.0
            if (topUp) rate -= 0.7;
            // С капитализацией — обычно ниже на ~0.3
            if (cap) rate -= 0.3;
            // Чем дольше срок, тем выше ставка
            if (months >= 12) rate += 0.3;
            if (months >= 24) rate += 0.5;
            // Джиттер по банку
            rate += (idx - 2) * 0.2;
            rate = Math.max(8, Math.min(20, rate));

            // Доход: эффективная ставка с капитализацией ≈ (1+r/12)^n - 1
            var income;
            if (cap) {
                var monthlyRate = rate / 100 / 12;
                income = amount * (Math.pow(1 + monthlyRate, months) - 1);
            } else {
                income = amount * (rate / 100) * (months / 12);
            }
            return {
                offer_id: 'deposit-' + b.id + '-' + amount + '-' + months,
                category: 'deposit',
                partner_id: b.id,
                partner_name: b.name,
                partner_short: b.short,
                partner_color: b.color,
                amount: amount,
                term_months: months,
                rate_annual: rate,
                income: income,
                final_sum: amount + income,
                top_up: topUp,
                capitalization: cap,
                asv_protected: amount <= 1400000,
                approval_probability: 99,
                badge: idx === 0 ? 'TOP по ставке' : null,
            };
        }).sort(function (a, b) { return b.rate_annual - a.rate_annual; }).slice(0, 4);
    }

    ns.api.registerMockOffers('deposit', buildOffers);

    // ---- Анимированный «Счётчик дохода» ----
    var activeTickers = [];

    function startTicker(el, target, durationMs) {
        var start = performance.now();
        var raf = null;
        function step(now) {
            var t = Math.min(1, (now - start) / durationMs);
            var current = target * (1 - Math.pow(1 - t, 3)); // easeOutCubic
            el.textContent = util.fmtMoney(current);
            if (t < 1) raf = requestAnimationFrame(step);
        }
        raf = requestAnimationFrame(step);
        var handle = {
            stop: function () { if (raf != null) cancelAnimationFrame(raf); },
        };
        activeTickers.push(handle);
        return handle;
    }
    ns.tickers = {
        stopAll: function () {
            activeTickers.forEach(function (t) { t.stop(); });
            activeTickers = [];
        },
    };

    ns.cards.register('deposit', function (o) {
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
            '<div class="offer-row"><span>Ставка</span><span class="offer-rate-badge">' +
                util.fmtPct(o.rate_annual, 1) + ' годовых</span></div>' +
            '<div class="offer-row"><span>Сумма вклада</span><b>' + util.fmtMoney(o.amount) + '</b></div>' +
            '<div class="offer-row"><span>Срок</span><b>' + o.term_months + ' мес.</b></div>' +
            '<div class="ticker-block">' +
                '<div class="ticker-label">💰 Доход за весь срок</div>' +
                '<div class="ticker-value" data-target="' + o.income + '">0 ₽</div>' +
                '<div class="ticker-final">Итого на счёте: <b>' + util.fmtMoney(o.final_sum) + '</b></div>' +
            '</div>' +
            (o.asv_protected
                ? '<div class="asv-badge">🛡 Застрахован АСВ до 1,4 млн ₽</div>'
                : '<div class="asv-badge warn">⚠️ Сумма больше 1,4 млн — лимит АСВ</div>') +
            '<button class="btn btn-primary" type="button">Открыть вклад</button>';
        // Запускаем тикер после вставки
        setTimeout(function () {
            var ticker = card.querySelector('.ticker-value');
            if (ticker) startTicker(ticker, o.income, 1800);
        }, 50);
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o, {
                successMessage: 'Превосходный выбор для финансового дзена! 🧘',
                lastStep: 'откроете вклад без визита в банк',
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
            id: 'amount', type: 'number',
            prompt: 'Какую сумму планируете разместить?',
            quickReplies: qr('amount', [
                { label: '50 000 ₽',    value: '50000' },
                { label: '300 000 ₽',   value: '300000' },
                { label: '1 000 000 ₽', value: '1000000' },
                { label: '3 000 000 ₽', value: '3000000' },
            ]),
            parse: function (text) { return ns.nlp.parseAmount(text); },
            validate: function (v) {
                if (v < 1000) return 'Минимальная сумма для вклада — 1 000 ₽.';
                return true;
            },
        },
        {
            id: 'termMonths', type: 'number',
            prompt: 'На какой срок?',
            quickReplies: qr('termMonths', [
                { label: 'До востребования', value: '1' },
                { label: '3 мес.',  value: '3' },
                { label: '6 мес.',  value: '6' },
                { label: '12 мес.', value: '12' },
                { label: '24 мес.', value: '24' },
            ]),
            parse: function (text) {
                var m = text.match(/(\d+)\s*(мес|год|лет)/);
                if (!m) return null;
                var n = parseInt(m[1], 10);
                return /год|лет/.test(m[2]) ? n * 12 : n;
            },
        },
        {
            id: 'topUp', type: 'choice',
            prompt: 'Нужна возможность пополнения / снятия?',
            quickReplies: qr('topUp', [
                { label: 'Нет, фиксированная сумма', value: 'no' },
                { label: 'Да, нужно пополнять',      value: 'yes' },
            ]),
        },
        {
            id: 'capitalization', type: 'choice',
            prompt: 'Капитализация процентов нужна?',
            quickReplies: qr('capitalization', [
                { label: 'Да, нужна',  value: 'yes' },
                { label: 'Не важно',   value: 'no' },
            ]),
        },
    ];

    function onComplete(answers, profile, state) {
        render.senseiSays(
            ['Анализирую предложения 5 банков…',
             'Смотрите, как растёт ваш доход в реальном времени 📈'],
            {
                then: function () {
                    ns.api.getOffers('deposit', answers, profile).then(function (offers) {
                        render.renderOffers('deposit', offers);
                        render.showAchievement('📈', 'Подобран вклад');
                        render.renderQuickReplies([
                            { label: '🔄 Подобрать заново', payload: 'cat:deposit' },
                            { label: '⬅ В меню',            payload: 'menu' },
                        ]);
                        state.category = null;
                    });
                },
            }
        );
    }

    ns.flows.register('deposit', {
        schema: schema,
        onComplete: onComplete,
        intro: ['Подберём <b>вклад или накопительный счёт</b>. Все банки — со страхованием АСВ до 1,4 млн ₽.'],
    });
})();
