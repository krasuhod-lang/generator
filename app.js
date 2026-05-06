/* =========================================================
 * «Выручай-Сенсей» — клиентский скрипт прототипа
 *
 * Архитектура (соответствует ТЗ §3.1):
 *   - Rule-based движок диалога (детерминированные сценарии)
 *   - Лёгкий NLP-парсер (regex по интентам)
 *   - Mock-RAG: статичная база знаний по viruchay.ru
 *   - Mock-API брокериджа: возвращает массив офферов
 *   - Magic-link редирект в защищённый контур (вместо сбора паспорта)
 *
 * ВАЖНО: соответствует системному промпту из ТЗ §3.2:
 *   - никогда не обещать 100% одобрения
 *   - ответы по продукту — только из RAG, иначе оператор
 *   - после сбора {сумма, срок, просрочки} вызвать get_loan_offers()
 * ========================================================= */

(function () {
    'use strict';

    // ---------- DOM ----------
    const launcher       = document.getElementById('sensei-launcher');
    const fab            = document.getElementById('sensei-fab');
    const bubble         = document.getElementById('sensei-bubble');
    const bubbleClose    = document.getElementById('sensei-bubble-close');
    const openCta        = document.getElementById('open-chat-cta');
    const chatWindow     = document.getElementById('chat-window');
    const chatBody       = document.getElementById('chat-body');
    const chatForm       = document.getElementById('chat-form');
    const chatInput      = document.getElementById('chat-input');
    const chatClose      = document.getElementById('chat-close');
    const quickReplies   = document.getElementById('quick-replies');
    const levelName      = document.getElementById('level-name');

    // ---------- Состояние диалога ----------
    /**
     * @typedef {Object} DialogState
     * @property {'idle'|'await_amount'|'await_term'|'await_overdue'|'await_age'|'await_employment'|'offers_shown'|'rehab'} step
     * @property {number|null} amount     - сумма займа в рублях
     * @property {number|null} termDays   - срок в днях
     * @property {'none'|'lt30'|'gt90'|null} overdue
     * @property {number|null} age
     * @property {'employed'|'self'|'none'|null} employment
     * @property {string} level           - уровень геймификации
     * @property {Set<string>} achievements
     */
    const state = {
        step: 'idle',
        amount: null,
        termDays: null,
        overdue: null,
        age: null,
        employment: null,
        level: 'Ученик',
        achievements: new Set(),
    };

    // =========================================================
    // База знаний (RAG-mock) — §3.3
    // =========================================================
    const KNOWLEDGE_BASE = [
        {
            keys: ['досрочн', 'погас', 'вернуть раньше'],
            answer:
                'Вы можете погасить займ досрочно <b>без штрафов</b> через личный ' +
                'кабинет на сайте, в мобильном приложении или терминалах РНКБ. ' +
                'Пересчёт процентов произойдёт автоматически за фактические дни.',
            followUp: { label: 'Дать ссылку на оплату', payload: 'pay_link' },
        },
        {
            keys: ['ставк', 'процент', 'переплат'],
            answer:
                'Ставка по займам в «Выручай» — <b>от 0,11% до 0,8% в день</b>. ' +
                'Для новых клиентов первый займ возможен под <b>0%</b>.',
        },
        {
            keys: ['сумм', 'сколько мож', 'максимальн', 'до скольки'],
            answer:
                'Сумма займа — <b>от 20 000 ₽ до 500 000 ₽</b>. ' +
                'Крупные суммы доступны под залог ПТС.',
        },
        {
            keys: ['требован', 'кому даёте', 'кому дают', 'возраст', 'гражданств'],
            answer:
                'Требования к заёмщику:<br>• Гражданство РФ<br>• Возраст 18–70 лет' +
                '<br>• Действующий паспорт<br>• Постоянный источник дохода',
        },
        {
            keys: ['как получ', 'выдач', 'на карт', 'налично'],
            answer:
                'Деньги можно получить <b>на банковскую карту</b> (мгновенно) ' +
                'или <b>наличными</b> в офисе партнёра.',
        },
        {
            keys: ['кредитн', 'историю', 'ки ', 'рейтинг', 'скоринг'],
            answer:
                'Кредитная история — это ваш «финансовый дзен» 🧘 Каждый ' +
                'вовремя погашенный займ повышает рейтинг. Если КИ испорчена — ' +
                'у меня есть <b>Программа реабилитации</b>.',
            followUp: { label: 'Программа реабилитации', payload: 'start_rehab' },
        },
        {
            keys: ['паспорт', 'документ', 'скан'],
            answer:
                'Паспортные данные я <b>никогда не запрашиваю в чате</b> — это ' +
                'небезопасно. Скан паспорта вы загружаете в защищённом личном ' +
                'кабинете через Smart Engines, договор подписывается СМС-кодом.',
        },
        {
            keys: ['оператор', 'человек', 'позвон', 'колл-центр', 'менеджер'],
            answer:
                'Конечно, переключаю вас на оператора. Среднее время ответа — ' +
                '~2 минуты. Я останусь рядом, если понадоблюсь снова 🥋',
        },
    ];

    // =========================================================
    // Mock-API брокериджа — §3.1, get_loan_offers()
    // =========================================================
    const MFO_PARTNERS = [
        { name: 'МКК «Выручай-деньги»', short: 'ВД', color: '#3b2e8c' },
        { name: 'БыстроКредит',         short: 'БК', color: '#18b86b' },
        { name: 'ДеньгиЛегко',          short: 'ДЛ', color: '#5b46d6' },
        { name: 'ФинансПлюс',           short: 'Ф+', color: '#f5a524' },
        { name: 'КредитДом',            short: 'КД', color: '#0ea5e9' },
    ];

    /**
     * Mock-вычисление скоринга. В проде — вызов API брокериджа.
     * @returns {Array<Object>} топ-3 оффера, отсортированных по вероятности
     */
    function getLoanOffers({ amount, termDays, overdue, age, employment }) {
        // Базовый «балл» от 0 до 100
        let baseScore = 85;
        if (overdue === 'lt30') baseScore -= 15;
        if (overdue === 'gt90') baseScore -= 40;
        if (employment === 'self') baseScore -= 5;
        if (employment === 'none') baseScore -= 25;
        if (age && (age < 21 || age > 65)) baseScore -= 10;
        if (amount > 100000) baseScore -= 5;

        const rates = ['Первый займ под 0%', '0,8% в день', '0,5% в день', '0,11% в день'];

        return MFO_PARTNERS.slice(0, 3).map((mfo, idx) => {
            const jitter = [0, -7, -12][idx]; // лидер выше, остальные ниже
            const probability = Math.max(35, Math.min(98, baseScore + jitter));
            return {
                mfo,
                amount,
                termDays,
                rate: idx === 0 ? rates[0] : rates[idx + 1] || '0,5% в день',
                probability,
            };
        });
    }

    // =========================================================
    // NLP-парсер интентов — лёгкая замена LLM для прототипа
    // =========================================================
    /**
     * Грубо распознаёт сумму займа в рублях из свободного текста.
     * Поддерживает: "30 тысяч", "10к", "десятку", "50000".
     */
    function parseAmount(text) {
        const t = text.toLowerCase().replace(/\s+/g, ' ');

        // словарь чисел-словами
        const wordMap = {
            'десятк': 10000, 'двадцатк': 20000, 'тридцатк': 30000,
            'полтинник': 50000, 'сотк': 100000, 'сотн': 100000,
        };
        for (const w in wordMap) if (t.includes(w)) return wordMap[w];

        // «N тысяч / тыс / к / k»
        let m = t.match(/(\d+(?:[.,]\d+)?)\s*(тысяч|тыс\.?|к|k)\b/);
        if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000);

        // «N рублей» или просто число >= 1000
        m = t.match(/(\d{4,7})\s*(р|руб|₽)?/);
        if (m) return parseInt(m[1], 10);

        return null;
    }

    /** Парсит срок в днях из текста ("до зарплаты", "на месяц", "на 14 дней"). */
    function parseTerm(text) {
        const t = text.toLowerCase();
        if (/до\s+(зарплат|получк)/.test(t)) return 30;
        if (/(месяц|30 дн)/.test(t))         return 30;
        if (/(недел|7 дн)/.test(t))          return 7;
        if (/(2 недел|14 дн|полмесяц)/.test(t)) return 14;
        const m = t.match(/(\d+)\s*(дн|день|дня|дней)/);
        if (m) return parseInt(m[1], 10);
        const months = t.match(/(\d+)\s*(месяц|мес)/);
        if (months) return parseInt(months[1], 10) * 30;
        return null;
    }

    /** Распознаёт верхнеуровневый интент пользователя. */
    function detectIntent(text) {
        const t = text.toLowerCase();
        if (/(нужн|хоч|дай|возьм|оформ).*(деньг|займ|кредит|тысяч|руб|\d{3,})/.test(t)
            || parseAmount(t) !== null) return 'loan_request';
        if (/(привет|здравствуй|добр|хай|hi|hello)/.test(t)) return 'greeting';
        if (/(спасибо|благодар)/.test(t)) return 'thanks';
        if (/(пока|до свидан|bye)/.test(t)) return 'bye';
        for (const item of KNOWLEDGE_BASE) {
            if (item.keys.some((k) => t.includes(k))) return 'faq';
        }
        return 'unknown';
    }

    function findFaq(text) {
        const t = text.toLowerCase();
        return KNOWLEDGE_BASE.find((item) => item.keys.some((k) => t.includes(k))) || null;
    }

    // =========================================================
    // Утилиты UI
    // =========================================================
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtMoney(n) {
        return n.toLocaleString('ru-RU') + ' ₽';
    }

    function nowTime() {
        const d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function scrollToBottom() {
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    // ---------- Сообщения ----------
    /** Добавляет бабл сообщения. `html` — уже безопасный HTML (либо предварительно escape). */
    function addBubble(html, who /* 'bot' | 'user' */) {
        const el = document.createElement('div');
        el.className = 'bubble ' + who;
        el.innerHTML = html + '<span class="meta">' + nowTime() + '</span>';
        chatBody.appendChild(el);
        scrollToBottom();
        return el;
    }

    function addUserMessage(text) {
        addBubble(escapeHtml(text), 'user');
    }

    /** Печатает несколько сообщений Сенсея с эффектом "печатает...". */
    function senseiSays(messages, opts = {}) {
        return new Promise((resolve) => {
            const list = Array.isArray(messages) ? messages : [messages];
            let i = 0;
            const next = () => {
                if (i >= list.length) {
                    if (opts.quickReplies) renderQuickReplies(opts.quickReplies);
                    if (opts.then) opts.then();
                    return resolve();
                }
                showTyping();
                const delay = Math.min(900, 250 + list[i].length * 12);
                setTimeout(() => {
                    hideTyping();
                    addBubble(list[i], 'bot');
                    i++;
                    next();
                }, delay);
            };
            next();
        });
    }

    let typingEl = null;
    function showTyping() {
        if (typingEl) return;
        typingEl = document.createElement('div');
        typingEl.className = 'typing';
        typingEl.innerHTML = '<span></span><span></span><span></span>';
        chatBody.appendChild(typingEl);
        scrollToBottom();
    }
    function hideTyping() {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        typingEl = null;
    }

    // ---------- Быстрые ответы ----------
    /**
     * @param {Array<{label:string, payload:string, variant?:'danger'|'warn'}>} items
     */
    function renderQuickReplies(items) {
        quickReplies.innerHTML = '';
        if (!items || !items.length) return;
        for (const item of items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'qr-btn' + (item.variant ? ' ' + item.variant : '');
            btn.textContent = item.label;
            btn.addEventListener('click', () => {
                clearQuickReplies();
                addUserMessage(item.label);
                handlePayload(item.payload, item.label);
            });
            quickReplies.appendChild(btn);
        }
    }
    function clearQuickReplies() { quickReplies.innerHTML = ''; }

    // ---------- Карусель офферов ----------
    function renderOffers(offers) {
        const wrap = document.createElement('div');
        wrap.className = 'offers-carousel';

        for (const o of offers) {
            const probClass = o.probability >= 85 ? '' : (o.probability >= 65 ? 'warn' : 'danger');
            const card = document.createElement('div');
            card.className = 'offer-card';
            card.innerHTML = `
                <div class="offer-card-head">
                    <div class="offer-logo" style="background:${o.mfo.color}">${escapeHtml(o.mfo.short)}</div>
                    <div class="offer-name">${escapeHtml(o.mfo.name)}</div>
                </div>
                <div class="offer-amount">${fmtMoney(o.amount)}</div>
                <div class="offer-row"><span>Срок</span><b>до ${o.termDays} дн.</b></div>
                <div class="offer-row"><span>Ставка</span><span class="offer-rate-badge">${escapeHtml(o.rate)}</span></div>
                <div>
                    <div class="offer-prob-label">
                        <span>Шанс одобрения</span>
                        <span class="pct ${probClass}">${o.probability}%</span>
                    </div>
                    <div class="bar"><div class="bar-fill ${probClass}" style="width:${o.probability}%"></div></div>
                </div>
                <button class="btn btn-primary" data-mfo="${escapeHtml(o.mfo.name)}">Оформить в 1 клик</button>
            `;
            card.querySelector('button').addEventListener('click', () => {
                handleApply(o);
            });
            wrap.appendChild(card);
        }
        chatBody.appendChild(wrap);
        scrollToBottom();
    }

    // ---------- Геймификация: ачивки и уровни ----------
    function showAchievement(icon, title) {
        if (state.achievements.has(title)) return;
        state.achievements.add(title);
        const el = document.createElement('div');
        el.className = 'achievement';
        el.innerHTML = `<span class="ach-icon">${icon}</span> Ачивка получена: <b>${escapeHtml(title)}</b>`;
        chatBody.appendChild(el);
        scrollToBottom();
    }

    function setLevel(level, icon) {
        state.level = level;
        levelName.textContent = level;
        // Обновим иконку рядом
        const iconEl = levelName.parentElement.querySelector('.level-icon');
        if (iconEl && icon) iconEl.textContent = icon;
    }

    // =========================================================
    // Главный обработчик: сценарии диалога
    // =========================================================

    /** Стартовое приветствие (сценарий №1, шаг 0). */
    function startGreeting() {
        if (chatBody.childElementCount > 0) return; // уже здоровались
        senseiSays(
            [
                'Здравствуйте! Я <b>Сенсей</b> 🥋 — ваш проводник на пути к финансовому дзену.',
                'Я помогу подобрать займ среди <b>40+ МФО-партнёров</b> или отвечу на вопросы о сервисе «Выручай». С чего начнём?',
            ],
            {
                quickReplies: [
                    { label: '💰 Нужны деньги',       payload: 'start_loan' },
                    { label: '❓ Задать вопрос',       payload: 'start_faq' },
                    { label: '📈 Прокачать КИ',        payload: 'start_rehab' },
                ],
            }
        );
    }

    /** Запрос суммы (если пользователь не указал её сразу). */
    function askAmount() {
        state.step = 'await_amount';
        senseiSays('Сколько вам нужно? Можно сказать просто: «<i>30 тысяч</i>» или «<i>10к</i>».', {
            quickReplies: [
                { label: '5 000 ₽',  payload: 'amount:5000' },
                { label: '15 000 ₽', payload: 'amount:15000' },
                { label: '30 000 ₽', payload: 'amount:30000' },
                { label: '50 000 ₽', payload: 'amount:50000' },
            ],
        });
    }

    /** Запрос срока. */
    function askTerm() {
        state.step = 'await_term';
        senseiSays('На какой срок? До зарплаты, на пару недель?', {
            quickReplies: [
                { label: '7 дней',  payload: 'term:7' },
                { label: '14 дней', payload: 'term:14' },
                { label: '30 дней (до зарплаты)', payload: 'term:30' },
            ],
        });
    }

    /** Шаг 3 ТЗ — микро-скоринг через диалог: вопрос про просрочки. */
    function askOverdue() {
        state.step = 'await_overdue';
        senseiSays(
            'Отличная цель. Чтобы я подобрал предложения, где вам <b>точно не откажут</b>, ' +
            'уточните: у вас есть текущие просрочки по кредитам?',
            {
                quickReplies: [
                    { label: 'Нет просрочек',           payload: 'overdue:none' },
                    { label: 'Есть, до 30 дней',        payload: 'overdue:lt30',  variant: 'warn' },
                    { label: 'Есть, более 90 дней',     payload: 'overdue:gt90',  variant: 'danger' },
                ],
            }
        );
    }

    /** Шаг 4 ТЗ — возраст + тип трудоустройства. */
    function askAge() {
        state.step = 'await_age';
        senseiSays('Сколько вам полных лет? (Это нужно, чтобы отсечь МФО, ' +
                   'которые работают только с определёнными возрастами.)', {
            quickReplies: [
                { label: '18–25', payload: 'age:22' },
                { label: '26–40', payload: 'age:33' },
                { label: '41–60', payload: 'age:50' },
                { label: '60+',   payload: 'age:65' },
            ],
        });
    }

    function askEmployment() {
        state.step = 'await_employment';
        senseiSays('И последний вопрос — ваш тип занятости?', {
            quickReplies: [
                { label: 'Найм',         payload: 'emp:employed' },
                { label: 'Самозанятый',  payload: 'emp:self' },
                { label: 'Без работы',   payload: 'emp:none', variant: 'warn' },
            ],
        });
    }

    /** Шаг 5 ТЗ — выдача карусели офферов через get_loan_offers(). */
    function showOffers() {
        state.step = 'offers_shown';
        senseiSays(
            [
                'Минуту, изучаю 40+ предложений… 🧘',
                'Вот <b>топ-3</b> с максимальным шансом одобрения для вас:',
            ],
            {
                then: () => {
                    const offers = getLoanOffers({
                        amount: state.amount,
                        termDays: state.termDays,
                        overdue: state.overdue,
                        age: state.age,
                        employment: state.employment,
                    });
                    renderOffers(offers);

                    // Геймификация: первая консультация
                    showAchievement('🎯', 'Первая консультация');
                    if (state.overdue === 'none') {
                        setLevel('Самурай', '⚔️');
                        showAchievement('⚔️', 'Чистая кредитная история');
                    } else {
                        setLevel('Подмастерье', '🌿');
                    }

                    renderQuickReplies([
                        { label: '🔄 Подобрать заново', payload: 'restart' },
                        { label: '❓ Задать вопрос',     payload: 'start_faq' },
                    ]);
                },
            }
        );
    }

    /** Шаг 6 — Magic-link редирект (§3.4: безопасность). */
    function handleApply(offer) {
        const magicLink = '/secure/lk?token=' +
            Math.random().toString(36).slice(2, 10) + '&mfo=' +
            encodeURIComponent(offer.mfo.name);

        addUserMessage('Оформить: ' + offer.mfo.name);
        senseiSays(
            [
                'Превосходный выбор! 🎌',
                'Я сгенерировал для вас защищённую ссылку. По ней вы попадёте ' +
                'в <b>личный кабинет «Выручай»</b>, где:<br>' +
                '• отсканируете паспорт через Smart Engines (займёт ~30 сек)<br>' +
                '• подпишете договор СМС-кодом<br>' +
                '• получите деньги на карту',
                `<a href="${escapeHtml(magicLink)}" target="_blank" rel="noopener" ` +
                `style="display:inline-block;padding:10px 16px;background:linear-gradient(135deg,#3b2e8c,#5b46d6);` +
                `color:#fff;border-radius:999px;font-weight:600;margin-top:4px">→ Перейти в защищённый ЛК</a>`,
            ],
            {
                then: () => showAchievement('🚀', 'Готов к выдаче'),
            }
        );
    }

    // ---------- Сценарий №3: Реабилитация КИ ----------
    function startRehab() {
        state.step = 'rehab';
        senseiSays(
            [
                'Не переживайте — путь к финансовому Дзену доступен каждому 🧘',
                `Ваш текущий статус: <b>${escapeHtml(state.level)}</b>. ` +
                'Если вы возьмёте микро-займ на <b>3 000 ₽</b> и отдадите его вовремя, ' +
                'ваш рейтинг повысится, и в следующий раз вам одобрят до <b>15 000 ₽</b>.',
                'Начинаем путь к финансовому Дзену?',
            ],
            {
                quickReplies: [
                    { label: '🥋 Да, в путь!',       payload: 'rehab_start' },
                    { label: 'Расскажи подробнее',   payload: 'rehab_info' },
                    { label: 'Может, позже',         payload: 'restart' },
                ],
            }
        );
    }

    // ---------- Маршрутизация payload'ов от quick-replies ----------
    function handlePayload(payload, label) {
        // amount:30000
        if (payload.startsWith('amount:')) {
            state.amount = parseInt(payload.split(':')[1], 10);
            advanceLoanFlow();
            return;
        }
        if (payload.startsWith('term:')) {
            state.termDays = parseInt(payload.split(':')[1], 10);
            advanceLoanFlow();
            return;
        }
        if (payload.startsWith('overdue:')) {
            state.overdue = payload.split(':')[1];
            advanceLoanFlow();
            return;
        }
        if (payload.startsWith('age:')) {
            state.age = parseInt(payload.split(':')[1], 10);
            advanceLoanFlow();
            return;
        }
        if (payload.startsWith('emp:')) {
            state.employment = payload.split(':')[1];
            advanceLoanFlow();
            return;
        }

        switch (payload) {
            case 'start_loan':
                askAmount();
                break;
            case 'start_faq':
                senseiSays('Спросите что угодно про займы, ставки, сроки, КИ — отвечу из базы знаний «Выручай».');
                break;
            case 'start_rehab':
                startRehab();
                break;
            case 'rehab_start':
                state.amount = 3000;
                state.termDays = 30;
                state.overdue = 'lt30';
                state.age = 30;
                state.employment = 'employed';
                showAchievement('🌱', 'Начало пути');
                showOffers();
                break;
            case 'rehab_info':
                senseiSays(
                    'Программа простая: 3 микро-займа по 3 000 ₽, каждый возвращён вовремя. ' +
                    'После каждого — повышение рейтинга и рост лимита. За 3 месяца выйдете ' +
                    'в категорию <b>Самурай</b> с лимитом до 50 000 ₽.',
                    { quickReplies: [{ label: '🥋 Хорошо, начинаем', payload: 'rehab_start' }] }
                );
                break;
            case 'pay_link':
                senseiSays(
                    'Держите: <a href="/lk/pay" target="_blank" rel="noopener">кабинет → Погашение</a>. ' +
                    'Если что — я рядом 🥋'
                );
                break;
            case 'restart':
                state.step = 'idle';
                state.amount = state.termDays = state.overdue = state.age = null;
                state.employment = null;
                senseiSays('Начинаем заново. С чего продолжим?', {
                    quickReplies: [
                        { label: '💰 Нужны деньги', payload: 'start_loan' },
                        { label: '❓ Задать вопрос', payload: 'start_faq' },
                    ],
                });
                break;
            default:
                senseiSays('Хм, не понял команду. Можете спросить иначе?');
        }
    }

    /** Двигатель сценария №1: проверяет, какие данные ещё нужны, и спрашивает их. */
    function advanceLoanFlow() {
        if (state.amount == null)    return askAmount();
        if (state.termDays == null)  return askTerm();
        if (state.overdue == null)   return askOverdue();
        if (state.age == null)       return askAge();
        if (state.employment == null) return askEmployment();
        // Все данные собраны — вызываем get_loan_offers()
        showOffers();
    }

    // =========================================================
    // Обработка свободного текста (NLP)
    // =========================================================
    function handleUserText(text) {
        addUserMessage(text);
        clearQuickReplies();

        // Если мы в середине заполнения — пытаемся достать значение из текста
        if (state.step === 'await_amount') {
            const a = parseAmount(text);
            if (a) { state.amount = a; return advanceLoanFlow(); }
            return senseiSays('Не уловил сумму 🤔 Попробуйте: «30 тысяч» или «50000».');
        }
        if (state.step === 'await_term') {
            const d = parseTerm(text);
            if (d) { state.termDays = d; return advanceLoanFlow(); }
            return senseiSays('Не понял срок. Например: «на 14 дней» или «до зарплаты».');
        }
        if (state.step === 'await_age') {
            const m = text.match(/\d{2}/);
            if (m) { state.age = parseInt(m[0], 10); return advanceLoanFlow(); }
            return senseiSays('Подскажите числом, сколько вам полных лет.');
        }

        // Иначе — определяем интент верхнего уровня
        const intent = detectIntent(text);

        if (intent === 'greeting') {
            return senseiSays('И вам доброго дня 🙏 Чем помочь?', {
                quickReplies: [
                    { label: '💰 Нужны деньги', payload: 'start_loan' },
                    { label: '❓ Задать вопрос', payload: 'start_faq' },
                ],
            });
        }
        if (intent === 'thanks') {
            return senseiSays('Это мой путь 🥋 Обращайтесь в любое время.');
        }
        if (intent === 'bye') {
            return senseiSays('Доброй дороги! Ваш дзен ждёт ✨');
        }
        if (intent === 'loan_request') {
            const a = parseAmount(text);
            const d = parseTerm(text);
            if (a) state.amount = a;
            if (d) state.termDays = d;
            // Подтверждаем распознанные параметры
            const recognized = [];
            if (a) recognized.push(`сумма <b>${fmtMoney(a)}</b>`);
            if (d) recognized.push(`срок <b>до ${d} дней</b>`);
            if (recognized.length) {
                return senseiSays(
                    'Отлично, я понял: ' + recognized.join(', ') + '. Уточним пару деталей.',
                    { then: () => advanceLoanFlow() }
                );
            }
            return advanceLoanFlow();
        }
        if (intent === 'faq') {
            const item = findFaq(text);
            if (item) {
                return senseiSays(item.answer, {
                    quickReplies: item.followUp ? [item.followUp] : null,
                });
            }
        }

        // Неизвестный интент — по правилам ТЗ §3.2 предлагаем оператора
        return senseiSays(
            'Не нашёл точного ответа в базе знаний — а в финансах я не имею права ' +
            'выдумывать. Хотите, переведу на <b>оператора</b>?',
            {
                quickReplies: [
                    { label: 'Да, оператора',     payload: 'pay_link' /* mock */ },
                    { label: '💰 Подобрать займ', payload: 'start_loan' },
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
        setTimeout(() => chatInput.focus(), 100);
        startGreeting();
    }
    function closeChat() {
        chatWindow.hidden = true;
        launcher.style.display = '';
    }

    // =========================================================
    // Биндинги
    // =========================================================
    fab.addEventListener('click', openChat);
    openCta.addEventListener('click', openChat);
    chatClose.addEventListener('click', closeChat);
    bubbleClose.addEventListener('click', (e) => {
        e.stopPropagation();
        bubble.classList.add('hidden');
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        handleUserText(text);
    });

    // Авто-показ бейджа-подсказки через 3 сек после загрузки
    bubble.classList.add('hidden');
    setTimeout(() => bubble.classList.remove('hidden'), 2500);

    // Экспорт для отладки
    window.__sensei = { state, getLoanOffers, KNOWLEDGE_BASE };
})();
