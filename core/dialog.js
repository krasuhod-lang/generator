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
        ns.state.stepHistory = [];

        var intro = def.intro;
        if (intro && intro.length) {
            render.senseiSays(intro, { then: function () { askNext(); } });
        } else {
            askNext();
        }
    }

    /**
     * Попытаться авто-ответить на текущий шаг данными из state.preFill
     * (например, сумма/срок, извлечённые из исходного сообщения
     * пользователя «нужно 30к на 14 дней»). Возвращает true, если
     * шаг был автоматически закрыт.
     */
    function tryConsumePreFill(step) {
        var pf = ns.state.preFill;
        if (!pf) return false;
        if (!Object.prototype.hasOwnProperty.call(pf, step.id)) return false;
        var v = pf[step.id];
        // Удаляем pre-fill вне зависимости от исхода — чтобы не зациклить.
        delete pf[step.id];
        if (v == null || v === '') return false;
        if (step.validate) {
            var err = step.validate(v, ns.state);
            if (err !== true) return false;
        }
        ns.state.answers[step.id] = v;
        if (step.applyToProfile) step.applyToProfile(v, ns.state.userProfile);
        return true;
    }

    /** Перейти к следующему незаполненному шагу. */
    function askNext() {
        var def = registry[ns.state.category];
        if (!def) return;
        var schema = def.schema;
        // пропускаем шаги со skipIf или закрываем pre-fill'ом
        while (ns.state.schemaStep < schema.length) {
            var s = schema[ns.state.schemaStep];
            if (s.skipIf && s.skipIf(ns.state)) {
                ns.state.schemaStep++;
                continue;
            }
            if (tryConsumePreFill(s)) {
                ns.state.stepHistory.push(ns.state.schemaStep);
                ns.state.schemaStep++;
                _autosaveProgress();
                continue;
            }
            break;
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
        var qrs = (step.quickReplies || []).slice();
        // Для опциональных шагов добавляем кнопку «Пропустить»
        if (step.optional) {
            qrs.push({ label: '↷ Пропустить', payload: 'flow:skip', variant: 'ghost' });
        }
        // Для шагов после первого добавляем «Назад»
        if (ns.state.stepHistory && ns.state.stepHistory.length > 0) {
            qrs.push({ label: '⟵ Назад', payload: 'flow:back', variant: 'ghost' });
        }
        render.senseiSays(msgs, {
            quickReplies: qrs.length ? qrs : null,
        });
    }

    /** Вернуться на предыдущий шаг (если есть история). */
    function back() {
        var hist = ns.state.stepHistory || [];
        if (!hist.length) return false;
        var prev = hist.pop();
        var def = registry[ns.state.category];
        if (!def) return false;
        var prevStep = def.schema[prev];
        if (prevStep && prevStep.id) delete ns.state.answers[prevStep.id];
        ns.state.schemaStep = prev;
        // Не вызываем preFill повторно для возвращаемого шага.
        if (ns.state.preFill && prevStep) delete ns.state.preFill[prevStep.id];
        askNext();
        return true;
    }

    /** Пропустить опциональный шаг. */
    function skip() {
        var def = registry[ns.state.category];
        if (!def) return false;
        var step = def.schema[ns.state.schemaStep];
        if (!step || !step.optional) return false;
        ns.state.stepHistory = ns.state.stepHistory || [];
        ns.state.stepHistory.push(ns.state.schemaStep);
        ns.state.schemaStep++;
        _autosaveProgress();
        askNext();
        return true;
    }

    function _autosaveProgress() {
        if (ns.consent && typeof ns.consent.saveQuizProgress === 'function') {
            try { ns.consent.saveQuizProgress(ns.state); } catch (_e) { /* noop */ }
        }
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
        ns.state.stepHistory = ns.state.stepHistory || [];
        ns.state.stepHistory.push(ns.state.schemaStep);
        ns.state.schemaStep++;
        _autosaveProgress();
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
        ns.state.stepHistory = ns.state.stepHistory || [];
        ns.state.stepHistory.push(ns.state.schemaStep);
        ns.state.schemaStep++;
        _autosaveProgress();
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
        back: back,
        skip: skip,
    };

    // Реестр пользовательских payload-обработчиков (для калькуляторов категорий
    // и др. follow-up'ов). Должен существовать до загрузки categories/*, поэтому
    // инициализируется здесь, а не в app.js.
    ns.payloadHandlers = ns.payloadHandlers || {};
    ns.registerPayload = function (key, fn) { ns.payloadHandlers[key] = fn; };
})();
