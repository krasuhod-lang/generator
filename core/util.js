/* =========================================================
 * core/util.js — утилиты UI/форматирования.
 * ========================================================= */

(function () {
    'use strict';

    var ns = (window.Sensei = window.Sensei || {});

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function fmtMoney(n) {
        if (n == null || isNaN(n)) return '—';
        return Math.round(n).toLocaleString('ru-RU') + ' ₽';
    }

    function fmtPct(n, digits) {
        if (n == null || isNaN(n)) return '—';
        return n.toFixed(digits == null ? 2 : digits).replace('.', ',') + '%';
    }

    function nowTime() {
        var d = new Date();
        return (
            String(d.getHours()).padStart(2, '0') +
            ':' +
            String(d.getMinutes()).padStart(2, '0')
        );
    }

    /**
     * Аннуитетный платёж (формула стандартная для потребкредитов и ипотеки).
     * @param {number} principal — сумма кредита
     * @param {number} annualRatePct — годовая ставка в %
     * @param {number} months — срок в месяцах
     */
    function annuityPayment(principal, annualRatePct, months) {
        if (!principal || !months) return 0;
        var i = annualRatePct / 100 / 12;
        if (i === 0) return principal / months;
        var k = (i * Math.pow(1 + i, months)) / (Math.pow(1 + i, months) - 1);
        return principal * k;
    }

    ns.util = {
        escapeHtml: escapeHtml,
        fmtMoney: fmtMoney,
        fmtPct: fmtPct,
        nowTime: nowTime,
        annuityPayment: annuityPayment,
    };
})();
