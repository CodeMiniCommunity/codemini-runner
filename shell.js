// CodeMini runner shell. This page lives on its OWN origin, so everything a previewed page does here (storage,
// cookies, scripts) is walled off from the CodeMini app. It does three small things and nothing else:
//
//   1. mint blob: URLs for files CodeMini sends (a blob URL only works for pages of the origin that made it, so
//      they have to be made here), and show one of them in the inner frame;
//   2. relay postMessage traffic between CodeMini and the previewed page (console, network, inspector, reload);
//   3. refuse everything that does not come from an allowed CodeMini origin.
//
// It holds no secrets and reads nothing from the app. The previewed page shares this origin, so it can reach this
// script's window; that is why CodeMini treats every message that comes back as untrusted data, wraps relayed page
// messages in an envelope, and authenticates control messages with a nonce only this shell and CodeMini know.
(function () {
    'use strict';
    var CFG = window.CM_RUNNER_CONFIG || { allowedParents: [] };
    var SELF = location.origin;
    var host = window.parent !== window ? window.parent : null;   // the CodeMini window; a runner opened on its own does nothing
    var hostOrigin = null, nonce = null;
    var page = document.getElementById('page');
    var minted = Object.create(null);                              // blob: URLs this shell made
    var shown = 0, current = '';                                   // current: the blob URL the frame is known to be showing                                                 // id of the latest 'show' request
    var MAX_BLOB = 256 * 1024 * 1024;
    var SHOW_MS = 4000;                                            // how long a frame may stay blank before we call the page failed

    function allowed(origin) { return CFG.allowedParents.indexOf(origin) !== -1; }
    function send(msg) {
        if (!host || !hostOrigin) return;
        if (msg.op !== 'page') msg.nonce = nonce;
        try { host.postMessage(msg, hostOrigin); } catch (e) { /* the app window is gone */ }
    }

    function control(e, d) {
        if (d.op === 'hello') {
            if (hostOrigin) return;                                // the first valid hello pins the host for this load
            if (typeof d.nonce !== 'string' || d.nonce.length < 16 || d.nonce.length > 128) return;
            hostOrigin = e.origin; nonce = d.nonce;
            send({ cmRunner: 1, op: 'hello-ack' });
            return;
        }
        if (!hostOrigin) return;
        if (d.op === 'mint') {
            var b = d.blob;
            if (!(b instanceof Blob) || b.size > MAX_BLOB) { send({ cmRunner: 1, op: 'minted', id: d.id, error: 'bad blob' }); return; }
            try { var url = URL.createObjectURL(b); minted[url] = true; send({ cmRunner: 1, op: 'minted', id: d.id, url: url }); }
            catch (err) { send({ cmRunner: 1, op: 'minted', id: d.id, error: String(err && err.message || err) }); }
        } else if (d.op === 'revoke') {
            (Array.isArray(d.urls) ? d.urls : []).forEach(function (u) { if (minted[u]) { URL.revokeObjectURL(u); delete minted[u]; } });
        } else if (d.op === 'show') {
            if (typeof d.url !== 'string' || !minted[d.url]) { send({ cmRunner: 1, op: 'shown', id: d.id, error: 'unknown url' }); return; }
            shown = d.id; current = '';
            var mine = d.id, want = d.url, done = false, deadline = Date.now() + SHOW_MS, timer = null;
            // Report once the frame really shows OUR page. The first `load` event can belong to the frame's old
            // about:blank (WebKit fires it), so events alone prove nothing: look at what the frame holds.
            //   our page, finished  -> loaded         our page, still going at the deadline -> loaded
            //   foreign / unreachable (blocked)  -> failed at once        still blank at the deadline -> failed
            var finish = function (error) {
                if (done) return; done = true; clearInterval(timer); page.onload = null;
                if (mine !== shown) return;
                send(error ? { cmRunner: 1, op: 'shown', id: mine, error: 'the page did not load: ' + error } : { cmRunner: 1, op: 'shown', id: mine });
            };
            var look = function () {
                if (done) return;
                if (mine !== shown) { finish(); return; }
                var w, doc;
                try { w = page.contentWindow; doc = w && w.document; }
                catch (err) { finish('the frame is not reachable (' + (err && err.name) + ')'); return; }
                var here = '';
                try { here = (doc && doc.documentElement) ? w.location.href : ''; }
                catch (err) { finish('the frame is not reachable (' + (err && err.name) + ')'); return; }
                if (here === want) { if (doc.readyState === 'complete' || Date.now() >= deadline) { current = want; finish(); } return; }
                if (Date.now() >= deadline) finish(here ? 'the frame still shows ' + here.split(':')[0] + ': after ' + (SHOW_MS / 1000) + ' s' : 'the frame stayed empty for ' + (SHOW_MS / 1000) + ' s');
            };
            page.onload = look;
            timer = setInterval(look, 100);
            page.src = d.url;
        } else if (d.op === 'rewrite') {
            // The "in-place rewrite" reload mode: write new HTML into the document that is already showing, keeping its
            // window. Only possible while the frame still holds a page we put there (same origin as this shell).
            try {
                var rw = page.contentWindow, rdoc = rw && rw.document;
                if (typeof d.html !== 'string' || d.html.length > MAX_BLOB) throw new Error('bad html');
                if (!current || !rdoc || !rdoc.documentElement || rw.location.href !== current) throw new Error('no page to rewrite');
                rdoc.open(); rdoc.write(d.html); rdoc.close();
                // document.open() makes the document adopt THIS script's address, so that is what the frame shows now;
                // remember it, or the next rewrite would think the page had been replaced.
                current = rw.location.href;
                send({ cmRunner: 1, op: 'rewritten', id: d.id });
            } catch (err) { send({ cmRunner: 1, op: 'rewritten', id: d.id, error: String(err && err.message || err) }); }
        } else if (d.op === 'clear') {
            current = ''; shown = 0; page.onload = null; page.src = 'about:blank';
        }
    }

    window.addEventListener('message', function (e) {
        var d = e.data;
        if (host && e.source === host) {
            if (!allowed(e.origin)) return;
            if (hostOrigin && e.origin !== hostOrigin) return;
            if (d && typeof d === 'object' && d.cmRunner === 1) { control(e, d); return; }
            if (!hostOrigin) return;                               // nothing is relayed before the handshake
            try { if (page.contentWindow) page.contentWindow.postMessage(d, SELF); } catch (err) { /* page is gone */ }
            return;
        }
        if (page.contentWindow && e.source === page.contentWindow) {
            // Only the page we put there, and only while it is still on this origin (a page that navigated to another
            // site does not get to talk to the app through us).
            if (e.origin !== SELF || !hostOrigin) return;
            send({ cmRunner: 1, op: 'page', data: d });
        }
    });

    // Tell the embedding window we are here. The message carries nothing private. Chrome and Safari tell us who
    // embeds us, so we can address them exactly; elsewhere the (empty) announcement goes to any parent and the real
    // exchange only starts when an allowed origin answers.
    if (host) {
        var guess = (location.ancestorOrigins && location.ancestorOrigins[0]) || null;
        if (!guess || allowed(guess)) host.postMessage({ cmRunner: 1, op: 'ready', v: 1 }, guess || '*');
    }
})();
