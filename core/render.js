/* =========================================================
 * core/render.js — отрисовка чата: баблы, typing, quick replies,
 * ачивки, обобщённая карусель офферов.
 *
 * Нюанс: карточка оффера зависит от категории. За её содержимое
 * отвечает renderer, который регистрируется категорией через
 * Sensei.cards.register(category, fn). Здесь — каркас.
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});
    var util = ns.util;

    // Реестр рендереров карточек офферов: { [category]: function(offer) -> HTMLElement }
    var cardRenderers = {};

    function getDom() {
        return {
            chatBody: document.getElementById('chat-body'),
            quickReplies: document.getElementById('quick-replies'),
            levelName: document.getElementById('level-name'),
        };
    }

    function scrollToBottom() {
        var d = getDom();
        if (d.chatBody) d.chatBody.scrollTop = d.chatBody.scrollHeight;
    }

    /** Добавляет бабл сообщения. `html` — уже безопасный HTML. */
    function addBubble(html, who /* 'bot' | 'user' */) {
        var d = getDom();
        var el = document.createElement('div');
        el.className = 'bubble ' + who;
        el.innerHTML = html + '<span class="meta">' + util.nowTime() + '</span>';
        d.chatBody.appendChild(el);
        scrollToBottom();
        return el;
    }

    function addUserMessage(text) {
        addBubble(util.escapeHtml(text), 'user');
    }

    var typingEl = null;
    function showTyping() {
        if (typingEl) return;
        var d = getDom();
        typingEl = document.createElement('div');
        typingEl.className = 'typing';
        typingEl.innerHTML = '<span></span><span></span><span></span>';
        d.chatBody.appendChild(typingEl);
        scrollToBottom();
    }
    function hideTyping() {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        typingEl = null;
    }

    /** Печатает несколько сообщений Сенсея с эффектом "печатает...". */
    function senseiSays(messages, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var list = Array.isArray(messages) ? messages : [messages];
            var i = 0;
            function next() {
                if (i >= list.length) {
                    if (opts.quickReplies) renderQuickReplies(opts.quickReplies);
                    if (opts.then) opts.then();
                    return resolve();
                }
                showTyping();
                var delay = Math.min(900, 250 + list[i].length * 12);
                setTimeout(function () {
                    hideTyping();
                    addBubble(list[i], 'bot');
                    i++;
                    next();
                }, delay);
            }
            next();
        });
    }

    /**
     * @param {Array<{label:string, payload:string, variant?:'danger'|'warn'|'ghost'}>} items
     */
    function renderQuickReplies(items) {
        var d = getDom();
        d.quickReplies.innerHTML = '';
        if (!items || !items.length) return;
        items.forEach(function (item) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'qr-btn' + (item.variant ? ' ' + item.variant : '');
            btn.textContent = item.label;
            btn.addEventListener('click', function () {
                clearQuickReplies();
                addUserMessage(item.label);
                ns.dispatchPayload(item.payload, item.label);
            });
            d.quickReplies.appendChild(btn);
        });
    }
    function clearQuickReplies() {
        var d = getDom();
        d.quickReplies.innerHTML = '';
    }

    /**
     * Отрисовка карусели офферов. Карточку строит зарегистрированный
     * renderer категории; если его нет — fallback-рендер (общий).
     */
    function renderOffers(category, offers) {
        var d = getDom();
        var wrap = document.createElement('div');
        wrap.className = 'offers-carousel';
        var renderer = cardRenderers[category] || defaultCard;
        offers.forEach(function (o) {
            wrap.appendChild(renderer(o));
        });
        d.chatBody.appendChild(wrap);
        scrollToBottom();
        return wrap;
    }

    /** Дефолтная карточка (используется как fallback). */
    function defaultCard(o) {
        var card = document.createElement('div');
        card.className = 'offer-card';
        card.innerHTML =
            '<div class="offer-card-head">' +
            '<div class="offer-logo" style="background:' + (o.partner_color || '#5b46d6') + '">' +
            util.escapeHtml(o.partner_short || '?') + '</div>' +
            '<div class="offer-name">' + util.escapeHtml(o.partner_name || 'Партнёр') + '</div>' +
            '</div>' +
            '<div class="offer-amount">' + util.escapeHtml(o.headline || '') + '</div>' +
            '<div class="offer-row"><span>Условия</span><b>' + util.escapeHtml(o.subline || '') + '</b></div>';
        return card;
    }

    function probabilityBlock(probability) {
        var p = Math.max(0, Math.min(100, probability || 0));
        var probClass = p >= 85 ? '' : p >= 65 ? 'warn' : 'danger';
        return (
            '<div>' +
            '<div class="offer-prob-label">' +
            '<span>Шанс одобрения</span>' +
            '<span class="pct ' + probClass + '">' + p + '%</span>' +
            '</div>' +
            '<div class="bar"><div class="bar-fill ' + probClass + '" style="width:' + p + '%"></div></div>' +
            '</div>'
        );
    }

    /** Геймификация: ачивки и уровни. */
    function showAchievement(icon, title) {
        if (ns.state.achievements.has(title)) return;
        ns.state.achievements.add(title);
        var d = getDom();
        var el = document.createElement('div');
        el.className = 'achievement';
        el.innerHTML =
            '<span class="ach-icon">' + icon + '</span> Ачивка получена: <b>' +
            util.escapeHtml(title) + '</b>';
        d.chatBody.appendChild(el);
        scrollToBottom();
    }

    function setLevel(level, icon) {
        ns.state.level = level;
        var d = getDom();
        if (d.levelName) d.levelName.textContent = level;
        var iconEl = d.levelName && d.levelName.parentElement
            ? d.levelName.parentElement.querySelector('.level-icon')
            : null;
        if (iconEl && icon) iconEl.textContent = icon;
    }

    /** Контейнер для произвольного DOM-блока внутри ленты сообщений. */
    function appendBlock(node) {
        getDom().chatBody.appendChild(node);
        scrollToBottom();
    }

    ns.render = {
        addBubble: addBubble,
        addUserMessage: addUserMessage,
        senseiSays: senseiSays,
        renderQuickReplies: renderQuickReplies,
        clearQuickReplies: clearQuickReplies,
        renderOffers: renderOffers,
        showAchievement: showAchievement,
        setLevel: setLevel,
        appendBlock: appendBlock,
        scrollToBottom: scrollToBottom,
        probabilityBlock: probabilityBlock,
    };

    ns.cards = {
        register: function (category, fn) {
            cardRenderers[category] = fn;
        },
    };
})();
