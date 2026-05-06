/* =========================================================
 * core/state.js — общее состояние диалога Сенсея.
 *
 * Соответствует ТЗ §3.1 (rule-based движок) и §3.4 (session_id —
 * нужен для magic-link, аналитики и интеграции с API-шлюзом).
 *
 * Экспортируется как window.Sensei.state (сохраняем «без сборки»).
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});

    /** Генерация UUID v4 без зависимостей (RFC 4122 §4.4).
     *  Используем crypto.getRandomValues — Math.random не подходит для
     *  идентификаторов сессий (см. CWE-338). */
    function uuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            var bytes = new Uint8Array(16);
            window.crypto.getRandomValues(bytes);
            // Версия 4 и вариант RFC 4122
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            var hex = [];
            for (var i = 0; i < 16; i++) {
                hex.push((bytes[i] + 0x100).toString(16).slice(1));
            }
            return (
                hex.slice(0, 4).join('') + '-' +
                hex.slice(4, 6).join('') + '-' +
                hex.slice(6, 8).join('') + '-' +
                hex.slice(8, 10).join('') + '-' +
                hex.slice(10, 16).join('')
            );
        }
        // Совсем легаси-окружение (без Web Crypto): чтобы прототип не падал,
        // отдаём временный id с маркером. Для чувствительных операций
        // session_id всегда выдаётся бэком — это лишь клиентский корреляционный id.
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[Sensei] Web Crypto API недоступен — session_id сгенерирован в режиме совместимости.');
        }
        return 'insecure-' + Date.now().toString(36) + '-' +
               Math.floor(Math.random() * 1e9).toString(36);
    }

    /**
     * Стабильный session_id на вкладку браузера. Используется:
     *  - в magic-link (§3.4)
     *  - в аналитике (Phase 7)
     *  - как ключ для серверной персистентности геймификации (Phase 5)
     */
    function getSessionId() {
        try {
            var sid = sessionStorage.getItem('sensei_sid');
            if (!sid) {
                sid = uuid();
                sessionStorage.setItem('sensei_sid', sid);
            }
            return sid;
        } catch (_e) {
            // Приватный режим / storage недоступен — отдаём ad-hoc id
            return uuid();
        }
    }

    /**
     * Состояние:
     *  - category — текущий продукт (loan|credit|mortgage|card|insurance|deposit|refinancing|null)
     *  - schemaStep — индекс текущего вопроса в qualification_schema
     *  - answers — объект ответов на вопросы текущей категории
     *  - userProfile — кросс-категорийные данные (overdue/age/employment/region)
     *  - level/achievements — геймификация
     */
    var state = {
        sessionId: getSessionId(),
        category: null,
        schemaStep: 0,
        answers: {},
        userProfile: {
            overdue: null,    // 'none' | 'lt30' | 'gt90'
            age: null,
            employment: null, // 'employed' | 'self' | 'ip' | 'pensioner' | 'none'
            region: null,
        },
        level: 'Ученик',
        achievements: new Set(),
    };

    /** Полный сброс flow без обнуления session_id и геймификации. */
    function resetFlow() {
        state.category = null;
        state.schemaStep = 0;
        state.answers = {};
    }

    ns.state = state;
    ns.resetFlow = resetFlow;
    ns.uuid = uuid;
})();
