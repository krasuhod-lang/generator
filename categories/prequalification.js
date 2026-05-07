/* =========================================================
 * categories/prequalification.js — квиз пред-скоринга
 * «Узнай свои шансы на займ за 1 минуту».
 *
 * ВАЖНО — что эта категория НЕ делает:
 *   • Не читает куки сторонних сайтов (это и невозможно из браузера,
 *     и было бы нарушением 152-ФЗ).
 *   • Не делает скрытый pre-fill телефона/имени — все данные вводит
 *     сам пользователь, явно, в чате.
 *   • Не вызывает реальные БКИ из фронтенда.
 *   • Не запускает скоринг до получения согласия на ПДн.
 *
 * Что делает:
 *   1. Первым шагом показывает прозрачное согласие (152-ФЗ).
 *   2. Собирает анкету через стандартный qualification_schema.
 *   3. Считает мок-скоринг (low/medium/high) и показывает 2–4
 *      варианта офферов через карточку, зарегистрированную в
 *      Sensei.cards.register('prequalification', ...).
 *   4. После результатов — опциональная кнопка «Уточнить по
 *      кредитной истории», которая запускает отдельный flow с
 *      повторным согласием по 218-ФЗ.
 * ========================================================= */

(function () {
    'use strict';

    var ns = window.Sensei;
    var render = ns.render;
    var util = ns.util;
    var nlp = ns.nlp;
    var consent = ns.consent;

    // ----------------------------------------------------------------
    // Mock-скоринг.
    // Mock. Реальный скоринг — на бэкенде, после согласия и
    // идентификации, через API БКИ (см. core/api.js → getCreditScore).
    // ----------------------------------------------------------------
    function buildOffers(params, profile) {
        var amount = params.amount || 0;
        var termDays = params.termDays || 30;
        var monthlyIncome = profile.incomeMin || 0; // нижняя граница диапазона
        var employment = profile.employment || 'none';
        var overdue = profile.overdue || 'unknown';

        // Базовые правила (детерминированно, без рандома — чтобы UI был
        // воспроизводим в рамках одних и тех же ответов).
        var score = 60;
        // Доход vs запрашиваемая сумма
        if (monthlyIncome >= 100000) score += 20;
        else if (monthlyIncome >= 60000) score += 12;
        else if (monthlyIncome >= 30000) score += 5;
        else if (monthlyIncome > 0) score -= 5;
        else score -= 15;

        if (amount > 0 && monthlyIncome > 0 && amount > monthlyIncome * 3) score -= 12;

        // Занятость
        if (employment === 'employed') score += 10;
        else if (employment === 'self' || employment === 'ip') score += 4;
        else if (employment === 'pensioner') score += 2;
        else if (employment === 'none') score -= 18;

        // Просрочки за 12 мес
        if (overdue === 'no') score += 8;
        else if (overdue === 'yes') score -= 25;
        // 'unknown' — без штрафа, но и без бонуса

        // Срок: для PDL (≤30 дн) длинный срок снижает шансы на одобрение
        if (termDays > 60) score -= 5;

        var potential = score >= 75 ? 'high' : score >= 55 ? 'medium' : 'low';

        var offers = [];

        if (potential === 'high') {
            offers.push(makeOffer({
                kind: 'pdl',
                title: 'Займ «До зарплаты»',
                subtitle: 'Первый займ под 0%',
                amount: clamp(amount, 1000, 30000),
                termDays: Math.min(termDays, 30),
                rate: '0% (первый займ)',
                probability: Math.min(96, score + 12),
                badge: 'TOP',
            }));
            offers.push(makeOffer({
                kind: 'installment',
                title: 'Займ с выплатой по графику',
                subtitle: 'До 12 платежей, без штрафов',
                amount: clamp(amount, 5000, 100000),
                termDays: Math.max(termDays, 90),
                rate: '0,5% в день',
                probability: Math.min(92, score + 4),
            }));
            offers.push(makeOffer({
                kind: 'collateral',
                title: 'Займ под ПТС',
                subtitle: 'Если есть авто — выгоднее',
                amount: clamp(amount, 30000, 500000),
                termDays: 365,
                rate: 'от 3,9% в месяц',
                probability: Math.min(94, score + 6),
                optional: true,
            }));
        } else if (potential === 'medium') {
            offers.push(makeOffer({
                kind: 'pdl',
                title: 'Займ «До зарплаты»',
                subtitle: 'Уменьшенный лимит для нового клиента',
                amount: clamp(Math.min(amount, 15000), 1000, 15000),
                termDays: Math.min(termDays, 30),
                rate: '0,8% в день',
                probability: Math.max(45, Math.min(80, score + 5)),
            }));
            offers.push(makeOffer({
                kind: 'installment',
                title: 'Займ с графиком',
                subtitle: 'Меньше ежемесячный платёж',
                amount: clamp(Math.min(amount, 30000), 3000, 30000),
                termDays: Math.max(termDays, 90),
                rate: '0,7% в день',
                probability: Math.max(40, Math.min(75, score)),
            }));
            offers.push(makeOffer({
                kind: 'rehab',
                title: 'Прокачать кредитную историю',
                subtitle: '3 микрозайма по 3 000 ₽ → лимит до 50 000 ₽',
                amount: 3000,
                termDays: 30,
                rate: '0% (первый займ)',
                probability: 95,
                badge: 'РЕКОМЕНДУЕМ',
            }));
        } else {
            // potential === 'low'
            offers.push(makeOffer({
                kind: 'rehab',
                title: 'Программа «Реабилитация»',
                subtitle: 'Шанс одобрения сейчас низкий — начнём с малого',
                amount: 3000,
                termDays: 30,
                rate: '0% (первый займ)',
                probability: 90,
                badge: 'РЕКОМЕНДУЕМ',
            }));
            offers.push(makeOffer({
                kind: 'pdl',
                title: 'Микрозайм с пониженным лимитом',
                subtitle: 'Возможен отказ — но попробовать стоит',
                amount: 3000,
                termDays: 14,
                rate: '1% в день',
                probability: Math.max(25, Math.min(50, score + 10)),
            }));
        }

        // Маркируем общий потенциал — карточка использует это в шапке.
        offers.forEach(function (o) { o.potential = potential; });
        return offers;
    }

    function clamp(v, lo, hi) {
        if (!v || v < lo) return lo;
        if (v > hi) return hi;
        return v;
    }

    function makeOffer(o) {
        return {
            offer_id: 'prequal-' + o.kind + '-' + (o.amount || 0),
            category: 'prequalification',
            kind: o.kind,
            partner_id: 'vyruchai',
            partner_name: 'Выручай (предварительно)',
            partner_short: 'В',
            partner_color: '#3b2e8c',
            title: o.title,
            subtitle: o.subtitle,
            amount: o.amount,
            term_days: o.termDays,
            rate: o.rate,
            approval_probability: o.probability,
            badge: o.badge || null,
            optional: !!o.optional,
        };
    }

    ns.api.registerMockOffers('prequalification', buildOffers);

    // ----------------------------------------------------------------
    // Карточка оффера
    // ----------------------------------------------------------------
    var POTENTIAL_LABEL = {
        high:   { text: 'Высокий потенциал',  cls: '' },
        medium: { text: 'Средний потенциал',  cls: 'warn' },
        low:    { text: 'Сначала прокачка',   cls: 'danger' },
    };

    ns.cards.register('prequalification', function (o) {
        var card = document.createElement('div');
        card.className = 'offer-card';
        var potLabel = POTENTIAL_LABEL[o.potential] || POTENTIAL_LABEL.medium;
        card.innerHTML =
            '<div class="offer-card-head">' +
                '<div class="offer-logo" style="background:' + o.partner_color + '">' +
                    util.escapeHtml(o.partner_short) + '</div>' +
                '<div class="offer-name">' + util.escapeHtml(o.title) +
                    (o.badge ? ' <span class="offer-badge">' + util.escapeHtml(o.badge) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="offer-row"><span>' + util.escapeHtml(o.subtitle) + '</span>' +
                '<span class="offer-rate-badge ' + potLabel.cls + '">' +
                util.escapeHtml(potLabel.text) + '</span></div>' +
            '<div class="offer-amount">' + util.fmtMoney(o.amount) + '</div>' +
            '<div class="offer-row"><span>Срок</span><b>до ' + o.term_days + ' дн.</b></div>' +
            '<div class="offer-row"><span>Ставка</span><b>' + util.escapeHtml(o.rate) + '</b></div>' +
            ns.render.probabilityBlock(o.approval_probability) +
            '<button class="btn btn-primary" type="button">Подать заявку</button>';
        card.querySelector('button').addEventListener('click', function () {
            ns.handleApply(o);
        });
        return card;
    });

    // ----------------------------------------------------------------
    // Quick-reply шаблон
    // ----------------------------------------------------------------
    function qr(stepId, items) {
        return items.map(function (it) {
            return { label: it.label, payload: 'answer:' + stepId + ':' + it.value, variant: it.variant };
        });
    }

    // ----------------------------------------------------------------
    // Шаги схемы
    // ----------------------------------------------------------------

    // Текст согласия. Версия зашита в core/consent.js (CONSENT_VERSION).
    // При изменении формулировок — обновить версию там, иначе старые
    // согласия будут продолжать считаться валидными.
    var CONSENT_TEXT =
        'Чтобы подобрать предложения, я задам 8 коротких вопросов: ' +
        '<b>имя, телефон, сумма, срок, цель, доход, занятость, ' +
        'просрочки за 12 мес.</b><br><br>' +
        'Эти данные обрабатываются <b>МКК «Выручай»</b> на основании ' +
        'вашего согласия (152-ФЗ) <b>только для подбора предложений</b>, ' +
        'хранятся не дольше 30 дней и не передаются третьим лицам без ' +
        'отдельного согласия.<br><br>' +
        'Запрос <b>кредитной истории</b> в БКИ — отдельным шагом и ' +
        '<b>только после явного согласия</b> по 218-ФЗ.';

    var schema = [
        // ---------------- Шаг 0: согласие ----------------
        {
            id: 'consent',
            type: 'choice',
            intro: [CONSENT_TEXT],
            prompt: 'Готовы продолжить?',
            quickReplies: [
                { label: '✓ Согласен, продолжить',  payload: 'answer:consent:pdn',  variant: undefined },
                { label: 'Не сейчас',               payload: 'prequal:decline',     variant: 'ghost' },
            ],
            // Свободный текст на этом шаге не принимаем — нужен явный клик.
            parse: function () { return null; },
            errorPrompt: 'Чтобы продолжить, выберите один из вариантов на кнопках ниже 👇',
            applyToProfile: function (v, p) {
                p.consentPdn = (v === 'pdn');
                if (consent && p.consentPdn) consent.grantPdn();
            },
            skipIf: function (s) {
                // Если пользователь уже давал согласие в этом браузере — не спрашиваем снова.
                if (consent && consent.hasPdn()) {
                    s.answers.consent = 'pdn';
                    s.userProfile.consentPdn = true;
                    return true;
                }
                return false;
            },
        },

        // ---------------- Шаг 1: имя ----------------
        {
            id: 'name',
            type: 'text',
            intro: ['Спасибо! Начнём 🙏'],
            prompt: 'Как к вам обращаться? Достаточно имени.',
            parse: function (text) {
                var t = String(text).trim();
                // Только буквы (рус/лат), пробел, дефис; 2–40 символов;
                // не начинается и не заканчивается пробелом/дефисом.
                if (!/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{0,38}[A-Za-zА-Яа-яЁё]$/.test(t)) return null;
                return t;
            },
            errorPrompt: 'Имя содержит только буквы (например: «Алексей» или «Анна-Мария»). Попробуйте ещё раз.',
            applyToProfile: function (v, p) { p.name = v; },
        },

        // ---------------- Шаг 2: телефон ----------------
        {
            id: 'phone',
            type: 'text',
            prompt: 'Ваш номер телефона в формате <i>+7 999 123-45-67</i>. ' +
                    'Он нужен только для связи по заявке.',
            parse: function (text) {
                var digits = String(text).replace(/\D+/g, '');
                if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
                    return '+7' + digits.slice(1);
                }
                if (digits.length === 10 && digits[0] === '9') {
                    return '+7' + digits;
                }
                return null;
            },
            errorPrompt: 'Не похоже на российский мобильный. Пример: <i>+7 999 123-45-67</i>.',
            applyToProfile: function (v, p) { p.phone = v; },
        },

        // ---------------- Шаг 3: сумма ----------------
        {
            id: 'amount',
            type: 'number',
            prompt: 'Какая сумма нужна? Можно сказать «<i>30 тысяч</i>» или «<i>10к</i>».',
            quickReplies: qr('amount', [
                { label: '5 000 ₽',  value: '5000' },
                { label: '15 000 ₽', value: '15000' },
                { label: '30 000 ₽', value: '30000' },
                { label: '50 000 ₽', value: '50000' },
            ]),
            parse: function (text) { return nlp.parseAmount(text); },
            errorPrompt: 'Не уловил сумму 🤔 Попробуйте: «30 тысяч» или «50000».',
            validate: function (v) {
                if (v < 1000) return 'Минимальная сумма — 1 000 ₽.';
                if (v > 500000) return 'Сумма больше 500 000 ₽ — это уже потребкредит, а не займ.';
                return true;
            },
        },

        // ---------------- Шаг 4: срок ----------------
        {
            id: 'termDays',
            type: 'number',
            prompt: 'На какой срок?',
            quickReplies: qr('termDays', [
                { label: '7 дней',                value: '7' },
                { label: '14 дней',               value: '14' },
                { label: '30 дней (до зарплаты)', value: '30' },
                { label: '90 дней',               value: '90' },
            ]),
            parse: function (text) { return nlp.parseTerm(text); },
            errorPrompt: 'Не понял срок. Например: «на 14 дней» или «до зарплаты».',
        },

        // ---------------- Шаг 5: цель ----------------
        {
            id: 'purpose',
            type: 'choice',
            prompt: 'На что планируете потратить?',
            quickReplies: qr('purpose', [
                { label: 'До зарплаты', value: 'salary' },
                { label: 'Ремонт',      value: 'repair' },
                { label: 'Медицина',    value: 'medical' },
                { label: 'Другое',      value: 'other' },
            ]),
            parse: function (text) {
                var t = text.toLowerCase();
                if (/зарплат|получк|до получ/.test(t)) return 'salary';
                if (/ремонт|строй|стройк/.test(t)) return 'repair';
                if (/мед|лечен|больниц|зуб/.test(t)) return 'medical';
                return 'other';
            },
            applyToProfile: function (v, p) { p.purpose = v; },
        },

        // ---------------- Шаг 6: доход (диапазоны) ----------------
        {
            id: 'income',
            type: 'choice',
            prompt: 'Ваш ежемесячный доход (примерно)? Диапазона достаточно — точную сумму спрашивать не буду.',
            quickReplies: qr('income', [
                { label: 'до 30 000 ₽',         value: 'lt30k'   },
                { label: '30 000 – 60 000 ₽',   value: '30_60k'  },
                { label: '60 000 – 100 000 ₽',  value: '60_100k' },
                { label: 'более 100 000 ₽',     value: 'gt100k'  },
                { label: 'нет дохода',          value: 'none', variant: 'warn' },
            ]),
            parse: function (text) {
                var amount = nlp.parseAmount(text);
                if (amount == null) return null;
                if (amount < 30000) return 'lt30k';
                if (amount < 60000) return '30_60k';
                if (amount < 100000) return '60_100k';
                return 'gt100k';
            },
            errorPrompt: 'Выберите диапазон кнопкой или напишите примерную сумму, например «<i>50 тысяч</i>».',
            applyToProfile: function (v, p) {
                p.incomeBucket = v;
                p.incomeMin = ({ lt30k: 0, '30_60k': 30000, '60_100k': 60000, gt100k: 100000, none: 0 })[v] || 0;
            },
        },

        // ---------------- Шаг 7: занятость ----------------
        {
            id: 'employment',
            type: 'choice',
            prompt: 'Тип занятости?',
            quickReplies: qr('employment', [
                { label: 'Работаю по найму', value: 'employed' },
                { label: 'Самозанятый',      value: 'self' },
                { label: 'ИП',               value: 'ip' },
                { label: 'Пенсионер',        value: 'pensioner' },
                { label: 'Без оформления',   value: 'none', variant: 'warn' },
            ]),
            parse: function (text) {
                var t = text.toLowerCase();
                if (/найм|работа|оформл/.test(t)) return 'employed';
                if (/самозанят|нпд/.test(t)) return 'self';
                if (/\bип\b|предпринимат/.test(t)) return 'ip';
                if (/пенс/.test(t)) return 'pensioner';
                if (/нет|без|неофициал/.test(t)) return 'none';
                return null;
            },
            errorPrompt: 'Выберите вариант на кнопках ниже 👇',
            applyToProfile: function (v, p) { p.employment = v; },
        },

        // ---------------- Шаг 8: просрочки ----------------
        {
            id: 'overdue12m',
            type: 'choice',
            prompt: 'За последние 12 месяцев были просрочки по кредитам/займам?',
            quickReplies: qr('overdue12m', [
                { label: 'Нет',       value: 'no' },
                { label: 'Да',        value: 'yes', variant: 'warn' },
                { label: 'Не знаю',   value: 'unknown' },
            ]),
            parse: function (text) {
                var t = text.toLowerCase();
                if (/нет|без|чисто/.test(t)) return 'no';
                if (/да|был|есть|прос/.test(t)) return 'yes';
                if (/не знаю|незна|хз/.test(t)) return 'unknown';
                return null;
            },
            applyToProfile: function (v, p) { p.overdue = v; },
        },
    ];

    // ----------------------------------------------------------------
    // Завершение flow: показ офферов + кнопка БКИ
    // ----------------------------------------------------------------
    function onComplete(answers, profile, state) {
        // Сохраняем прогресс — на случай перезагрузки в момент рендера офферов.
        // (Реальное использование сохранения — на следующих шагах квиза.)
        if (consent) consent.clearQuizProgress();

        var potentialMsg = 'Готово! Анализирую ответы…';
        render.senseiSays(
            [potentialMsg, 'Вот ваши варианты:'],
            {
                then: function () {
                    ns.api.getOffers('prequalification', answers, profile).then(function (offers) {
                        render.renderOffers('prequalification', offers);
                        render.showAchievement('🎯', 'Пред-квалификация пройдена');

                        // Подсказка по точности: можно уточнить через БКИ.
                        var nextActions = [
                            { label: '🔍 Уточнить по кредитной истории', payload: 'prequal:bki:start' },
                            { label: '🔄 Пройти заново',                 payload: 'prequal:retry' },
                            { label: '⬅ В меню',                          payload: 'menu' },
                        ];
                        render.senseiSays(
                            'Это <b>предварительная</b> оценка по вашей анкете. ' +
                            'Чтобы уточнить шанс одобрения, можно посмотреть ' +
                            'вашу кредитную историю — это <b>отдельный шаг</b> ' +
                            'и потребует ещё одного согласия (218-ФЗ).',
                            { quickReplies: nextActions }
                        );

                        // Сбрасываем flow.
                        state.category = null;
                    });
                },
            }
        );
    }

    ns.flows.register('prequalification', {
        schema: schema,
        onComplete: onComplete,
        intro: [
            'Это <b>квиз пред-квалификации</b>. За минуту покажу, какие ' +
            'варианты займа вам, скорее всего, доступны — без запроса в БКИ.',
        ],
    });

    // ----------------------------------------------------------------
    // Опциональный flow «Запрос кредитной истории»
    // (отдельный экран, отдельное согласие, без сохранения данных)
    // ----------------------------------------------------------------
    function startBkiFlow() {
        // Принудительно выходим из любого активного flow.
        ns.resetFlow();
        render.clearQuickReplies();

        var bkiText =
            'Запрос кредитной истории — это <b>отдельная операция</b> по 218-ФЗ ' +
            '«О кредитных историях». Я отправлю в БКИ (НБКИ/ОКБ) ваши: ' +
            '<b>ФИО, дату рождения, паспорт, код субъекта КИ</b>. ' +
            'Цель — уточнить шанс одобрения. ' +
            'Запрос мягкий — на ваш скоринговый балл это не повлияет.<br><br>' +
            '<i>В этом прототипе данные никуда не отправляются и не сохраняются — ' +
            'это демонстрационный вызов.</i>';

        render.senseiSays([bkiText, 'Согласны на запрос?'], {
            quickReplies: [
                { label: '✓ Согласен, запросить', payload: 'prequal:bki:confirm' },
                { label: 'Не сейчас',              payload: 'menu', variant: 'ghost' },
            ],
        });
    }

    function runBkiInquiry() {
        // В прототипе — НЕ собираем реальные паспортные данные через чат.
        // Симулируем вызов и показываем результат.
        // TODO (прод): открыть отдельную защищённую форму в ЛК (Magic-Link),
        // где Smart Engines сканирует паспорт; данные уходят на бэкенд, не
        // в чат. Чат показывает только итог.
        if (consent) consent.grantBki();

        render.senseiSays(
            ['Запрашиваю мок-данные у БКИ… 🔍'],
            {
                then: function () {
                    ns.api.getCreditScore({ session_id: ns.state.sessionId }).then(function (res) {
                        var grade = util.escapeHtml(res.grade);
                        var score = res.score;
                        var verdict =
                            res.grade === 'A' ? 'Отличная история — одобрят почти везде.' :
                            res.grade === 'B' ? 'Хорошая история — одобрят в большинстве МФО/банков.' :
                            res.grade === 'C' ? 'Средняя история — выбор офферов будет уже.' :
                            'История ниже среднего — рекомендую программу «Реабилитация».';

                        render.senseiSays(
                            [
                                'Готово. Это <b>демо-результат</b> (мок):',
                                '<b>Скор:</b> ' + score + '<br><b>Категория:</b> ' + grade +
                                '<br>' + verdict,
                            ],
                            {
                                quickReplies: [
                                    { label: '🔄 Пройти квиз заново', payload: 'prequal:retry' },
                                    { label: '⬅ В меню',               payload: 'menu' },
                                ],
                            }
                        );
                    });
                },
            }
        );
    }

    // ----------------------------------------------------------------
    // Payload-обработчики для меню/кнопок результатов
    // ----------------------------------------------------------------
    ns.registerPayload('prequal:decline', function () {
        ns.resetFlow();
        render.senseiSays(
            'Хорошо, без согласия квиз не запускается. Вы можете вернуться к нему в любой момент.',
            { quickReplies: [{ label: '⬅ В меню', payload: 'menu' }] }
        );
    });

    ns.registerPayload('prequal:retry', function () {
        // Перезапуск с нуля. Согласие на ПДн уже дано — шаг consent скипнется.
        ns.resetFlow();
        ns.flows.start('prequalification');
    });

    ns.registerPayload('prequal:bki:start',   startBkiFlow);
    ns.registerPayload('prequal:bki:confirm', runBkiInquiry);
})();
