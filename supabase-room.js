/*
 * Live rooms for Morse Key, powered by Supabase Realtime.
 *
 * The page talks to a small "room" API: join(name) returns an object with
 * emit, on, presence, onPeers, onConnection, connected and leave. This file
 * provides that API on top of a Supabase Realtime channel, so the page code
 * does not need to know which service is underneath.
 *
 * Nothing is stored. Broadcast messages and presence are live only, and no
 * database tables are used.
 */
(function () {
  'use strict';

  var cfg = window.MORSE_CONFIG || {};
  var url = String(cfg.supabaseUrl || '');
  var key = String(cfg.supabaseAnonKey || '');
  if (window.claude) return; // running inside Claude: it provides its own rooms
  if (!window.supabase || !url || !key || /YOUR[-_ ]/i.test(url + key)) return; // not configured: chat stays local

  var client;
  try {
    client = window.supabase.createClient(url, key, {
      realtime: { params: { eventsPerSecond: 40 } }
    });
  } catch (e) {
    return;
  }

  var ME = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(16).slice(2);

  // Broadcast events the page uses. 'kst' carries the "is keying" lamp state.
  var EVENTS = ['chat', 'key', 'kst'];

  function join(name) {
    return new Promise(function (resolve, reject) {
      var ch = client.channel('morse:' + name, {
        config: { broadcast: { self: false }, presence: { key: ME } }
      });

      var topicHandlers = { chat: [], key: [] };
      var peerHandlers = [];
      var connHandlers = [];
      var meta = {};
      var keyOf = {};
      var prev = {};
      var connected = false;
      var settled = false;
      var closed = false;

      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { client.removeChannel(ch); } catch (e) {}
        reject({ code: 'upstream_error', message: 'Timed out joining the room.' });
      }, 10000);

      function makePeer(k, m) {
        return {
          peer: k, by: null, isMe: k === ME, sameTab: k === ME,
          kind: 'viewer', guest: false,
          presence: { n: m.n, c: m.c, k: keyOf[k] ? 1 : 0 },
          updatedAt: Date.now()
        };
      }
      function buildPeers() {
        var st = ch.presenceState(), list = [], seenMe = false;
        Object.keys(st).forEach(function (k) {
          var m = (st[k] && st[k][0]) || {};
          if (k === ME) seenMe = true;
          list.push(makePeer(k, k === ME ? meta : m));
        });
        if (!seenMe) list.unshift(makePeer(ME, meta));
        return list;
      }
      function notify() {
        if (closed) return;
        var list = buildPeers(), cur = {};
        list.forEach(function (p) { cur[p.peer] = p; });
        var left = Object.keys(prev).filter(function (k) { return !cur[k]; }).map(function (k) { return prev[k]; });
        var joined = list.filter(function (p) { return !prev[p.peer]; });
        prev = cur;
        var change = { peers: list, joined: joined, left: left, updated: [] };
        peerHandlers.slice().forEach(function (fn) { try { fn(change); } catch (e) {} });
      }

      EVENTS.forEach(function (ev) {
        ch.on('broadcast', { event: ev }, function (m) {
          var pl = (m && m.payload) || {};
          var from = String(pl.p || '');
          if (!from || from === ME) return;
          if (ev === 'kst') {
            keyOf[from] = pl.d && pl.d.k ? 1 : 0;
            notify();
            return;
          }
          var msg = { topic: ev, data: pl.d, peer: from, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false };
          (topicHandlers[ev] || []).slice().forEach(function (fn) { try { fn(msg); } catch (e) {} });
        });
      });
      ch.on('presence', { event: 'sync' }, notify);

      var api = {
        name: name,
        emit: function (topic, data) {
          if (closed || !connected) return Promise.resolve();
          return Promise.resolve(ch.send({ type: 'broadcast', event: topic, payload: { p: ME, d: data } }))
            .then(function (r) {
              if (r === 'error') throw { code: 'upstream_error', message: 'Send failed.' };
            });
        },
        on: function (topic, fn) {
          if (typeof fn !== 'function') throw new TypeError('handler must be a function');
          var list = topicHandlers[topic];
          if (!list) return function () {};
          list.push(fn);
          return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
        },
        presence: function (patch) {
          if (closed) return Promise.resolve();
          var out = [];
          if ('n' in patch || 'c' in patch) {
            if ('n' in patch) meta.n = patch.n;
            if ('c' in patch) meta.c = patch.c;
            out.push(Promise.resolve(ch.track(meta)));
          }
          if ('k' in patch) {
            var on = patch.k ? 1 : 0;
            keyOf[ME] = on;
            notify();
            if (connected) out.push(Promise.resolve(ch.send({ type: 'broadcast', event: 'kst', payload: { p: ME, d: { k: on } } })));
          }
          return Promise.all(out).then(function () {});
        },
        peers: function () { return buildPeers(); },
        onPeers: function (fn) {
          if (typeof fn !== 'function') throw new TypeError('handler must be a function');
          peerHandlers.push(fn);
          setTimeout(function () {
            if (closed || peerHandlers.indexOf(fn) < 0) return;
            var list = buildPeers(), cur = {};
            list.forEach(function (p) { cur[p.peer] = p; });
            prev = cur;
            try { fn({ peers: list, joined: list, left: [], updated: [] }); } catch (e) {}
          }, 0);
          return function () { var i = peerHandlers.indexOf(fn); if (i >= 0) peerHandlers.splice(i, 1); };
        },
        connected: function () { return connected; },
        onConnection: function (fn) {
          if (typeof fn !== 'function') throw new TypeError('handler must be a function');
          connHandlers.push(fn);
          setTimeout(function () { if (!closed && connHandlers.indexOf(fn) >= 0) { try { fn(connected); } catch (e) {} } }, 0);
          return function () { var i = connHandlers.indexOf(fn); if (i >= 0) connHandlers.splice(i, 1); };
        },
        leave: function () {
          if (closed) return Promise.resolve();
          closed = true;
          peerHandlers.length = 0; connHandlers.length = 0;
          topicHandlers = { chat: [], key: [] };
          try { client.removeChannel(ch); } catch (e) {}
          return Promise.resolve();
        }
      };

      ch.subscribe(function (status) {
        var c = status === 'SUBSCRIBED';
        if (c && !settled) { settled = true; clearTimeout(timer); resolve(api); }
        if (!c && !settled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
          settled = true; clearTimeout(timer);
          try { client.removeChannel(ch); } catch (e) {}
          reject({ code: 'upstream_error', message: 'Could not open the room (' + status + ').' });
          return;
        }
        if (c !== connected) {
          connected = c;
          // After a dropped connection the server forgets who we are, so announce again.
          if (c && meta.n !== undefined && !closed) { try { ch.track(meta); } catch (e) {} }
          connHandlers.slice().forEach(function (fn) { try { fn(c); } catch (e) {} });
        }
      });
    });
  }

  window.claude = {
    use: function (name) {
      return Promise.resolve(name === 'room' ? { join: join } : null);
    }
  };
})();
