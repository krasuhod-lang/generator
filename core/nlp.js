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

    /**
     * Извлечь номер российского мобильного телефона из свободного текста.
     * Возвращает строку в формате '+7XXXXXXXXXX' либо null.
     *
     * Не валидирует «существование» номера — это задача SMS-провайдера;
     * проверяем только формат RU mobile (код 9XX).
     */
    function parsePhone(text) {
        if (text == null) return null;
        // Берём подстроку, похожую на номер: цифры, пробелы, скобки, дефисы, «+».
        var s = String(text).match(/(?:\+?\d[\d\s().\-]{8,}\d)/);
        if (!s) return null;
        var digits = s[0].replace(/\D+/g, '');
        if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8') && digits[1] === '9') {
            return '+7' + digits.slice(1);
        }
        if (digits.length === 10 && digits[0] === '9') {
            return '+7' + digits;
        }
        return null;
    }

    /**
     * Извлечь email из свободного текста. Возвращает email в нижнем
     * регистре или null. RFC 5322 сложен — ловим практичный подмножество.
     */
    function parseEmail(text) {
        if (text == null) return null;
        var m = String(text).match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        return m ? m[0].toLowerCase() : null;
    }

    /**
     * Извлечь дату из свободного текста. Поддерживает форматы:
     *   ДД.ММ.ГГГГ / ДД-ММ-ГГГГ / ДД/ММ/ГГГГ
     *   ДД.ММ.ГГ (двухзначный год → 19xx/20xx эвристикой)
     *   «сегодня», «завтра», «вчера»
     * Возвращает Date | null.
     */
    function parseDate(text) {
        if (text == null) return null;
        var t = String(text).trim().toLowerCase();
        var today = new Date(); today.setHours(0, 0, 0, 0);
        if (/^сегодня$/.test(t)) return today;
        if (/^завтра$/.test(t)) { var d = new Date(today); d.setDate(d.getDate() + 1); return d; }
        if (/^вчера$/.test(t))  { var d2 = new Date(today); d2.setDate(d2.getDate() - 1); return d2; }
        var m = t.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
        if (!m) return null;
        var dd = parseInt(m[1], 10), mm = parseInt(m[2], 10) - 1, yy = parseInt(m[3], 10);
        if (yy < 100) yy += yy >= 50 ? 1900 : 2000;
        if (dd < 1 || dd > 31 || mm < 0 || mm > 11) return null;
        var dt = new Date(yy, mm, dd);
        // Защита от «31 февраля» — Date «нормализует» молча.
        if (dt.getDate() !== dd || dt.getMonth() !== mm) return null;
        return dt;
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

    /**
     * Детектор категории по триггерам с возвратом кандидатов и веса.
     * Чем больше совпавших триггеров — тем выше score.
     * @returns {Array<{category:string, score:number, hits:string[]}>}
     */
    function detectCategoryCandidates(text) {
        var t = String(text).toLowerCase();
        var order = ['refinancing', 'mortgage', 'card', 'insurance', 'deposit', 'credit', 'loan'];
        var out = [];
        for (var i = 0; i < order.length; i++) {
            var cat = order[i];
            var triggers = CATEGORY_TRIGGERS[cat];
            var hits = [];
            for (var j = 0; j < triggers.length; j++) {
                if (t.indexOf(triggers[j]) !== -1) hits.push(triggers[j]);
            }
            if (hits.length) out.push({ category: cat, score: hits.length, hits: hits });
        }
        out.sort(function (a, b) { return b.score - a.score; });
        return out;
    }

    /** Детектор категории по триггерам. */
    function detectCategory(text) {
        var cands = detectCategoryCandidates(text);
        return cands.length ? cands[0].category : null;
    }

    /**
     * Глобальные команды управления диалогом, которые должны работать
     * в любом контексте (даже внутри активного flow). Возвращает
     * один из: 'menu' | 'restart' | 'back' | 'skip' | 'operator' | null.
     */
    function detectCommand(text) {
        var t = String(text).toLowerCase().trim();
        if (/^(в\s*меню|меню|main|home|главная)$/.test(t)) return 'menu';
        if (/^(начать\s*заново|сначала|с\s*начала|reset|перезапуск)$/.test(t)) return 'restart';
        if (/^(назад|back|вернись|вернуться)$/.test(t)) return 'back';
        if (/^(пропустить|skip|пропуск|дальше)$/.test(t)) return 'skip';
        if (/^(оператор|человек|менеджер|позови\s*человека)$/.test(t)) return 'operator';
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
        parsePhone: parsePhone,
        parseEmail: parseEmail,
        parseDate: parseDate,
        detectCategory: detectCategory,
        detectCategoryCandidates: detectCategoryCandidates,
        detectIntent: detectIntent,
        detectCommand: detectCommand,
        CATEGORY_TRIGGERS: CATEGORY_TRIGGERS,
    };
})();
