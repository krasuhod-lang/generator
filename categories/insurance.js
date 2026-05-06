/* =========================================================
 * categories/insurance.js — Страхование (ТЗ §1.5).
 *
 * Под-роутер по продукту: insurance:osago, insurance:kasko, ...
 * Полностью реализован поток ОСАГО (5 шагов).
 * Остальные продукты — schema-only stub-flow с 1 шагом и
 * выдачей универсального оффера (агрегатор уточнит детали).
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;

    var INS_PARTNERS = [
        { id: 'sber',    name: 'Сбер Страхование', short: 'СС', color: '#1a9f4a' },
        { id: 'ingos',   name: 'Ингосстрах',      short: 'И',  color: '#0a6cb3' },
        { id: 'alfa',    name: 'АльфаСтрахование', short: 'А',  color: '#ef3124' },
        { id: 'tinkoff', name: 'Тинькофф Страхование', short: 'Т', color: '#ffdd2d' },
        { id: 'reso',    name: 'РЕСО-Гарантия',   short: 'РЕ', color: '#0046ad' },
        { id: 'sogaz',   name: 'СОГАЗ',           short: 'СГ', color: '#003d75' },
    ];

    // ---- ОСАГО: реальный mock-расчёт ----
    function buildOsagoOffers(params) {
        // Тариф = базовый * KT (терр.) * KBM * KVS (возраст/стаж) * KM (мощность)
        var basePremium = 5500;
        var KT = params.region === '77' || params.region === 'Москва' ? 2.0 :
                params.region === '78' || params.region === 'Санкт-Петербург' ? 1.8 : 1.3;
        var KBM = params.kbm != null ? params.kbm : 1.0;
        var KVS = params.driverAge < 22 || params.driverExperience < 3 ? 1.93 : 0.93;
        var KM = params.power < 50 ? 0.6 :
                 params.power < 70 ? 1.0 :
                 params.power < 100 ? 1.1 :
                 params.power < 120 ? 1.2 :
                 params.power < 150 ? 1.4 : 1.6;
        var baseFinal = basePremium * KT * KBM * KVS * KM;

        return INS_PARTNERS.slice(0, 4).map(function (p, idx) {
            // У каждой компании небольшой джиттер
            var price = Math.round(baseFinal * (0.92 + idx * 0.045) / 10) * 10;
            return {
                offer_id: 'osago-' + p.id,
                category: 'insurance',
                product: 'osago',
                partner_id: p.id,
                partner_name: p.name,
                partner_short: p.short,
                partner_color: p.color,
                price: price,
                kt: KT, kbm: KBM, kvs: KVS, km: KM,
                approval_probability: 99, // ОСАГО — обязательное, отказы редки
                badge: idx === 0 ? 'Дешевле всех' : null,
            };
        }).sort(function (a, b) { return a.price - b.price; });
    }

    // ---- Универсальные офферы для остальных продуктов ----
    function buildGenericInsuranceOffers(params) {
        return INS_PARTNERS.slice(0, 3).map(function (p, idx) {
            var basePrice = ({
                kasko: 45000, life: 8500, travel: 1200, property: 4500, dms: 28000,
            })[params.product] || 5000;
            var price = Math.round(basePrice * (1 + idx * 0.15));
            return {
                offer_id: params.product + '-' + p.id,
                category: 'insurance',
                product: params.product,
                partner_id: p.id,
                partner_name: p.name,
                partner_short: p.short,
                partner_color: p.color,
                price: price,
                approval_probability: 95,
                badge: idx === 0 ? 'Лучшая цена' : null,
            };
        });
    }

    function buildOffers(params) {
        if (params.product === 'osago') return buildOsagoOffers(params);
        return buildGenericInsuranceOffers(params);
    }

    ns.api.registerMockOffers('insurance', buildOffers);

    var PRODUCT_LABELS = {
        osago: 'ОСАГО', kasko: 'КАСКО', life: 'НС/Жизнь',
        travel: 'Страховка для выезда за рубеж', property: 'Страхование квартиры', dms: 'ДМС',
    };

    ns.cards.register('insurance', function (o) {
        var card = document.createElement('div');
        card.className = 'offer-card';
        var details = '';
        if (o.product === 'osago') {
            details =
                '<div class="offer-row"><span>Коэффициенты</span><span class="offer-rate-badge">' +
                    'КТ ' + o.kt.toFixed(1) + ' · КБМ ' + o.kbm.toFixed(2) +
                    ' · КВС ' + o.kvs.toFixed(2) + ' · КМ ' + o.km.toFixed(1) +
                '</span></div>';
        }
        card.innerHTML =
            '<div class="offer-card-head">' +
                '<div class="offer-logo" style="background:' + o.partner_color + '">' +
                    util.escapeHtml(o.partner_short) + '</div>' +
                '<div class="offer-name">' + util.escapeHtml(o.partner_name) +
                    (o.badge ? ' <span class="offer-badge">' + util.escapeHtml(o.badge) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="offer-amount">' + util.fmtMoney(o.price) + ' / год</div>' +
            '<div class="offer-row"><span>Продукт</span><b>' +
                util.escapeHtml(PRODUCT_LABELS[o.product] || o.product) + '</b></div>' +
            details +
            render.probabilityBlock(o.approval_probability) +
            '<button class="btn btn-primary" type="button">Оформить электронный полис</button>';
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o, {
                successMessage: 'Отлично! 🛡️',
                lastStep: 'получите электронный полис на e-mail',
            });
        });
        return card;
    });

    function qr(stepId, items) {
        return items.map(function (it) {
            return { label: it.label, payload: 'answer:' + stepId + ':' + it.value, variant: it.variant };
        });
    }

    // ---- Под-роутер: первый шаг — выбор продукта ----
    var schema = [
        {
            id: 'product', type: 'choice',
            prompt: 'Какой полис вас интересует?',
            quickReplies: qr('product', [
                { label: 'ОСАГО',         value: 'osago' },
                { label: 'КАСКО',         value: 'kasko' },
                { label: 'НС / Жизнь',    value: 'life' },
                { label: 'ВЗР (за рубеж)', value: 'travel' },
                { label: 'Квартира',      value: 'property' },
                { label: 'ДМС',           value: 'dms' },
            ]),
        },
        // ---- Шаги ОСАГО (показываются только если product === 'osago') ----
        {
            id: 'carBrandYear', type: 'text',
            prompt: 'Марка и год выпуска авто? (например: Toyota Camry 2018)',
            skipIf: function (s) { return s.answers.product !== 'osago'; },
            parse: function (text) { return text.trim() || null; },
        },
        {
            id: 'power', type: 'number',
            prompt: 'Мощность ТС, л.с.?',
            skipIf: function (s) { return s.answers.product !== 'osago'; },
            quickReplies: qr('power', [
                { label: 'до 70',  value: '65' },
                { label: '70–100', value: '85' },
                { label: '100–150', value: '120' },
                { label: '150+',   value: '180' },
            ]),
            parse: function (text) {
                var m = text.match(/(\d+)/);
                return m ? parseInt(m[1], 10) : null;
            },
        },
        {
            id: 'region', type: 'text',
            prompt: 'Регион регистрации? (например: Москва, 77, СПб)',
            skipIf: function (s) { return s.answers.product !== 'osago'; },
            quickReplies: qr('region', [
                { label: 'Москва (77)',  value: 'Москва' },
                { label: 'СПб (78)',     value: 'Санкт-Петербург' },
                { label: 'Регион',       value: 'регион' },
            ]),
            parse: function (text) { return text.trim() || null; },
            applyToProfile: function (v, p) { p.region = v; },
        },
        {
            id: 'driverExperience', type: 'number',
            prompt: 'Стаж вождения в годах + ваш возраст? (например: «5 лет, 30»)',
            skipIf: function (s) { return s.answers.product !== 'osago'; },
            quickReplies: qr('driverExperience', [
                { label: 'до 3 лет, до 22',  value: '2' },
                { label: '3–10 лет, 25–35',  value: '5' },
                { label: '10+ лет, 35+',     value: '15' },
            ]),
            parse: function (text, state) {
                // Извлекаем оба числа: первое — стаж, второе — возраст
                var nums = text.match(/\d+/g);
                if (!nums) return null;
                if (nums.length >= 2) state.answers.driverAge = parseInt(nums[1], 10);
                return parseInt(nums[0], 10);
            },
        },
        {
            id: 'kbm', type: 'number',
            prompt: 'Знаете ваш КБМ (бонус-малус)? Если нет — просто пропустите.',
            skipIf: function (s) { return s.answers.product !== 'osago'; },
            quickReplies: qr('kbm', [
                { label: '0,46 (10+ лет без аварий)', value: '0.46' },
                { label: '0,7 (5 лет без аварий)',   value: '0.7' },
                { label: '1,0 (новичок)',           value: '1.0' },
                { label: 'Не знаю',                 value: '1.0' },
            ]),
            parse: function (text) {
                var m = text.match(/(\d+(?:[.,]\d+)?)/);
                return m ? parseFloat(m[1].replace(',', '.')) : null;
            },
        },
    ];

    function onComplete(answers, profile, state) {
        var product = answers.product;
        // Дефолты для не-ОСАГО продуктов: ничего больше не спрашиваем, формируем оффер сразу
        if (product !== 'osago') {
            render.senseiSays(
                [
                    'Подбираю предложения по «' + util.escapeHtml(PRODUCT_LABELS[product] || product) + '» ' +
                    'среди наших страховщиков-партнёров.',
                    'Финальную стоимость уточнит страховщик после данных по объекту.',
                ],
                {
                    then: function () {
                        ns.api.getOffers('insurance', answers, profile).then(function (offers) {
                            render.renderOffers('insurance', offers);
                            render.showAchievement('🛡️', 'Подобран полис');
                            render.renderQuickReplies([
                                { label: '🔄 Другой полис', payload: 'cat:insurance' },
                                { label: '⬅ В меню',         payload: 'menu' },
                            ]);
                            state.category = null;
                        });
                    },
                }
            );
            return;
        }

        // ОСАГО — полный расчёт
        if (answers.driverAge == null) answers.driverAge = 30;
        if (answers.kbm == null) answers.kbm = 1.0;

        render.senseiSays(
            ['Считаю стоимость ОСАГО по официальным коэффициентам РСА…',
             'Вот предложения 4 страховых:'],
            {
                then: function () {
                    ns.api.getOffers('insurance', answers, profile).then(function (offers) {
                        render.renderOffers('insurance', offers);
                        render.showAchievement('🛡️', 'Подобрано ОСАГО');
                        render.renderQuickReplies([
                            { label: '🔄 Другой полис', payload: 'cat:insurance' },
                            { label: '⬅ В меню',         payload: 'menu' },
                        ]);
                        state.category = null;
                    });
                },
            }
        );
    }

    ns.flows.register('insurance', {
        schema: schema,
        onComplete: onComplete,
        intro: ['Помогу подобрать <b>страховой полис</b>: ОСАГО, КАСКО, ДМС, страховку для выезда за рубеж и др.'],
    });
})();
