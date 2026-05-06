/* =========================================================
 * core/nlp.js — лёгкий rule-based NLP для прототипа.
 *
 * В проде заменяется LLM-вызовом (YandexGPT/GigaChat/OpenAI) с
 * системным промптом из ТЗ §2.1 и function-calling.
 *
 * Здесь:
 *   - parseAmount / parseTerm — общие парсеры (применимы к займам/кредитам/вкладам)
 *   - detectIntent — верхнеуровневый интент по триггерам категорий
 *   - findFaq — поиск в base знаний (mock RAG)
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});

    /**
     * Триггеры по категориям из ТЗ §1.2–1.7.
     * Любая частичная подстрока в нижнем регистре = совпадение.
     */
    var CATEGORY_TRIGGERS = {
        loan: [
            'займ', 'микрозайм', 'до зарплат', 'нужны деньги', 'нужны деньг',
            'нужна сумма', 'дай деньг', 'возьм деньг', 'тысяч до', 'десятку',
        ],
        credit: [
            'кредит наличн', 'потребительск', 'потребкредит', 'кредит на ремонт',
            'кредит на машин', 'кредит на телефон', 'кредит на образован', 'нужен кредит',
        ],
        mortgage: [
            'ипотек', 'купить квартир', 'купить жиль', 'льготн', 'семейн ипотек',
            'it-ипотек', 'ипотечн',
        ],
        card: [
            'кредитн карт', 'карта с кэшбэк', 'кэшбек', 'кэшбэк',
            'беспроцентн период', 'грейс', 'карта рассрочк',
        ],
        insurance: [
            'осаго', 'каско', 'страховк', 'страхован', 'страховую',
            'дмс', 'полис', 'застраховать',
        ],
        deposit: [
            'вклад', 'депозит', 'накопительн', 'процент на остатк',
            'куда положить деньг', 'накоплен',
        ],
        refinancing: [
            'рефинанс', 'снизить ставк', 'объединить кредит',
            'переплачива', 'перекредит',
        ],
    };

    function parseAmount(text) {
        var t = String(text).toLowerCase().replace(/\s+/g, ' ');

        var wordMap = {
            'десятк': 10000, 'двадцатк': 20000, 'тридцатк': 30000,
            'полтинник': 50000, 'сотк': 100000, 'сотн': 100000,
            'миллион': 1000000, 'лям': 1000000,
        };
        for (var w in wordMap) if (t.indexOf(w) !== -1) return wordMap[w];

        // «N млн / миллион»
        var m = t.match(/(\d+(?:[.,]\d+)?)\s*(млн|миллион)/);
        if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000000);

        // «N тысяч / тыс / к / k»
        // (Без \b — в JS \b не работает после кириллицы.)
        m = t.match(/(\d+(?:[.,]\d+)?)\s*(тысяч|тыс\.?|к|k)(?![а-яёa-z])/i);
        if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000);

        // «N рублей» или просто число >= 1000
        m = t.match(/(\d{4,9})\s*(р|руб|₽)?/);
        if (m) return parseInt(m[1], 10);

        return null;
    }

    function parseTerm(text) {
        var t = String(text).toLowerCase();
        if (/до\s+(зарплат|получк)/.test(t)) return 30;
        if (/(2 недел|14 дн|полмесяц)/.test(t)) return 14;
        if (/(недел|7 дн)/.test(t)) return 7;
        if (/(месяц|30 дн)/.test(t)) return 30;
        var m = t.match(/(\d+)\s*(дн|день|дня|дней)/);
        if (m) return parseInt(m[1], 10);
        var months = t.match(/(\d+)\s*(месяц|мес)/);
        if (months) return parseInt(months[1], 10) * 30;
        return null;
    }

    /** Детектор категории по триггерам. */
    function detectCategory(text) {
        var t = String(text).toLowerCase();
        // refinancing проверяем первым (фразы вроде «рефинансировать ипотеку»
        // должны попадать в refinancing, а не mortgage)
        var order = ['refinancing', 'mortgage', 'card', 'insurance', 'deposit', 'credit', 'loan'];
        for (var i = 0; i < order.length; i++) {
            var cat = order[i];
            var triggers = CATEGORY_TRIGGERS[cat];
            for (var j = 0; j < triggers.length; j++) {
                if (t.indexOf(triggers[j]) !== -1) return cat;
            }
        }
        return null;
    }

    /** Верхнеуровневый интент. */
    function detectIntent(text) {
        var t = String(text).toLowerCase();
        if (/(привет|здравствуй|добр|хай|hi|hello)/.test(t)) return 'greeting';
        if (/(спасибо|благодар)/.test(t)) return 'thanks';
        if (/(пока|до свидан|bye)/.test(t)) return 'bye';
        if (/(меню|раздел|с чего нач|что умее)/.test(t)) return 'menu';
        var cat = detectCategory(t);
        if (cat) return 'category:' + cat;
        if (parseAmount(t) !== null && cat === null) {
            // Голая сумма без категории — наиболее вероятен микрозайм (исторический intent).
            return 'category:loan';
        }
        // FAQ — последняя попытка
        if (ns.kb && ns.kb.find(t)) return 'faq';
        return 'unknown';
    }

    ns.nlp = {
        parseAmount: parseAmount,
        parseTerm: parseTerm,
        detectCategory: detectCategory,
        detectIntent: detectIntent,
        CATEGORY_TRIGGERS: CATEGORY_TRIGGERS,
    };
})();
