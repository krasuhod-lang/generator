/* =========================================================
 * app.js — bootstrap «Выручай-Сенсея» v2.
 *
 * После рефакторинга это тонкий слой, который:
 *   1. Связывает DOM-элементы виджета с обработчиками.
 *   2. Маршрутизирует payload'ы quick-reply в активный flow или
 *      сервисные действия (menu, restart, magic-link, rehab, faq).
 *   3. Обрабатывает свободный текст (NLP → flow или FAQ).
 *
 * Архитектура (см. план Phase 0):
 *   core/state.js   — состояние + session_id
 *   core/util.js    — форматирование/escape/аннуитет
 *   core/render.js  — DOM-операции (баблы, typing, карусель, ачивки)
 *   core/dialog.js  — schema-driven движок шагов
 *   core/nlp.js     — rule-based NLP (intent, parseAmount/Term)
 *   core/api.js     — фасад брокериджа (mock ⇄ /api/v1/offers)
 *   core/kb.js      — mock-RAG (знания)
 *   categories/<x>.js — qualification_schema + mock-офферы + карточка
 *
 * Соответствует ТЗ:
 *   §1.8  — главное меню v2 на 9 пунктов
 *   §2.1  — системный промпт (зашит в комментариях категорий и api.js)
 *   §3.1  — формат запроса/ответа /api/v1/offers
 *   §3.2  — Magic-Link, отказ от паспорта в чате
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});
    var render = ns.render;
    var flows = ns.flows;
    var nlp = ns.nlp;
    var util = ns.util;

    // ---------- DOM ----------
    var launcher    = document.getElementById('sensei-launcher');
    var fab         = document.getElementById('sensei-fab');
    var bubble      = document.getElementById('sensei-bubble');
    var bubbleClose = document.getElementById('sensei-bubble-close');
    var openCta     = document.getElementById('open-chat-cta');
    var chatWindow  = document.getElementById('chat-window');
    var chatBody    = document.getElementById('chat-body');
    var chatForm    = document.getElementById('chat-form');
    var chatInput   = document.getElementById('chat-input');
    var chatClose   = document.getElementById('chat-close');

    // =========================================================
    // Главное меню v2 (ТЗ §1.8)
    // =========================================================
    var MAIN_MENU = [
        { label: '🎯 Узнать шансы за 1 минуту', payload: 'cat:prequalification' },
        { label: '💰 Займ (до 500К)',     payload: 'cat:loan' },
        { label: '🏦 Кредит наличными',   payload: 'cat:credit' },
        { label: '🏠 Ипотека',            payload: 'cat:mortgage' },
        { label: '💳 Кредитная карта',    payload: 'cat:card' },
        { label: '🛡️ Страхование',        payload: 'cat:insurance' },
        { label: '📈 Вклад / накопления', payload: 'cat:deposit' },
        { label: '🔄 Рефинансирование',   payload: 'cat:refinancing' },
        { label: '📈 Прокачать КИ',       payload: 'start_rehab' },
        { label: '❓ Вопрос',              payload: 'start_faq' },
    ];

    function showMainMenu(intro) {
        var msgs = intro || ['Чем могу помочь? Выберите раздел или просто напишите своими словами.'];
        render.senseiSays(msgs, { quickReplies: MAIN_MENU });
    }

    /** Стартовое приветствие. */
    function startGreeting() {
        if (chatBody.childElementCount > 0) return; // уже здоровались
        render.senseiSays(
            [
                'Здравствуйте! Я <b>Сенсей</b> 🥋 — ваш проводник на пути к финансовому дзену.',
                'Я подбираю <b>займы, кредиты, ипотеку, карты, страхование, вклады и рефинансирование</b> ' +
                'среди банков-партнёров, отвечаю на вопросы о сервисе «Выручай».',
                'С чего начнём?',
            ],
            { quickReplies: MAIN_MENU }
        );
    }

    // =========================================================
    // Magic-link (ТЗ §3.2 / §3.4)
    // =========================================================
    /**
     * Унифицированный обработчик "Оформить" для оффера любой категории.
     * Карточки категорий вызывают Sensei.handleApply(offer, options).
     */
    function handleApply(offer, options) {
        options = options || {};
        var displayName = offer.partner_name || offer.partner_id || 'Партнёр';
        render.addUserMessage('Оформить: ' + displayName);
        render.clearQuickReplies();

        ns.api.getMagicLink(offer).then(function (link) {
            var url = link.url;
            render.senseiSays(
                [
                    options.successMessage || 'Превосходный выбор! 🎌',
                    'Я сгенерировал для вас <b>защищённую ссылку</b>. По ней вы попадёте в ' +
                    '<b>личный кабинет «Выручай»</b>, где:<br>' +
                    '• отсканируете паспорт через Smart Engines (~30 сек)<br>' +
                    '• подпишете договор СМС-кодом<br>' +
                    '• ' + (options.lastStep || 'получите деньги на карту'),
                    '<a href="' + util.escapeHtml(url) + '" target="_blank" rel="noopener" ' +
                    'class="magic-link-btn">→ Перейти в защищённый ЛК</a>',
                ],
                { then: function () { render.showAchievement('🚀', 'Готов к оформлению'); } }
            );
        });
    }
    ns.handleApply = handleApply;

    // =========================================================
    // Реабилитация КИ — сохраняем функционал Sprint 1
    // =========================================================
    function startRehab() {
        ns.resetFlow();
        render.senseiSays(
            [
                'Не переживайте — путь к финансовому Дзену доступен каждому 🧘',
                'Ваш текущий статус: <b>' + util.escapeHtml(ns.state.level) + '</b>. ' +
                'Если возьмёте микро-займ на <b>3 000 ₽</b> и отдадите его вовремя, ' +
                'ваш рейтинг повысится, и в следующий раз одобрят до <b>15 000 ₽</b>.',
                'Начинаем путь к финансовому Дзену?',
            ],
            {
                quickReplies: [
                    { label: '🥋 Да, в путь!',     payload: 'rehab_start' },
                    { label: 'Расскажи подробнее', payload: 'rehab_info' },
                    { label: 'Может, позже',       payload: 'menu' },
                ],
            }
        );
    }

    // =========================================================
    // Маршрутизация payload'ов от quick-replies
    // =========================================================
    function dispatchPayload(payload, label) {
        // 1) Ответ на текущий шаг flow: answer:<stepId>:<value>
        if (payload.indexOf('answer:') === 0) {
            if (flows.handleAnswerPayload(payload)) return;
        }

        // 2) Старт категории: cat:<name>
        if (payload.indexOf('cat:') === 0) {
            var category = payload.slice(4);
            return flows.start(category);
        }

        // 3) Сервисные действия
        switch (payload) {
            case 'menu':
                ns.resetFlow();
                return showMainMenu(['Возвращаемся в главное меню.']);
            case 'restart':
                ns.resetFlow();
                return showMainMenu(['Начинаем заново. С чего продолжим?']);
            case 'start_faq':
                return render.senseiSays(
                    'Спросите что угодно про займы, кредиты, ипотеку, карты, страхование, ' +
                    'вклады или КИ — отвечу из базы знаний «Выручай».',
                    { quickReplies: [{ label: '⬅ В меню', payload: 'menu' }] }
                );
            case 'start_rehab':
                return startRehab();
            case 'rehab_start':
                // Запускаем стандартный loan flow с предзаполненными ответами
                ns.resetFlow();
                ns.state.category = 'loan';
                ns.state.answers = { amount: 3000, termDays: 30 };
                ns.state.userProfile.overdue = 'lt30';
                ns.state.userProfile.age = 30;
                ns.state.userProfile.employment = 'employed';
                var loanDef = flows.get('loan');
                if (loanDef) {
                    // Перепрыгиваем к концу схемы и завершаем flow
                    ns.state.schemaStep = loanDef.schema.length;
                    render.showAchievement('🌱', 'Начало пути');
                    loanDef.onComplete(ns.state.answers, ns.state.userProfile, ns.state);
                }
                return;
            case 'rehab_info':
                return render.senseiSays(
                    'Программа простая: 3 микро-займа по 3 000 ₽, каждый возвращён вовремя. ' +
                    'После каждого — повышение рейтинга и рост лимита. За 3 месяца выйдете ' +
                    'в категорию <b>Самурай</b> с лимитом до 50 000 ₽.',
                    { quickReplies: [{ label: '🥋 Хорошо, начинаем', payload: 'rehab_start' }] }
                );
            case 'pay_link':
                return render.senseiSays(
                    'Держите: <a href="/lk/pay" target="_blank" rel="noopener">кабинет → Погашение</a>. ' +
                    'Если что — я рядом 🥋'
                );
            case 'operator':
                return render.senseiSays(
                    'Перевожу на <b>оператора</b>. Среднее время ответа — ~2 минуты. ' +
                    'Я останусь рядом, если понадоблюсь снова 🥋'
                );
            default:
                // Возможно категория зарегистрировала собственный payload (например, калькулятор)
                if (ns.payloadHandlers && ns.payloadHandlers[payload]) {
                    return ns.payloadHandlers[payload](label);
                }
                return render.senseiSays('Хм, не понял команду. Можете спросить иначе?', {
                    quickReplies: [{ label: '⬅ В меню', payload: 'menu' }],
                });
        }
    }
    ns.dispatchPayload = dispatchPayload;
    // ns.payloadHandlers и ns.registerPayload уже инициализированы в core/dialog.js
    // (нужны категориям, которые загружаются до app.js).

    // =========================================================
    // Свободный текст
    // =========================================================
    function handleUserText(text) {
        render.addUserMessage(text);
        render.clearQuickReplies();

        // Если внутри активного flow — отдадим текст движку шагов
        if (ns.state.category && flows.get(ns.state.category)) {
            // Сначала — попытка обработать FAQ-вопрос «вне flow» (если совпал триггер)
            var maybeFaq = ns.kb.find(text, ns.state.category);
            if (maybeFaq && /(\?|как |почему|что |когда |можно)/.test(text.toLowerCase())) {
                return render.senseiSays(maybeFaq.answer, {
                    quickReplies: maybeFaq.followUp ? [maybeFaq.followUp] : null,
                });
            }
            if (flows.handleText(text)) return;
        }

        var intent = nlp.detectIntent(text);

        if (intent === 'greeting') {
            return render.senseiSays('И вам доброго дня 🙏 Чем помочь?', { quickReplies: MAIN_MENU });
        }
        if (intent === 'thanks') {
            return render.senseiSays('Это мой путь 🥋 Обращайтесь в любое время.');
        }
        if (intent === 'bye') {
            return render.senseiSays('Доброй дороги! Ваш дзен ждёт ✨');
        }
        if (intent === 'menu') {
            return showMainMenu();
        }
        if (intent.indexOf('category:') === 0) {
            var cat = intent.slice('category:'.length);
            // Если в тексте есть сумма/срок — предзаполним userProfile/answers через flow
            ns.state.preFill = {
                amount: nlp.parseAmount(text),
                termDays: nlp.parseTerm(text),
            };
            return flows.start(cat);
        }
        if (intent === 'faq') {
            var item = ns.kb.find(text);
            if (item) {
                return render.senseiSays(item.answer, {
                    quickReplies: item.followUp ? [item.followUp] : null,
                });
            }
        }

        // Неизвестный интент — по правилам ТЗ §2.1 предлагаем оператора
        return render.senseiSays(
            'Не нашёл точного ответа в базе знаний — а в финансах я не имею права ' +
            'выдумывать. Хотите, переведу на <b>оператора</b>?',
            {
                quickReplies: [
                    { label: 'Да, оператора', payload: 'operator' },
                    { label: '⬅ В меню',      payload: 'menu' },
                ],
            }
        );
    }

    // =========================================================
    // Открытие/закрытие виджета
    // =========================================================
    function openChat() {
        chatWindow.hidden = false;
        bubble.classList.add('hidden');
        launcher.style.display = 'none';
        setTimeout(function () { chatInput.focus(); }, 100);
        startGreeting();
    }
    function closeChat() {
        chatWindow.hidden = true;
        launcher.style.display = '';
        // Останавливаем все анимации (например, тикер вкладов)
        if (ns.tickers && typeof ns.tickers.stopAll === 'function') ns.tickers.stopAll();
    }

    // =========================================================
    // Биндинги
    // =========================================================
    fab.addEventListener('click', openChat);
    openCta.addEventListener('click', openChat);
    chatClose.addEventListener('click', closeChat);
    bubbleClose.addEventListener('click', function (e) {
        e.stopPropagation();
        bubble.classList.add('hidden');
    });

    chatForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        handleUserText(text);
    });

    // Авто-показ бейджа-подсказки через 2.5 сек после загрузки
    bubble.classList.add('hidden');
    setTimeout(function () { bubble.classList.remove('hidden'); }, 2500);

    // Cookie-баннер (152-ФЗ): показывается, если пользователь ещё не сделал выбор.
    if (ns.consent && typeof ns.consent.initCookieBanner === 'function') {
        ns.consent.initCookieBanner();
    }

    // Экспорт для отладки и обратной совместимости со Sprint 1
    window.__sensei = ns;
})();
