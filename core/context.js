/* =========================================================
 * core/context.js — пассивный, законный сбор контекста
 * посетителя сайта.
 *
 * ВАЖНО — что этот модуль НЕ делает (физически не может и не должен):
 *   • Не определяет телефон, email, ФИО посетителя — браузер
 *     этих данных не передаёт. Любые «сервисы определения
 *     контакта по IP» — нарушение 152-ФЗ / 137 УК РФ.
 *   • Не читает куки сторонних доменов (запрещено Same-Origin Policy).
 *   • Не запускает fingerprint-трекинг и не обращается к третьим сторонам.
 *
 * Что собирает (всё доступно браузеру штатно):
 *   1. Источник трафика — UTM-метки + анализ document.referrer
 *      (поисковик / соцсеть / direct / другой реферер).
 *   2. Регион — по Intl timezone (без IP-геолокации).
 *   3. Язык — navigator.language.
 *   4. Тип устройства — mobile/tablet/desktop по UA + ширине экрана.
 *   5. Время суток — для персонализации приветствия.
 *   6. Returning visitor — по локальному маркеру (только если
 *      пользователь дал согласие cookie='all').
 *
 * Гарантия: ничего из перечисленного не записывается в
 * localStorage до явного согласия. До согласия контекст живёт
 * только в памяти текущей вкладки.
 *
 * Использование:
 *   var ctx = Sensei.context.get();
 *   // → { source, region, language, device, timeOfDay, isReturning, hour }
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});

    var STORAGE_KEY = 'sensei_visitor_seen';

    // ---- Источник трафика ---------------------------------------------------
    function detectSource() {
        var src = { kind: 'direct', utm: null, referrer: null };
        try {
            var qs = window.location.search || '';
            var params = {};
            qs.replace(/^\?/, '').split('&').forEach(function (pair) {
                if (!pair) return;
                var eq = pair.indexOf('=');
                var k = decodeURIComponent(eq > -1 ? pair.slice(0, eq) : pair);
                var v = decodeURIComponent(eq > -1 ? pair.slice(eq + 1) : '');
                params[k] = v;
            });
            if (params.utm_source || params.utm_medium || params.utm_campaign) {
                src.utm = {
                    source:   params.utm_source   || null,
                    medium:   params.utm_medium   || null,
                    campaign: params.utm_campaign || null,
                    content:  params.utm_content  || null,
                    term:     params.utm_term     || null,
                };
                src.kind = 'utm';
                return src;
            }

            var ref = document.referrer || '';
            if (!ref) return src;
            src.referrer = ref;
            var host = '';
            try { host = new URL(ref).hostname.toLowerCase(); } catch (_e) { return src; }
            if (host === window.location.hostname) {
                src.kind = 'internal';
            } else if (/(google|bing|duckduckgo|yandex|mail\.ru|rambler)\./.test(host)) {
                src.kind = 'search';
                src.engine = host.split('.')[0];
            } else if (/(vk\.com|ok\.ru|t\.me|telegram|facebook|instagram|twitter|x\.com|tiktok|youtube|dzen|zen\.yandex)/.test(host)) {
                src.kind = 'social';
                src.network = host.replace(/^www\./, '').split('.')[0];
            } else {
                src.kind = 'referral';
                src.host = host;
            }
        } catch (_e) { /* noop */ }
        return src;
    }

    // ---- Регион по timezone -------------------------------------------------
    // Грубая карта: timezone → крупный регион РФ. Это не геолокация
    // по IP, а только пользовательская настройка ОС.
    var TZ_REGION = {
        'Europe/Moscow':       'Москва и центр',
        'Europe/Kaliningrad':  'Калининград',
        'Europe/Samara':       'Поволжье',
        'Europe/Saratov':      'Поволжье',
        'Europe/Volgograd':    'Поволжье',
        'Europe/Astrakhan':    'Поволжье',
        'Europe/Ulyanovsk':    'Поволжье',
        'Europe/Kirov':        'Поволжье',
        'Asia/Yekaterinburg':  'Урал',
        'Asia/Omsk':           'Сибирь',
        'Asia/Novosibirsk':    'Сибирь',
        'Asia/Novokuznetsk':   'Сибирь',
        'Asia/Tomsk':          'Сибирь',
        'Asia/Barnaul':        'Сибирь',
        'Asia/Krasnoyarsk':    'Сибирь',
        'Asia/Irkutsk':        'Восточная Сибирь',
        'Asia/Chita':          'Забайкалье',
        'Asia/Yakutsk':        'Дальний Восток',
        'Asia/Vladivostok':    'Дальний Восток',
        'Asia/Khandyga':       'Дальний Восток',
        'Asia/Sakhalin':       'Дальний Восток',
        'Asia/Magadan':        'Дальний Восток',
        'Asia/Srednekolymsk':  'Дальний Восток',
        'Asia/Ust-Nera':       'Дальний Восток',
        'Asia/Kamchatka':      'Камчатка',
        'Asia/Anadyr':         'Чукотка',
    };

    function detectRegion() {
        try {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return { tz: tz, label: TZ_REGION[tz] || null };
        } catch (_e) {
            return { tz: null, label: null };
        }
    }

    // ---- Язык ---------------------------------------------------------------
    function detectLanguage() {
        var langs = navigator.languages || [navigator.language || 'ru'];
        var primary = String(langs[0] || 'ru').toLowerCase();
        return { primary: primary, isRu: /^ru/.test(primary) };
    }

    // ---- Устройство ---------------------------------------------------------
    function detectDevice() {
        var ua = String(navigator.userAgent || '').toLowerCase();
        var w = window.innerWidth || 0;
        var isTablet = /ipad|tablet|playbook|silk/.test(ua) || (w >= 600 && w < 1024 && /mobi|android/.test(ua));
        var isMobile = !isTablet && /mobi|android|iphone|ipod|opera mini|iemobile|blackberry/.test(ua);
        var kind = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
        return { kind: kind, width: w, ua: ua };
    }

    // ---- Время суток --------------------------------------------------------
    function detectTimeOfDay() {
        var h = new Date().getHours();
        var label =
            h >= 5 && h < 12 ? 'утро' :
            h >= 12 && h < 17 ? 'день' :
            h >= 17 && h < 23 ? 'вечер' :
            'ночь';
        return { hour: h, label: label };
    }

    // ---- Returning visitor --------------------------------------------------
    // Записываем маркер ТОЛЬКО при cookie='all'. Иначе — определяем
    // на лету в рамках сессии (sessionStorage), без долгосрочного следа.
    function detectReturning() {
        var consent = ns.consent;
        var allowPersist = consent && consent.cookieChoice && consent.cookieChoice() === 'all';
        try {
            if (allowPersist) {
                var prev = window.localStorage.getItem(STORAGE_KEY);
                if (prev) {
                    var ts = parseInt(prev, 10) || 0;
                    var daysAgo = ts ? Math.floor((Date.now() - ts) / 86400000) : null;
                    return { isReturning: true, daysSinceLast: daysAgo, persisted: true };
                }
                window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
                return { isReturning: false, daysSinceLast: null, persisted: true };
            }
            // Без согласия — только в рамках вкладки
            var k = 'sensei_visitor_seen_session';
            var seen = window.sessionStorage.getItem(k);
            if (seen) return { isReturning: true, daysSinceLast: 0, persisted: false };
            window.sessionStorage.setItem(k, '1');
            return { isReturning: false, daysSinceLast: null, persisted: false };
        } catch (_e) {
            return { isReturning: false, daysSinceLast: null, persisted: false };
        }
    }

    // ---- Сборка контекста ---------------------------------------------------
    var _cache = null;
    function get(force) {
        if (_cache && !force) return _cache;
        _cache = {
            source:    detectSource(),
            region:    detectRegion(),
            language:  detectLanguage(),
            device:    detectDevice(),
            timeOfDay: detectTimeOfDay(),
            visitor:   detectReturning(),
            collectedAt: new Date().toISOString(),
        };
        return _cache;
    }

    /** Удобный человекочитаемый префикс для приветствия. */
    function greetingPrefix() {
        var c = get();
        var t = c.timeOfDay.label;
        var part =
            t === 'утро'   ? 'Доброе утро' :
            t === 'день'   ? 'Добрый день' :
            t === 'вечер'  ? 'Добрый вечер' :
                             'Доброй ночи';
        return part + (c.visitor.isReturning ? ', с возвращением' : '') + '!';
    }

    /** Подсказка по источнику трафика — какую категорию вероятно ищет посетитель. */
    function inferIntentHint() {
        var c = get();
        var s = c.source;
        if (s && s.utm && s.utm.campaign) {
            var camp = String(s.utm.campaign).toLowerCase();
            if (/zaim|loan|mfo|zarplat/.test(camp)) return 'loan';
            if (/credit|kredit/.test(camp))         return 'credit';
            if (/ipotek|mortgage/.test(camp))       return 'mortgage';
            if (/card|karta|cashback/.test(camp))   return 'card';
            if (/osago|kasko|insur|strah/.test(camp)) return 'insurance';
            if (/vklad|deposit/.test(camp))         return 'deposit';
            if (/refin/.test(camp))                 return 'refinancing';
        }
        return null;
    }

    /** Полностью забыть все локальные маркеры (для UI «отозвать согласие»). */
    function forget() {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* noop */ }
        try { window.sessionStorage.removeItem('sensei_visitor_seen_session'); } catch (_e) { /* noop */ }
        _cache = null;
    }

    ns.context = {
        get: get,
        greetingPrefix: greetingPrefix,
        inferIntentHint: inferIntentHint,
        forget: forget,
    };
})();
