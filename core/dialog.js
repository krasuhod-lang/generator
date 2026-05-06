/* =========================================================
 * core/dialog.js — обобщённый schema-driven движок диалога.
 *
 * Каждая категория регистрирует qualification_schema:
 *   [
 *     {
 *       id: 'amount',
 *       prompt: 'Сколько вам нужно?',
 *       intro: ['опциональные сообщения перед вопросом', ...],
 *       type: 'choice' | 'number' | 'text',
 *       quickReplies: [ { label, payload, variant? }, ... ]   // для type='choice'
 *       // для number/text — quickReplies-подсказки опциональны
 *       parse: (text, state) => value | null,                 // как достать значение из свободного ввода
 *       validate: (value, state) => true | 'сообщение об ошибке',
 *       skipIf: (state) => boolean,                           // условный skip шага
 *     },
 *     ...
 *   ]
 *
 * Конец схемы → вызывается onComplete(category, answers, userProfile).
 * Категории регистрируются через Sensei.flows.register(category, def).
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});
    var render = ns.render;

    var registry = {}; // category -> { schema, onComplete, intro, intent }

    function register(category, def) {
        registry[category] = def;
    }

    function get(category) {
        return registry[category];
    }

    function listCategories() {
        return Object.keys(registry);
    }

    /** Старт flow по категории: сброс ответов, intro, первый вопрос. */
    function start(category) {
        var def = registry[category];
        if (!def) {
            return render.senseiSays('Эта категория пока в разработке. Я уже учусь!');
        }
        ns.state.category = category;
        ns.state.schemaStep = 0;
        ns.state.answers = {};

        var intro = def.intro;
        if (intro && intro.length) {
            render.senseiSays(intro, { then: function () { askNext(); } });
        } else {
            askNext();
        }
    }

    /** Перейти к следующему незаполненному шагу. */
    function askNext() {
        var def = registry[ns.state.category];
        if (!def) return;
        var schema = def.schema;
        // пропускаем шаги со skipIf
        while (
            ns.state.schemaStep < schema.length &&
            schema[ns.state.schemaStep].skipIf &&
            schema[ns.state.schemaStep].skipIf(ns.state)
        ) {
            ns.state.schemaStep++;
        }
        if (ns.state.schemaStep >= schema.length) {
            // Всё собрано — завершаем
            return def.onComplete(ns.state.answers, ns.state.userProfile, ns.state);
        }
        var step = schema[ns.state.schemaStep];
        var msgs = [];
        if (step.intro && step.intro.length) {
            msgs = msgs.concat(step.intro);
        }
        msgs.push(step.prompt);
        render.senseiSays(msgs, {
            quickReplies: step.quickReplies || null,
        });
    }

    /**
     * Обработка свободного текста на текущем шаге.
     * Возвращает true, если шаг обработан; false — если стоит делегировать
     * обработку в общий NLP-роутер (например, пользователь задал FAQ-вопрос).
     */
    function handleText(text) {
        var def = registry[ns.state.category];
        if (!def) return false;
        var step = def.schema[ns.state.schemaStep];
        if (!step) return false;

        var value = step.parse
            ? step.parse(text, ns.state)
            : (step.type === 'number' ? extractNumber(text) : text);

        if (value === null || value === undefined || value === '') {
            render.senseiSays(step.errorPrompt || 'Не уловил ответ 🤔 Попробуйте ещё раз.');
            return true;
        }
        if (step.validate) {
            var err = step.validate(value, ns.state);
            if (err !== true) {
                render.senseiSays(typeof err === 'string' ? err : 'Это значение не подходит. Попробуйте другое.');
                return true;
            }
        }
        ns.state.answers[step.id] = value;
        if (step.applyToProfile) step.applyToProfile(value, ns.state.userProfile);
        ns.state.schemaStep++;
        askNext();
        return true;
    }

    /**
     * Применение payload типа `answer:<stepId>:<value>` от quick-reply.
     * Возвращает true, если payload относится к текущему flow.
     */
    function handleAnswerPayload(payload) {
        var m = /^answer:([^:]+):(.+)$/.exec(payload);
        if (!m) return false;
        var def = registry[ns.state.category];
        if (!def) return false;
        var step = def.schema[ns.state.schemaStep];
        if (!step || step.id !== m[1]) return false;
        var raw = m[2];
        var value;
        if (step.type === 'number') value = parseFloat(raw);
        else value = raw;
        if (step.validate) {
            var err = step.validate(value, ns.state);
            if (err !== true) {
                render.senseiSays(typeof err === 'string' ? err : 'Не подходит, выберите другой вариант.');
                return true;
            }
        }
        ns.state.answers[step.id] = value;
        if (step.applyToProfile) step.applyToProfile(value, ns.state.userProfile);
        ns.state.schemaStep++;
        askNext();
        return true;
    }

    function extractNumber(text) {
        var m = String(text).replace(/[\s\u00a0]/g, '').match(/(\d+(?:[.,]\d+)?)/);
        return m ? parseFloat(m[1].replace(',', '.')) : null;
    }

    ns.flows = {
        register: register,
        get: get,
        list: listCategories,
        start: start,
        askNext: askNext,
        handleText: handleText,
        handleAnswerPayload: handleAnswerPayload,
        extractNumber: extractNumber,
    };

    // Реестр пользовательских payload-обработчиков (для калькуляторов категорий
    // и др. follow-up'ов). Должен существовать до загрузки categories/*, поэтому
    // инициализируется здесь, а не в app.js.
    ns.payloadHandlers = ns.payloadHandlers || {};
    ns.registerPayload = function (key, fn) { ns.payloadHandlers[key] = fn; };
})();
