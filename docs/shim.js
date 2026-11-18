/* Nam Phương TV – bản web (iPhone/iPad: Safari → Chia sẻ → Thêm vào MH chính).
   Thay cho cầu nối Java "Android" của app: lưu cài đặt, tải kênh, trình phát kênh/phim. */
(function () {
  "use strict";
  const LS = "np_";
  const VERSION = "web";
  const M3U = ["https://iptv-org.github.io/iptv/countries/vn.m3u",
               "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/vn.m3u"];
  const GROUPS = ["THVL", "HTV – HTVC", "VTV", "Đài địa phương", "SCTV", "ON (VTVcab)", "An ninh – Quốc phòng", "Khác"];
  const HLSJS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
  const isHttps = location.protocol === "https:";
  const call = (fn, arg) => { try { window[fn] && window[fn](arg); } catch (e) { console.error(e); } };

  /* ---------- kênh truyền hình: giống LiveTv.java ---------- */
  const strip = s => s.normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  function cleanName(n) {
    const c = n.replace(/\s*\([^)]*\)/g, "").replace(/\s*\[[^\]]*\]/g, "").trim();
    const m = strip(c).toUpperCase().match(/^(?:VINH LONG(?: TV)?|THVL)\s*(\d+)/);
    return m ? "THVL" + m[1] : c;
  }
  const key = n => strip(n).toLowerCase().split(/[^a-z0-9]+/).filter(w => w && w !== "tv" && w !== "hd").join("");
  const quality = n => +((n.match(/(\d{3,4})[pi]/) || [])[1] || 0);
  const natural = n => strip(n).toLowerCase().replace(/\d+/g, d => d.padStart(4, "0"));
  function classify(name) {
    const n = strip(name).toUpperCase();
    if (n.startsWith("THVL")) return 0;
    if (/^VTV\d/.test(n) || n.startsWith("VIETNAM TODAY")) return 2;
    if (n.startsWith("HTV")) return 1;
    if (n.startsWith("SCTV")) return 4;
    if (n.startsWith("ON ")) return 5;
    if (/ANTV|AN NINH|QPVN|QUOC PHONG/.test(n)) return 6;
    if (n.startsWith("TVB")) return 7;
    return 3;
  }
  function parse(text) {
    const raws = []; let name = null, logo = null, headers = {};
    for (const l0 of text.split(/\r?\n/)) {
      const l = l0.trim();
      if (l.startsWith("#EXTINF")) {
        const c = l.indexOf(","); name = c >= 0 ? l.slice(c + 1).trim() : "Kênh";
        logo = (l.match(/tvg-logo="([^"]*)"/) || [])[1] || null;
        headers = {};
        const r = (l.match(/http-referrer="([^"]*)"/) || [])[1]; if (r) headers.Referer = r;
      } else if (l.startsWith("#EXTVLCOPT:http-referrer=")) headers.Referer = l.slice(l.indexOf("=") + 1);
      else if (l.startsWith("#") || !l) { /* bỏ qua */ }
      else if (name != null) { raws.push({ name, logo, url: l, headers }); name = null; }
    }
    const by = new Map();
    for (const r of raws) { const k = key(cleanName(r.name)) || r.name; (by.get(k) || by.set(k, []).get(k)).push(r); }
    const out = [];
    for (const items of by.values()) {
      items.sort((a, b) => quality(b.name) - quality(a.name));
      const nm = cleanName(items[0].name);
      out.push({ name: nm, group: classify(nm), logo: (items.find(x => x.logo) || {}).logo || "",
                 urls: [...new Set(items.map(x => x.url))], headers: items[0].headers });
    }
    out.sort((a, b) => a.group - b.group || natural(a.name).localeCompare(natural(b.name)));
    return GROUPS.map((t, g) => ({ title: t, channels: out.filter(c => c.group === g) })).filter(g => g.channels.length);
  }
  let liveJson = "", liveLoading = false;
  async function loadLive() {
    if (liveLoading) return; liveLoading = true;
    let text = null, err = null;
    for (const u of M3U) {
      try { const r = await fetch(u, { cache: "no-store" }); if (r.ok) { const t = await r.text(); if (t.includes("#EXTINF")) { text = t; break; } } }
      catch (e) { err = e.message; }
    }
    let fromCache = false, time = Date.now();
    if (text) { try { localStorage[LS + "m3u"] = text; localStorage[LS + "m3u_t"] = time; } catch (e) {} }
    else if (localStorage[LS + "m3u"]) { text = localStorage[LS + "m3u"]; fromCache = true; time = +localStorage[LS + "m3u_t"] || time; }
    liveJson = JSON.stringify(text ? { ok: true, fromCache, time, groups: parse(text) }
                                   : { ok: false, error: err || "Không tải được danh sách kênh", groups: [] });
    liveLoading = false;
    call("onLiveTv", liveJson);
  }

  /* ---------- trình phát (kênh trực tiếp + phim) ---------- */
  let hlsLib = null;
  const loadHls = () => hlsLib || (hlsLib = new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = HLSJS; s.onload = () => ok(window.Hls); s.onerror = no; document.head.appendChild(s);
  }));
  const css = `
  #npp{position:fixed;inset:0;z-index:100;background:#000;display:none;flex-direction:column;color:#fff;font-family:inherit}
  #npp.show{display:flex}
  #npp .bar{display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top) + 8px) 10px 8px;background:#14161e}
  #npp .bar b{flex:1;min-width:0;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #npp button{min-width:48px;height:44px;border:0;border-radius:12px;background:#2f3346;color:#fff;font-size:15px;font-weight:700;padding:0 12px}
  #npp button.gold{background:#ffd875;color:#191b24}
  #npp .stage{flex:1;position:relative;background:#000}
  #npp video,#npp iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}
  #npp .msg{position:absolute;left:50%;top:16px;transform:translateX(-50%);background:#000c;padding:8px 14px;border-radius:10px;font-size:14px;max-width:90%;text-align:center}
  .field:has(#upd-check), #player-toggle { display:none !important }`;
  let P = null;
  function ui() {
    if (P) return P;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const d = document.createElement("div"); d.id = "npp";
    d.innerHTML = `<div class="bar"><button id="npp-x" aria-label="Đóng">✕</button><b id="npp-t"></b>
      <button id="npp-prev" aria-label="Trước">‹</button><button id="npp-next" class="gold" aria-label="Sau">›</button></div>
      <div class="stage" id="npp-s"></div>`;
    document.body.appendChild(d);
    P = { root: d, title: d.querySelector("#npp-t"), stage: d.querySelector("#npp-s"), list: [], i: 0, kind: "" };
    d.querySelector("#npp-x").onclick = close;
    d.querySelector("#npp-prev").onclick = () => go(-1);
    d.querySelector("#npp-next").onclick = () => go(1);
    document.addEventListener("keydown", e => {
      if (!d.classList.contains("show")) return;
      const k = e.key;
      if (k === "Escape" || k === "Backspace" || k === "GoBack") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (P.kind === "live" && (k === "ArrowRight" || k === "ArrowUp" || k === "ChannelUp")) { e.preventDefault(); e.stopImmediatePropagation(); go(1); }
      else if (P.kind === "live" && (k === "ArrowLeft" || k === "ArrowDown" || k === "ChannelDown")) { e.preventDefault(); e.stopImmediatePropagation(); go(-1); }
      else e.stopImmediatePropagation();
    }, true);
    return P;
  }
  let hls = null;
  function clear() { if (hls) { hls.destroy(); hls = null; } P.stage.innerHTML = ""; }
  function msg(t) { let m = P.stage.querySelector(".msg"); if (!m) { m = document.createElement("div"); m.className = "msg"; P.stage.appendChild(m); } m.textContent = t; m.hidden = !t; }
  function close() { clear(); P.root.classList.remove("show"); document.body.style.overflow = ""; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
  function open() { P.root.classList.add("show"); document.body.style.overflow = "hidden"; }

  // phát 1 link HLS (Safari/iPhone phát trực tiếp, máy khác dùng hls.js); lỗi thì gọi onFail
  async function playHls(url, onFail) {
    clear();
    const v = document.createElement("video");
    v.setAttribute("playsinline", ""); v.controls = true; v.autoplay = true;
    P.stage.appendChild(v); msg("Đang tải…");
    v.addEventListener("playing", () => msg(""));
    v.addEventListener("error", () => onFail());
    if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = url; v.play().catch(() => {}); return; }
    try {
      const Hls = await loadHls();
      if (!Hls.isSupported()) { v.src = url; return; }
      hls = new Hls(); hls.loadSource(url); hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) onFail(); });
    } catch (e) { onFail(); }
  }
  function playChannel() {
    const c = P.list[P.i];
    const urls = c.urls.filter(u => !isHttps || u.startsWith("https:"));
    P.title.textContent = (P.i + 1) + "  " + c.name;
    try { localStorage[LS + "live_last"] = c.name; } catch (e) {}
    let k = 0;
    const next = () => {
      if (k >= urls.length) { clear(); msg(urls.length ? "Kênh này hiện không xem được trên trình duyệt. Bấm › để đổi kênh."
                                               : "Kênh này chỉ có link http, trình duyệt không mở được. Bấm › để đổi kênh."); return; }
      const u = urls[k++]; playHls(u, () => { if (k < urls.length) msg("Link lỗi, thử link " + (k + 1) + "…"); setTimeout(next, 500); });
    };
    next();
  }
  function playEpisode() {
    const ep = P.list[P.i];
    P.title.textContent = P.base + (P.list.length > 1 ? " · Tập " + ep.name : "");
    if (ep.m3u8) { playHls(ep.m3u8, () => frame(ep.embed)); return; }
    frame(ep.embed);
  }
  function frame(src) {
    clear();
    if (!src) { msg("Tập này không có link phát."); return; }
    const f = document.createElement("iframe");
    f.src = src; f.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media"; f.allowFullscreen = true;
    f.referrerPolicy = "no-referrer";
    P.stage.appendChild(f);
  }
  function go(d) {
    const n = P.list.length; if (!n) return;
    if (P.kind === "live") { P.i = ((P.i + d) % n + n) % n; playChannel(); }
    else { const j = P.i + d; if (j < 0 || j >= n) return; P.i = j; playEpisode(); }
  }

  /* ---------- cầu nối thay cho app Android ---------- */
  window.Android = {
    getPref: (k, d) => { const v = localStorage[LS + k]; return v == null ? d : v; },
    setPref: (k, v) => { try { localStorage[LS + k] = v; } catch (e) {} },
    getVersion: () => VERSION,
    liveTvCached: () => liveJson,
    liveTvRefresh: () => loadLive(),
    playLive: (json, i) => { ui(); P.kind = "live"; P.list = JSON.parse(json); P.i = i; open(); playChannel(); },
    play: (title, eps, i, base, mode) => { ui(); P.kind = "movie"; P.base = title; P.list = JSON.parse(eps); P.i = i; open(); playEpisode(); }
  };
  document.addEventListener("DOMContentLoaded", () => { ui(); loadLive(); });
})();
