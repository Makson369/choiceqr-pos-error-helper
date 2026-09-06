// ==UserScript==
// @name         ChoiceQR POS data — помічник з помилок
// @namespace    https://choiceqr.com/
// @version      3.1.0
// @description  Витягує помилку з Response на сторінці pos-data (Poster / Syrve) і показує праворуч панель з готовим рішенням. База рішень — зовнішній файл JSON/CSV (GitHub або Google-таблиця), оновлюється без правок скрипта.
// @author       you
// @match        https://europe-west1-choiceqr-dev.cloudfunctions.net/pos-data/*
// @match        https://europe-west1-choiceqr.cloudfunctions.net/pos-data/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      raw.githubusercontent.com
// @connect      gist.githubusercontent.com
// ==/UserScript==

(function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════════════
     *  НАЛАШТУВАННЯ
     * ═══════════════════════════════════════════════════════════════
     *  RULES_URL — пряме посилання на файл бази правил. Підтримуються два формати
     *  (визначається автоматично за вмістом):
     *
     *  • JSON  — масив обʼєктів (рекомендовано, зручно тримати в GitHub):
     *      [
     *        {
     *          "match": { "message": "product id is empty", "source": "Poster" },
     *          "title": "…",
     *          "solution": "рядок1\nрядок2 {itemId}"
     *        },
     *        { "match": { "regex": "…(?<group>…)…" }, "title": "…", "solution": "…{group}…" }
     *      ]
     *    raw-посилання GitHub: https://raw.githubusercontent.com/<user>/<repo>/main/pos-error-rules.json
     *    або Gist:            https://gist.githubusercontent.com/<user>/<id>/raw/pos-error-rules.json
     *
     *  • CSV   — колонки match_code, match_message, match_regex, match_source, title, solution
     *    (напр. опублікована Google-таблиця: …/pub?gid=0&single=true&output=csv)
     *
     *  ПОЛЯ match (усі опційні; правило спрацьовує, якщо збіглися ВСІ заповнені):
     *    code    — точний e.code ("32", "209", "ProductExludedFromMenu"…)
     *    message — підрядок тексту помилки (без урахування регістру)
     *    regex   — RegExp по тексту; іменовані групи (?<name>…) → підстановка {name}
     *    source  — точне джерело ("Poster" / "Syrve" / "HTTPError"…)
     *  solution — \n = новий рядок; підстановки {code} {message} {source} {itemId}
     *             {productId} {groupName} {httpCode} + іменовані групи з regex.
     *  Перший збіг згори — виграє.
     * ─────────────────────────────────────────────────────────────── */
    const RULES_URL = 'PASTE_URL_HERE';

    const RULES_TTL_MS = 5 * 60 * 1000; // свіжість кешу; кнопка ⟳ оновлює примусово
    const RULES_CACHE_KEY = 'cqr_err_rules_v1';
    const LS_KEY = 'cqr_err_helper_collapsed';

    const CONFIGURED = /^https?:\/\//.test(RULES_URL);
    let RULES = [];
    let RULES_REV = 0;
    let RULES_TRIED = false;

    /* ═══════════════════════════════════════════════════════════════
     *  Завантаження бази правил
     * ═══════════════════════════════════════════════════════════════ */
    function httpGet(url) {
        return new Promise((resolve, reject) => {
            const gm =
                typeof GM_xmlhttpRequest === 'function'
                    ? GM_xmlhttpRequest
                    : typeof GM !== 'undefined' && GM && GM.xmlHttpRequest
                    ? GM.xmlHttpRequest
                    : null;
            if (gm) {
                gm({
                    method: 'GET',
                    url,
                    onload: (r) => (r.status >= 200 && r.status < 400 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status))),
                    onerror: () => reject(new Error('network')),
                    ontimeout: () => reject(new Error('timeout')),
                });
            } else {
                fetch(url, { cache: 'no-store' })
                    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
                    .then(resolve, reject);
            }
        });
    }

    // Мінімальний CSV-парсер (RFC 4180: лапки, "" всередині, переноси в полях).
    function parseCsv(text) {
        const s = String(text).replace(/\r\n?/g, '\n');
        const rows = [];
        let row = [];
        let field = '';
        let inQ = false;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inQ) {
                if (c === '"') {
                    if (s[i + 1] === '"') { field += '"'; i++; }
                    else inQ = false;
                } else field += c;
            } else if (c === '"') inQ = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else field += c;
        }
        if (field.length || row.length) { row.push(field); rows.push(row); }
        return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
    }

    function compileRule(r) {
        if (r.rx) {
            try { r._re = new RegExp(r.rx, 'i'); } catch (e) { r._re = null; }
        }
        return r;
    }

    // Нормалізує будь-який запис бази у внутрішній вид {code,msg,rx,src,title,solution}.
    function toRule(o) {
        const rule = {
            code: String(o.code ?? '').trim(),
            msg: String(o.msg ?? '').trim(),
            rx: String(o.rx ?? '').trim(),
            src: String(o.src ?? '').trim(),
            title: String(o.title ?? '').trim(),
            solution: String(o.solution ?? ''),
        };
        if (!rule.title && !rule.solution) return null; // порожній
        if (!rule.code && !rule.msg && !rule.rx && !rule.src) return null; // без умов
        return compileRule(rule);
    }

    // JSON-масив: [{ match:{code,message,regex,source}, title, solution }, …]
    function jsonToRules(arr) {
        if (!Array.isArray(arr)) return [];
        return arr
            .map((it) => {
                const m = it && it.match ? it.match : {};
                return toRule({
                    code: m.code,
                    msg: m.message ?? m.msg,
                    rx: m.regex ?? m.rx,
                    src: m.source ?? m.src,
                    title: it && it.title,
                    solution: it && it.solution,
                });
            })
            .filter(Boolean);
    }

    // CSV з заголовком match_code,match_message,match_regex,match_source,title,solution
    function rowsToRules(rows) {
        if (!rows.length) return [];
        const H = rows[0].map((h) => String(h).trim().toLowerCase());
        const at = (name) => H.indexOf(name);
        const ix = {
            code: at('match_code'), msg: at('match_message'), rx: at('match_regex'),
            src: at('match_source'), title: at('title'), sol: at('solution'),
        };
        const out = [];
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const g = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '') : '');
            const rule = toRule({
                code: g('code'), msg: g('msg'), rx: g('rx'), src: g('src'),
                title: g('title'), solution: g('sol'),
            });
            if (rule) out.push(rule);
        }
        return out;
    }

    // Автовизначення формату: JSON (починається з [ або {) чи CSV.
    function parseRules(text) {
        const t = String(text || '').replace(/^﻿/, '').trim();
        if (t[0] === '[' || t[0] === '{') {
            const data = JSON.parse(t);
            return jsonToRules(Array.isArray(data) ? data : data.rules || []);
        }
        return rowsToRules(parseCsv(text));
    }

    function readCache() {
        try {
            const c = JSON.parse(localStorage.getItem(RULES_CACHE_KEY) || 'null');
            if (c && Array.isArray(c.rules)) {
                c.rules = c.rules.map(compileRule);
                return c;
            }
        } catch (e) {}
        return null;
    }

    async function fetchRules() {
        RULES_TRIED = true;
        if (!CONFIGURED) return null;
        try {
            const rules = parseRules(await httpGet(RULES_URL));
            if (rules.length) {
                try {
                    localStorage.setItem(
                        RULES_CACHE_KEY,
                        JSON.stringify({
                            ts: Date.now(),
                            rules: rules.map((r) => ({ code: r.code, msg: r.msg, rx: r.rx, src: r.src, title: r.title, solution: r.solution })),
                        })
                    );
                } catch (e) {}
            }
            return rules;
        } catch (e) {
            console.warn('[cqr-err-helper] не вдалося завантажити базу правил:', e);
            return null;
        }
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Зіставлення помилки з правилом
     * ═══════════════════════════════════════════════════════════════ */
    const KNOWN_KEYS = ['code', 'message', 'source', 'itemId', 'productId', 'groupName', 'httpCode'];

    function fillTemplate(str, ctx) {
        return String(str == null ? '' : str)
            .replace(/\\n/g, '\n')
            .replace(/\{(\w+)\}/g, (m, k) => {
                if (ctx[k] != null && ctx[k] !== '') return String(ctx[k]);
                if (KNOWN_KEYS.includes(k)) return '—';
                return m;
            });
    }

    function matchRule(e) {
        const msg = String(e.message ?? '');
        for (const r of RULES) {
            if (r.code && String(e.code ?? '') !== String(r.code)) continue;
            if (r.src && String(e.source ?? '').toLowerCase() !== r.src.toLowerCase()) continue;
            if (r.msg && !msg.toLowerCase().includes(r.msg.toLowerCase())) continue;
            let groups = {};
            if (r.rx) {
                if (!r._re) continue;
                const mm = msg.match(r._re);
                if (!mm) continue;
                groups = mm.groups || {};
            }
            return { title: r.title || '(без заголовка)', text: fillTemplate(r.solution, { ...e, ...groups }) };
        }
        return null;
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Парсинг сторінки pos-data → обʼєкт помилки e
     * ═══════════════════════════════════════════════════════════════ */
    function safeJson(s) {
        try { return JSON.parse(s); } catch (e) { return null; }
    }

    // Кожен запис у <pre> відділений <br> і є JSON-рядком у лапках. Розгортаємо.
    function preLines(pre) {
        const raw = pre.innerHTML.replace(/<br\s*\/?>/gi, '\n');
        const tmp = document.createElement('div');
        return raw
            .split('\n')
            .map((l) => {
                tmp.innerHTML = l;
                return (tmp.textContent || '').trim();
            })
            .filter(Boolean)
            .map((l) => {
                const v = safeJson(l);
                return typeof v === 'string' ? v : l.replace(/^"|"$/g, '');
            });
    }

    const outsidePanel = (el) => !el.closest('#cqr-err-helper');

    // Сторінка-дамп: <h2>Payload</h2><pre>…</pre><h2>Response</h2><pre>…</pre>
    function extractFromDump() {
        const findings = [];
        const lines = [];
        [...document.querySelectorAll('pre')].filter(outsidePanel).forEach((pre) => lines.push(...preLines(pre)));

        for (const raw of lines) {
            if (typeof raw !== 'string') continue;
            // прибираємо префікс ISO-часу: "2026-09-04T07:32:36.703Z :: "
            const line = raw.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*::\s*/, '');
            const jsonStr = (line.match(/\{[\s\S]*\}/) || [])[0];
            const obj = jsonStr ? safeJson(jsonStr) : null;

            // 1. Syrve: обʼєкт статусу замовлення ({creationStatus, errorInfo, order})
            if (obj && ('creationStatus' in obj || 'errorInfo' in obj || 'orderInfo' in obj)) {
                const info = obj.orderInfo || obj;
                const ei = info.errorInfo;
                const status = info.creationStatus;
                if (status === 'Error' || (ei && typeof ei === 'object')) {
                    findings.push({
                        source: 'Syrve',
                        code: (ei && (ei.errorReason || ei.code)) || undefined,
                        httpCode: undefined,
                        message: (ei && (ei.message || ei.description)) || `creationStatus: ${status}`,
                        itemId: undefined,
                        raw: line,
                    });
                }
                continue; // InProgress / errorInfo:null — це не помилка
            }

            // 2. "Error: {"name":"HTTPError",…,"resultCode":404,"resultMessage":"{…}"}"
            let m = line.match(/^Error:\s*(\{[\s\S]*\})\s*$/);
            if (m) {
                const o = safeJson(m[1]) || {};
                const rm = o.resultMessage ? safeJson(o.resultMessage) : null;
                findings.push({
                    source: o.name || 'HTTPError',
                    code: rm && typeof rm.error === 'number' ? rm.error : undefined,
                    httpCode: o.resultCode,
                    message: (rm && rm.message) || o.code || line,
                    itemId: rm && (rm.item_id ?? rm.itemId),
                    raw: line,
                });
                continue;
            }

            // 3a. "[Poster] Cannot create receipt: <JSON або текст> [Table ID: …]."
            m = line.match(/^\[([^\]]+)\]\s*Cannot create receipt:\s*([\s\S]+)$/i);
            if (m) {
                const body = m[2].replace(/\s*\[Table ID[^\]]*\]\.?\s*$/i, '').trim();
                const o = safeJson((body.match(/\{[\s\S]*\}/) || [])[0] || '') || {};
                findings.push({
                    source: m[1].trim(),
                    code: typeof o.error === 'number' ? o.error : undefined,
                    httpCode: undefined,
                    message: o.message || body,
                    itemId: o.item_id ?? o.itemId,
                    productId: o.product_id ?? o.productId,
                    groupName: o.modification_group && o.modification_group.name,
                    raw: line,
                });
                continue;
            }

            // 3b. інші "[handler] … {json}" з ключовим словом помилки
            m = line.match(/^\[([^\]]+)\]\s*[^{]*?(\{[\s\S]*\})/);
            if (m && /(cannot|error|fail|unable|reject|invalid)/i.test(line)) {
                const o = safeJson(m[2]) || {};
                const hasErr =
                    typeof o.error === 'number' ||
                    (typeof o.message === 'string' && o.message.length < 400);
                if (hasErr) {
                    findings.push({
                        source: m[1].trim(),
                        code: typeof o.error === 'number' ? o.error : undefined,
                        httpCode: undefined,
                        message: o.message || line,
                        itemId: o.item_id ?? o.itemId,
                        productId: o.product_id ?? o.productId,
                        groupName: o.modification_group && o.modification_group.name,
                        raw: line,
                    });
                    continue;
                }
            }

            // 4. Голі JS-помилки
            if (/cannot read propert|is not defined|is not a function|unexpected token/i.test(line)) {
                findings.push({
                    source: 'JS',
                    message: line.replace(/^bad data:\s*/i, ''),
                    raw: line,
                });
            }
        }
        return dedupe(findings);
    }

    // Проста сторінка: <h2>Bad data: …</h2> або /error?message=…
    function extractSimple() {
        const q = new URLSearchParams(location.search).get('message');
        if (q) return [{ source: 'Bad data', message: q, raw: 'Bad data: ' + q }];

        const h2 = [...document.querySelectorAll('h2')].filter(outsidePanel)[0];
        if (h2 && /bad data|error/i.test(h2.textContent)) {
            const t = h2.textContent.replace(/\s+/g, ' ').trim();
            return [{ source: 'Bad data', message: t.replace(/^bad data:\s*/i, ''), raw: t }];
        }
        return [];
    }

    // Схлопує однакові помилки; серед дублікатів лишає найінформативніший запис.
    function dedupe(arr) {
        const score = (e) =>
            (/^(HTTPError|JS|Bad data)$/i.test(e.source || '') ? 0 : 2) +
            (e.httpCode ? 1 : 0) +
            ((e.itemId ?? '') !== '' ? 1 : 0);
        const byKey = new Map();
        for (const e of arr) {
            const k = (e.code ?? '') + '|' + (e.message || '');
            const prev = byKey.get(k);
            if (!prev) { byKey.set(k, e); continue; }
            const merged = score(e) > score(prev) ? { ...prev, ...clean(e) } : { ...e, ...clean(prev) };
            byKey.set(k, merged);
        }
        return [...byKey.values()];
    }
    function clean(o) {
        const r = {};
        for (const k in o) if (o[k] !== undefined && o[k] !== '' && o[k] !== null) r[k] = o[k];
        return r;
    }

    function collectErrors() {
        const h2 = [...document.querySelectorAll('h2')]
            .filter(outsidePanel)
            .map((h) => h.textContent.trim().toLowerCase());
        if (h2.includes('payload') || h2.includes('response')) return extractFromDump();
        return extractSimple();
    }

    function pickPrimary(errors) {
        return (
            errors.find((e) => e.code != null && e.message) ||
            errors.find((e) => e.message) ||
            errors[0]
        );
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Панель  (стани: known / unknown / clean)
     * ═══════════════════════════════════════════════════════════════ */
    const esc = (s) =>
        String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const HDR = {
        known: { bg: '#0f7b4a', text: '✅ Знайдено рішення' },
        unknown: { bg: '#8a6d00', text: '⚠️ Помилка без рішення в базі' },
        clean: { bg: '#4a4f57', text: 'ℹ️ POS data — помилок немає' },
    };

    function rulesNote() {
        if (!CONFIGURED)
            return '⚙️ У скрипті не вказано RULES_URL. Відкрий скрипт у Tampermonkey і встав пряме посилання на файл бази (JSON у GitHub або CSV Google-таблиці).';
        if (!RULES.length)
            return RULES_TRIED
                ? '⚠️ Базу помилок не вдалося завантажити. Перевір RULES_URL і доступ до мережі.'
                : 'База помилок завантажується…';
        return 'Цієї помилки ще немає в базі. Додай новий запис у файл бази з рішенням.';
    }

    function pageSnippet() {
        const t = (document.body.innerText || '').trim().replace(/\n{3,}/g, '\n\n');
        return t.length > 1200 ? t.slice(0, 1200) + '…' : t;
    }

    function injectStyleOnce() {
        if (document.getElementById('cqr-err-helper-style')) return;
        const style = document.createElement('style');
        style.id = 'cqr-err-helper-style';
        style.textContent = `
            #cqr-err-helper, #cqr-err-helper * { box-sizing: border-box; }
            #cqr-err-helper {
                position: fixed; top: 16px; right: 16px; z-index: 2147483647;
                width: 400px; max-width: calc(100vw - 32px);
                max-height: calc(100vh - 32px); background: #fff;
                border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;
                box-shadow: 0 8px 28px rgba(0,0,0,.16);
                font: 13px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                color: #1c1c1c; display: flex; flex-direction: column;
            }
            #cqr-err-helper .cqr-hdr {
                display: flex; align-items: center; gap: 6px; padding: 10px 12px;
                color: #fff; font-weight: 600; flex: 0 0 auto; cursor: default;
            }
            #cqr-err-helper .cqr-hdr .cqr-btn {
                cursor: pointer; background: rgba(255,255,255,.2); border: 0; color: #fff;
                border-radius: 4px; width: 22px; height: 22px; font-size: 13px; line-height: 1;
            }
            #cqr-err-helper .cqr-hdr .cqr-refresh { margin-left: auto; }
            #cqr-err-helper .cqr-body { padding: 12px; overflow: auto; flex: 1 1 auto; }
            #cqr-err-helper.collapsed .cqr-body { display: none; }
            #cqr-err-helper h5 {
                margin: 14px 0 6px; font-size: 11px; text-transform: uppercase;
                letter-spacing: .04em; color: #888;
            }
            #cqr-err-helper h5:first-child { margin-top: 0; }
            #cqr-err-helper .cqr-meta { color: #666; font-size: 11px; margin-bottom: 6px; }
            #cqr-err-helper .cqr-err-text {
                background: #fdecec; border: 1px solid #f3c2c2; color: #a12020;
                padding: 8px 10px; border-radius: 6px; white-space: pre-wrap;
                word-break: break-word; font-family: ui-monospace, Menlo, Consolas, monospace;
                font-size: 12px;
            }
            #cqr-err-helper .cqr-info-text {
                background: #eef1f4; border: 1px solid #d7dde3; color: #3a4048;
                padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word;
            }
            #cqr-err-helper .cqr-sol-title { font-weight: 600; margin-bottom: 6px; }
            #cqr-err-helper .cqr-sol-text {
                background: #f4f7f5; border: 1px solid #d9e5df; border-radius: 6px;
                padding: 10px; white-space: pre-wrap; word-break: break-word;
            }
            #cqr-err-helper .cqr-actions { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
            #cqr-err-helper .cqr-actions button {
                cursor: pointer; border: 1px solid #cfcfcf; background: #fafafa;
                border-radius: 5px; padding: 6px 10px; font-size: 12px;
            }
            #cqr-err-helper .cqr-actions button:hover { background: #f0f0f0; }
            #cqr-err-helper details { margin-top: 12px; }
            #cqr-err-helper details pre {
                white-space: pre-wrap; word-break: break-word; font-size: 11px;
                background: #f6f6f6; border: 1px solid #e3e3e3; border-radius: 6px; padding: 8px;
            }
        `;
        document.head.appendChild(style);
    }

    function bodyHtml(state, primary, hit) {
        if (state === 'clean') {
            const onForm = !!document.querySelector('form input[name="url"], #company');
            const hint = onForm
                ? 'Встав Order URL і натисни Send — тут зʼявиться розбір помилки з відповіді POS.'
                : 'У відповіді POS помилок не виявлено. Якщо чек не створився — надішли цю сторінку в підтримку.';
            return `
                <h5>Статус</h5>
                <div class="cqr-info-text">${esc(hint)}</div>
                <div class="cqr-actions">
                    <button data-act="copy-page">Копіювати вміст сторінки</button>
                    <button data-act="back">Назад</button>
                </div>
                <details><summary>Вміст сторінки</summary><pre>${esc(pageSnippet())}</pre></details>
            `;
        }

        const meta = [
            primary.source && `джерело: ${primary.source}`,
            (primary.code ?? '') !== '' && `код: ${primary.code}`,
            primary.httpCode && `HTTP: ${primary.httpCode}`,
            (primary.itemId ?? '') !== '' && `item_id: ${primary.itemId}`,
        ].filter(Boolean).join(' · ');

        const solBlock = hit
            ? `<div class="cqr-sol-title">${esc(hit.title)}</div>
               <div class="cqr-sol-text">${esc(hit.text)}</div>`
            : `<div class="cqr-info-text">${esc(rulesNote())}</div>`;

        return `
            <h5>Помилка</h5>
            ${meta ? `<div class="cqr-meta">${esc(meta)}</div>` : ''}
            <div class="cqr-err-text">${esc(primary.message || primary.raw)}</div>
            <h5>Рішення</h5>
            ${solBlock}
            <div class="cqr-actions">
                <button data-act="copy-err">Копіювати помилку</button>
                ${hit ? '<button data-act="copy-sol">Копіювати рішення</button>' : ''}
                <button data-act="back">Назад</button>
            </div>
            <details><summary>Сирий рядок помилки</summary><pre>${esc(primary.raw)}</pre></details>
        `;
    }

    function render(state, primary, hit) {
        injectStyleOnce();

        const panel = document.createElement('div');
        panel.id = 'cqr-err-helper';
        panel.innerHTML = `
            <div class="cqr-hdr" style="background:${HDR[state].bg}">
                <span>${HDR[state].text}</span>
                <button class="cqr-btn cqr-refresh" title="Оновити базу помилок">⟳</button>
                <button class="cqr-btn cqr-toggle" title="Згорнути / розгорнути">–</button>
            </div>
            <div class="cqr-body">${bodyHtml(state, primary, hit)}</div>
        `;
        document.body.appendChild(panel);

        const toggleBtn = panel.querySelector('.cqr-toggle');
        const setCollapsed = (c) => {
            panel.classList.toggle('collapsed', c);
            toggleBtn.textContent = c ? '+' : '–';
            try { localStorage.setItem(LS_KEY, c ? '1' : '0'); } catch (e) {}
        };
        setCollapsed((() => { try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; } })());
        toggleBtn.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

        const refreshBtn = panel.querySelector('.cqr-refresh');
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.textContent = '…';
            try { localStorage.removeItem(RULES_CACHE_KEY); } catch (e) {}
            const r = await fetchRules();
            if (r) { RULES = r; RULES_REV++; }
            const p = document.getElementById('cqr-err-helper');
            if (p) p.remove();
            run();
        });

        panel.addEventListener('click', (e) => {
            const act = e.target.getAttribute && e.target.getAttribute('data-act');
            if (!act) return;
            if (act === 'copy-err') navigator.clipboard.writeText(primary ? primary.raw : '');
            if (act === 'copy-sol') navigator.clipboard.writeText(hit ? hit.title + '\n\n' + hit.text : '');
            if (act === 'copy-page') navigator.clipboard.writeText(pageSnippet());
            if (act === 'back') { document.referrer ? (location.href = document.referrer) : history.back(); }
        });
    }

    function run() {
        try {
            const errors = collectErrors();
            const primary = errors.length ? pickPrimary(errors) : null;
            const hit = primary ? matchRule(primary) : null;
            const state = !primary ? 'clean' : hit ? 'known' : 'unknown';
            const sig = [state, RULES_REV, primary ? (primary.code ?? '') : '', primary ? primary.message || '' : ''].join('|');

            const existing = document.getElementById('cqr-err-helper');
            if (existing) {
                if (existing.dataset.sig === sig) return;
                existing.remove();
            }
            render(state, primary, hit);
            document.getElementById('cqr-err-helper').dataset.sig = sig;
        } catch (e) {
            console.error('[cqr-err-helper]', e);
        }
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Старт
     * ═══════════════════════════════════════════════════════════════ */
    (function boot() {
        const c = readCache();
        if (c) RULES = c.rules;
        run(); // миттєво: з кешу або порожньо

        const fresh = c && Date.now() - c.ts < RULES_TTL_MS;
        if (!fresh) {
            fetchRules().then((r) => {
                if (r) {
                    RULES = r;
                    RULES_REV++;
                }
                const p = document.getElementById('cqr-err-helper');
                if (p) p.remove();
                run();
            });
        }

        const mo = new MutationObserver(run);
        mo.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => mo.disconnect(), 5000);
    })();
})();
