/* Ukraine Support in the 120th Congress: beeswarm dashboard, particle layout, Monte Carlo pivots */
(function () {
  "use strict";
  const DATA = window.UKRAINE_DATA;
  if (!DATA || !DATA.members) {
    document.body.insertAdjacentHTML("beforeend", '<div style="padding:60px">data.js missing or empty</div>');
    return;
  }
  const SUB = DATA.subtopics;
  const MEM = DATA.members;
  const svgNS = "http://www.w3.org/2000/svg";

  const NEEDED = { senate: { simple: 51, veto: 67, cloture: 60 }, house: { simple: 218, veto: 290, cloture: 290 } };
  const PARTY_COLOR = { D: "#4c9aff", R: "#ff5c6c", I: "#b6a4ff" };

  // ---------- scoring ----------
  function scoreOf(m, topic) {
    const s = (m.scores || {})[topic === "overall" ? "overall" : topic] || {};
    return {
      score: typeof s.score === "number" ? s.score : 0,
      conf: typeof s.confidence === "number" ? s.confidence : 0,
      inferred: !!s.inferred,
    };
  }
  function fmt(v) { return (v >= 0 ? "+" : "\u2212") + Math.abs(v).toFixed(2); }

  // ---------- Monte Carlo pivots ----------
  const TRIALS = 1000;
  function kthSmallest(arr, k) {
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const pivot = arr[lo + ((Math.random() * (hi - lo + 1)) | 0)];
      let i = lo, j = hi;
      while (i <= j) {
        while (arr[i] < pivot) i++;
        while (arr[j] > pivot) j--;
        if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i++; j--; }
      }
      if (k <= j) hi = j; else if (k >= i) lo = i; else return arr[k];
    }
    return arr[k];
  }
  function pivotStats(chamber, topic, threshold, fcl) {
    const arr = MEM.filter((m) => m.chamber === chamber).map((m) => ({ s: scoreOf(m, topic), party: m.party }));
    const pools = { D: [], R: [], I: [] };
    for (const a of arr) (pools[a.party] || pools.I).push(a.s.score);
    const n = NEEDED[chamber][threshold];
    const k = arr.length - n;
    const scratch = new Float64Array(arr.length);
    const pivots = new Float64Array(TRIALS);
    for (let t = 0; t < TRIALS; t++) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i].s;
        const w = fcl > 0 ? Math.min(a.conf / fcl, 1) : 1;
        if (Math.random() < w) {
          scratch[i] = a.score;
        } else {
          const pool = pools[arr[i].party] || pools.I;
          scratch[i] = pool.length ? pool[(Math.random() * pool.length) | 0] : a.score;
        }
      }
      pivots[t] = kthSmallest(scratch, k);
    }
    const s = Array.from(pivots).sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    return { median: q(0.5), lo90: q(0.05), hi90: q(0.95), lo99: q(0.005), hi99: q(0.995) };
  }

  // ---------- legislation lookup ----------
  function legislationText(score, isOverall, veto) {
    const table = isOverall ? [
      [0.75, "A large Ukraine aid package, 40 billion dollars or more per cycle, advanced weapons included and no new preconditions, could pass."],
      [0.5, "Aid packages at recent levels, 10 to 40 billion dollars, with light oversight conditions, would pass. Support stays steady."],
      [0.25, "Continued aid in modest tranches, 1 to 10 billion dollars, with binding oversight and conditions. Major new packages would fail."],
      [0, "Small, tightly conditioned aid only. Existing commitments get maintenance funding; new major packages fail."],
      [-0.25, "New aid would fail. Only existing sanctions and minimal commitments survive."],
      [-9, "Aid cutoffs and sanctions relief could pass. Policy tilts toward accepting Russian terms."],
    ] : [
      [0.75, "Maximal positions on this issue could pass, including the strongest measures members have proposed."],
      [0.5, "Strong positions on this issue pass, with conditions and oversight attached."],
      [0.25, "Moderate positions pass. The chamber would act, but the boldest measures on this issue fall short."],
      [0, "Only mild gestures on this issue pass. Bold measures fall short."],
      [-0.25, "No new action on this issue would pass."],
      [-9, "Positions favoring Russia on this issue could pass."],
    ];
    for (const [floor, text] of table) {
      if (score >= floor) return text;
    }
    return table[table.length - 1][1];
  }

  // ---------- layout config ----------
  const charts = {
    senate: {
      svg: document.getElementById("senateSvg"), sub: document.getElementById("senateSub"),
      scoreEl: document.getElementById("senateScore"), rangeEl: document.getElementById("senateRanges"),
      exEl: document.getElementById("senateExamples"),
      w: 1600, h: 297, font: 12.35, pad: 13.3,
    },
    house: {
      svg: document.getElementById("houseSvg"), sub: document.getElementById("houseSub"),
      scoreEl: document.getElementById("houseScore"), rangeEl: document.getElementById("houseRanges"),
      exEl: document.getElementById("houseExamples"),
      w: 1600, h: 450, font: 7.2, pad: 6,
    },
  };
  // ---------- simulation tuning (exposed for the layout tests) ----------
  const SIM = {
    attract: 0.16,     // constant spring pulling x toward the target
    center: 0.004,     // gentle vertical pull toward the axis center
    repel: 34,         // pair repulsion strength
    substeps: 2,       // integration substeps per frame step (smoother motion)
    fxScale: 0.30,     // share of repulsion applied in x (rest is vertical)
    collideFloor: 0.12, // collision strength at the start (weak pass-through)
    wall: 1.0,
    damp: 0.78,
    vmaxFast: 3.4,
    vmaxSlow: 0.25,
    steps: 336,
  };
  const MARGIN = { l: 70, r: 70, t: 2, b: 44 };
  // Temporary finder highlight: ?hi=<slug> or ?hi=statements (gold members with
  // a sourced statement on the current topic). Default 'statements' for now (remove later).
  const HILITE = (typeof location !== "undefined" ? new URLSearchParams(location.search).get("hi") : null) || "statements";
  function isHilited(it) {
    if (!HILITE) return false;
    if (HILITE === "statements") {
      const t = window.__topic || "overall";
      const d = (it.m.deriv || {})[t] || {};
      return (d.items || []).some((x) =>
        (x.k || "").indexOf("statement") >= 0 && (x.s || 0) >= 0.4);
    }
    return it.m.slug === HILITE;
  }

  function sxFactory(w) {
    const x0 = MARGIN.l, x1 = w - MARGIN.r;
    return (v) => x0 + ((v + 1) / 2) * (x1 - x0);
  }

  // ---------- particle simulation ----------
  function makeSim(chamber) {
    const cfg = charts[chamber];
    const sx = sxFactory(cfg.w);
    const items = [];
    let raf = null, curBand = null;

      function pillGeom(label) {
      const pad = cfg.pad;
      const hw = (label.length * (cfg.font * 0.55) + pad) / 2;
      const hh = cfg.font * 1.05;
      return { hw, hh };
    }

    function init() {
      const members = MEM.filter((m) => m.chamber === chamber);
      for (const m of members) {
        const label = m.chamber === "senate" ? m.state : (m.state + "-" + String(m.district).padStart(2, "0"));
        const g = pillGeom(label);
        items.push({ m, label, hw: g.hw, hh: g.hh, x: 0, y: 0, vx: 0, vy: 0, tx: 0, color: PARTY_COLOR[m.party] || "#9aa7c7" });
      }
      // initial placement: column stacking around center, compressed if tall
      setTargets();
      place(true);
    }

    function place(initial) {
      const cy = MARGIN.t + (cfg.h - MARGIN.t - MARGIN.b) / 2;
      const sorted = items.slice().sort((a, b) => a.tx - b.tx);
      let runStart = 0;
      const stepY = cfg.font * 2.25;
      for (let i = 1; i <= sorted.length; i++) {
        const same = i < sorted.length && Math.abs(sorted[i].tx - sorted[runStart].tx) < 2;
        if (!same) {
          const group = sorted.slice(runStart, i);
          const maxSpan = cfg.h - MARGIN.t - MARGIN.b - 20;
          const maxRows = Math.max(2, Math.floor(maxSpan / stepY));
          const cols = Math.max(2, Math.min(9, Math.ceil(group.length / maxRows)));
          const rows = Math.ceil(group.length / cols);
          const span = rows * stepY;
          const compress = span > maxSpan ? maxSpan / span : 1;
          const colW = Math.max(4, (group[0].hw * 2 + 2));
          group.forEach((it, gi) => {
            const col = gi % cols, row = Math.floor(gi / cols);
            it.x = it.tx + (col - (cols - 1) / 2) * colW;
            it.y = cy + ((row + (col % 2 ? 0.5 : 0)) - (rows - 1) / 2) * stepY * compress;
            if (initial) { it.vx = 0; it.vy = 0; }
          });
          runStart = i;
        }
      }
    }

    function setTargets() {
      const wleft = MARGIN.l, wright = cfg.w - MARGIN.r;
      for (const it of items) {
        const sc = scoreOf(it.m, window.__topic || "overall");
        it.tx = Math.min(Math.max(sx(sc.score), wleft + it.hw), wright - it.hw);
        it.slotX = it.tx;
        it.conf = sc.conf;
        it.inferred = sc.inferred;
      }
      // same-target groups: spread over columns around the target so piles
      // never sit on top of each other (each pill keeps its own slot x)
      const sorted = items.slice().sort((a, b) => a.tx - b.tx || (a.label < b.label ? -1 : 1));
      const maxRows = Math.max(2, Math.floor((cfg.h - MARGIN.t - MARGIN.b - 20) / (cfg.font * 2.25)));
      let runStart = 0;
      for (let i = 1; i <= sorted.length; i++) {
        const same = i < sorted.length && Math.abs(sorted[i].tx - sorted[runStart].tx) < 2;
        if (!same) {
          const group = sorted.slice(runStart, i);
          if (group.length > 1) {
            const cols = Math.max(2, Math.min(9, Math.ceil(group.length / maxRows)));
            const colW = group[0].hw * 2 + 2;
            group.forEach((it, gi) => {
              const col = gi % cols;
              const slot = it.tx + (col - (cols - 1) / 2) * colW;
              it.slotX = Math.min(Math.max(slot, wleft + it.hw), wright - it.hw);
            });
          }
          runStart = i;
        }
      }
    }

    let stepMotion = 0, maxOverlap = 0;
    function simStep(heat, t) {
      const SUB = SIM.substeps, h = 1 / SUB;
      for (let s = 0; s < SUB; s++) {
        maxOverlap = 0;
        const cell = 64;
        const grid = new Map();
        for (const it of items) {
          const key = Math.floor(it.x / cell) + "," + Math.floor(it.y / cell);
          let arr = grid.get(key);
          if (!arr) { arr = []; grid.set(key, arr); }
          arr.push(it);
        }
        for (const it of items) {
          const gx = Math.floor(it.x / cell), gy = Math.floor(it.y / cell);
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const arr = grid.get((gx + ox) + "," + (gy + oy));
              if (!arr) continue;
              for (const o of arr) {
                if (o === it) continue;
                const dx = it.x - o.x, dy = it.y - o.y;
                const nx = dx / (it.hw + o.hw), ny = dy / (it.hh + o.hh);
                const d2 = nx * nx + ny * ny;
                if (d2 < 1 && d2 > 1e-8) {
                  const d = Math.sqrt(d2);
                  if (1 - d > maxOverlap) maxOverlap = 1 - d;
                  const collide = SIM.collideFloor +
                    (1 - SIM.collideFloor) * (1 - Math.pow(heat, 0.714));
                  const f = (1 - d) * SIM.repel * collide * h * (t >= 1 ? 1.8 : 1);
                  const fx = (nx / d) * f * SIM.fxScale, fy = (ny / d) * f;
                  it.vx += fx; it.vy += fy;
                  o.vx -= fx; o.vy -= fy;
                }
              }
            }
          }
          const targetX = it.slotX != null ? it.slotX : it.tx;
          it.vx += (targetX - it.x) * SIM.attract * h;
          it.vy += (cfg.h / 2 - it.y) * SIM.center * h;
          const top = MARGIN.t + it.hh + 2, bot = cfg.h - MARGIN.b - it.hh - 2;
          const left = MARGIN.l + it.hw, right = cfg.w - MARGIN.r - it.hw;
          if (it.y < top) it.vy += (top - it.y) * SIM.wall * h;
          if (it.y > bot) it.vy -= (it.y - bot) * SIM.wall * h;
          if (it.x < left) it.vx += (left - it.x) * SIM.wall * h;
          if (it.x > right) it.vx -= (it.x - right) * SIM.wall * h;
          const dampNow = SIM.damp - 0.28 * Math.max(0, (t - 0.55) / 0.45);
          const dampH = 1 - (1 - dampNow) * h;
          it.vx *= dampH; it.vy *= dampH;
          const easeIn = Math.min(1, 0.5 + t * 6);
          const tail = t < 0.5 ? 1 : 1 + 0.9 * ((t - 0.5) / 0.5);
          const vmax = SIM.vmaxFast * easeIn * tail + SIM.vmaxSlow;
          if (it.vx > vmax) it.vx = vmax; if (it.vx < -vmax) it.vx = -vmax;
          if (it.vy > vmax) it.vy = vmax; if (it.vy < -vmax) it.vy = -vmax;
          it.x += it.vx * h; it.y += it.vy * h;
          stepMotion += (Math.abs(it.vx) + Math.abs(it.vy)) * h;
          if (it.y < top) { it.y = top; if (it.vy < 0) it.vy = 0; }
          if (it.y > bot) { it.y = bot; if (it.vy > 0) it.vy = 0; }
          if (it.x < left) { it.x = left; if (it.vx < 0) it.vx = 0; }
          if (it.x > right) { it.x = right; if (it.vx > 0) it.vx = 0; }
        }
      }
    }

    // ---------- rendering ----------
    let g = null, marksG = null, bandsG = null, axisG = null;
    const markEls = new Map();

    function ensureScene() {
      const svg = cfg.svg;
      svg.setAttribute("viewBox", "0 0 " + cfg.w + " " + cfg.h);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.height = "auto";
      svg.innerHTML = "";
      g = document.createElementNS(svgNS, "g");
      svg.appendChild(g);
      bandsG = document.createElementNS(svgNS, "g");
      axisG = document.createElementNS(svgNS, "g");
      marksG = document.createElementNS(svgNS, "g");
      g.appendChild(bandsG); g.appendChild(axisG); g.appendChild(marksG);

      const sx = sxFactory(cfg.w);
      const ay = cfg.h - MARGIN.b + 18;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("class", "axis-line");
      line.setAttribute("x1", sx(-1)); line.setAttribute("x2", sx(1));
      line.setAttribute("y1", ay); line.setAttribute("y2", ay);
      axisG.appendChild(line);
      for (let v = -1; v <= 1.001; v += 0.25) {
        const t = document.createElementNS(svgNS, "line");
        t.setAttribute("class", "axis-line");
        t.setAttribute("x1", sx(v)); t.setAttribute("x2", sx(v));
        t.setAttribute("y1", ay - 5); t.setAttribute("y2", ay + 5);
        axisG.appendChild(t);
        const lab = document.createElementNS(svgNS, "text");
        lab.setAttribute("class", "tick");
        lab.setAttribute("x", sx(v)); lab.setAttribute("y", ay + 18);
        lab.setAttribute("text-anchor", "middle");
        lab.textContent = v === 0 ? "0 neutral" : v === -1 ? "\u22121 Russia" : v === 1 ? "+1 Ukraine" : (v > 0 ? "+" : "\u2212") + Math.abs(v).toFixed(2);
        axisG.appendChild(lab);
      }
      // bands + median
      for (const cls of ["band99", "band90"]) {
        const r = document.createElementNS(svgNS, "rect");
        r.setAttribute("class", cls);
        r.setAttribute("y", MARGIN.t); r.setAttribute("height", cfg.h - MARGIN.b - MARGIN.t);
        bandsG.appendChild(r);
      }
      const med = document.createElementNS(svgNS, "line");
      med.setAttribute("class", "median-line");
      med.setAttribute("y1", MARGIN.t); med.setAttribute("y2", cfg.h - MARGIN.b);
      bandsG.appendChild(med);

      for (const it of items) {
        const grp = document.createElementNS(svgNS, "g");
        grp.setAttribute("class", "mk");
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("rx", it.hh); rect.setAttribute("ry", it.hh);
        rect.setAttribute("x", -it.hw); rect.setAttribute("y", -it.hh);
        rect.setAttribute("width", it.hw * 2); rect.setAttribute("height", it.hh * 2);
        it.rect = rect;
        rect.setAttribute("fill", it.color);
        const txt = document.createElementNS(svgNS, "text");
        txt.setAttribute("text-anchor", "middle");
        txt.setAttribute("y", cfg.font * 0.35);
        txt.setAttribute("font-size", cfg.font);
        txt.textContent = it.label;
        const title = document.createElementNS(svgNS, "title");
        grp.appendChild(rect); grp.appendChild(txt); grp.appendChild(title);
        grp.addEventListener("click", (ev) => { ev.stopPropagation(); openPopup(it.m, ev); });
        marksG.appendChild(grp);
        markEls.set(it.m.slug, { grp, rect, txt, title });
      }
    }

    function paintMarks() {
      for (const it of items) {
        if (!it.rect) continue;
        const on = isHilited(it);
        it.rect.setAttribute("fill", on ? "#FFD700" : it.color);
        if (on) {
          it.rect.setAttribute("stroke", "#FFA000");
          it.rect.setAttribute("stroke-width", "3");
        } else {
          it.rect.removeAttribute("stroke");
          it.rect.removeAttribute("stroke-width");
        }
      }
      for (const it of items) {
        const els = markEls.get(it.m.slug);
        if (!els) continue;
        els.grp.setAttribute("transform", "translate(" + it.x.toFixed(1) + "," + it.y.toFixed(1) + ")");
        els.grp.setAttribute("opacity", it.inferred ? 0.72 : 1);
        els.txt.setAttribute("opacity", it.m.unknown ? 0.45 : 1);
        els.title.textContent = it.m.name + " (" + it.m.party + "-" + it.label + ")  score " +
          fmt(scoreOf(it.m, window.__topic || "overall").score) +
          (it.m.unknown ? "  no data found; plotted at party mean" : "");
      }
    }

    function bandTargets(stats) {
      const sx = sxFactory(cfg.w);
      return {
        x99: sx(stats.lo99), w99: Math.max(1, sx(stats.hi99) - sx(stats.lo99)),
        x90: sx(stats.lo90), w90: Math.max(1, sx(stats.hi90) - sx(stats.lo90)),
        med: sx(stats.median),
      };
    }

    function paintBands() {
      if (!curBand) return;
      const [r99, r90, med] = bandsG.children;
      r99.setAttribute("x", curBand.x99); r99.setAttribute("width", curBand.w99);
      r90.setAttribute("x", curBand.x90); r90.setAttribute("width", curBand.w90);
      med.setAttribute("x1", curBand.med); med.setAttribute("x2", curBand.med);
    }

    function animate(stats, doLayout) {
      const target = bandTargets(stats);
      if (!curBand) curBand = target;
      if (raf) cancelAnimationFrame(raf);
      const TOTAL = SIM.steps;
      let step = 0, deover = 0;
      let idleFrames = 0;
      const DEOVER_CAP = 60, OVERLAP_GATE = 0.30;
      const tick = () => {
        let motion = 0;
        for (let i = 0; i < 9 && (step < TOTAL || (maxOverlap >= OVERLAP_GATE && deover < DEOVER_CAP)); i++) {
          const heat = Math.pow(Math.max(0, 1 - step / TOTAL), 1.4);
          stepMotion = 0;
          if (doLayout) simStep(heat, Math.min(1, step / TOTAL));
          if (step >= TOTAL) deover++;
          motion += stepMotion;
          step++;
        }
        const a = 0.21;
        curBand.x99 += (target.x99 - curBand.x99) * a;
        curBand.w99 += (target.w99 - curBand.w99) * a;
        curBand.x90 += (target.x90 - curBand.x90) * a;
        curBand.w90 += (target.w90 - curBand.w90) * a;
        curBand.med += (target.med - curBand.med) * a;
        paintMarks();
        paintBands();
        const bandDelta = Math.abs(target.x99 - curBand.x99) + Math.abs(target.w99 - curBand.w99)
          + Math.abs(target.x90 - curBand.x90) + Math.abs(target.w90 - curBand.w90)
          + Math.abs(target.med - curBand.med);
        const running = step < TOTAL || (maxOverlap >= OVERLAP_GATE && deover < DEOVER_CAP);
        const settled = doLayout
          ? (!running && motion / items.length < 0.45 && bandDelta < 0.05)
          : bandDelta < 0.05;
        idleFrames = settled ? idleFrames + 1 : 0;
        if (running || idleFrames < 3) raf = requestAnimationFrame(tick);
        else {
          raf = null;
          curBand = target;
          paintMarks(); paintBands();
        }
      };
      raf = requestAnimationFrame(tick);
    }

    init();
    ensureScene();
    return {
      update(stats, doLayout) {
        setTargets();
        animate(stats, doLayout);
      },
      rebuild() { ensureScene(); },
      dump() {
        return items.map((it) => ({
          name: it.m.name, label: it.label, x: it.x, y: it.y, tx: it.tx,
          hw: it.hw, hh: it.hh,
          score: scoreOf(it.m, window.__topic || "overall").score,
        }));
      },
    };
  }

  const sims = { senate: makeSim("senate"), house: makeSim("house") };
  window.__ukraineTest = { dump: (c) => sims[c].dump(), sim: SIM };

  // ---------- popup ----------
  const popup = document.getElementById("popup");
  const popupBody = document.getElementById("popupBody");
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function openPopup(m, ev) {
    const ov = scoreOf(m, "overall");
    const derivHtmlFor = (t, sc) => {
      const d = (m.deriv || {})[t] || {};
      const line = (nums, html) => '<div class="ditem"><div class="dnums">' + nums + '</div><div class="dtext">' + html + '</div></div>';
      let h = "";
      if (d.estimated) {
        h += line("", "No evidence on this issue. Estimated from the member\'s overall record, adjusted by how this issue tends to relate to overall among members of their party, and kept within the range the evidence covers.");
      } else if (d.items && d.items.length) {
        for (const it of d.items) {
          const stance = it.p > 0 ? "supports" : (it.p < 0 ? "opposes" : "is neutral on");
          const sign = it.p > 0 ? "+" : (it.p < 0 ? "\u2212" : "0");
          const boost = it.b ? " (x" + it.b + ")" : "";
          const nums = '<span class="ddate">' + esc(it.d || "") + '</span>' +
            "<span>" + sign + "</span><span>weight " + (it.s != null ? it.s.toFixed(2) : "?") + boost + "</span>";
          h += line(nums, esc(it.w) + '<div class="dkind">' + esc((it.k || "").replace(/^./, (c) => c.toUpperCase())) +
            " \u00b7 " + stance + "</div>");
        }
      } else {
        h += line("", "No evidence on this issue.");
      }
      h += '<div class="dtot">Score = weighted mean of these items = ' + fmt(sc.score) +
        ' <button class="dplot" data-topic="' + esc(t) + '">Show on chart \u25b6</button></div>';
      return h;
    };
    const rowHtml = (t, label, sc, bold) =>
      '<div class="subwrap"><div class="subrow" data-topic="' + esc(t) + '">' +
      '<button class="dex" title="Show how this score was derived">\u25b8</button>' +
      '<span class="lbl"' + (bold ? ' style="font-weight:600"' : "") + ">" + esc(label) +
      (sc.inferred ? '<span class="inferred-tag">estimated</span>' : "") + "</span>" +
      '<span class="val">' + fmt(sc.score) + ' <span style="color:#7d92bd">' + (sc.conf != null ? sc.conf.toFixed(2) : "0.00") + "</span></span></div>" +
      '<div class="deriv" hidden>' + derivHtmlFor(t, sc) + "</div></div>";
    const rows = [rowHtml("overall", "Overall", ov, true)]
      .concat(SUB.map((s) => rowHtml(s.id, s.label, scoreOf(m, s.id), false))).join("");
    const refs = (m.references || []).map((r) =>
      '<div class="ref"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + "</a>" +
      '<span class="claim">' + esc(r.claim) + "</span></div>").join("");
    const badges = [
      '<span class="badge">' + esc(m.party) + "</span>",
      '<span class="badge">' + esc(m.state) + (m.district ? "-" + esc(String(m.district).padStart(2, "0")) : " (Senate)") + "</span>",
      '<span class="badge">overall ' + fmt(ov.score) + " \u00b1 " + (ov.conf != null ? ov.conf.toFixed(2) : "?") + "</span>",
    ].join(" ");
    popupBody.innerHTML =
      "<h3>" + esc(m.name) + "</h3>" +
      '<div class="meta">' + badges + "</div>" +
      "<h4>Summary</h4>" +
      '<div class="summary">' + (m.summaryHtml || "<p>No summary on file.</p>") + "</div>" +
      "<h4>Issue ratings (confidence level in grey)</h4>" + rows;
    popup.style.display = "block";
    for (const el of popupBody.querySelectorAll(".subrow")) {
      el.addEventListener("click", () => {
        const panel = el.closest(".subwrap").querySelector(".deriv");
        const btn = el.querySelector(".dex");
        const open = !panel.hasAttribute("hidden");
        if (open) { panel.setAttribute("hidden", ""); if (btn) btn.textContent = "\u25b8"; }
        else { panel.removeAttribute("hidden"); if (btn) btn.textContent = "\u25be"; }
      });
    }
    for (const btn of popupBody.querySelectorAll(".dplot")) {
      btn.addEventListener("click", () => {
        topicSel.value = btn.getAttribute("data-topic");
        popup.style.display = "none";
        update();
      });
    }
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    const x = Math.max(12, Math.min((ev && ev.clientX || window.innerWidth / 2) + 18, window.innerWidth - pw - 12));
    const y = Math.max(12, Math.min((ev && ev.clientY || 120) + 10, window.innerHeight - ph - 12));
    popup.style.left = x + "px";
    popup.style.top = y + "px";
    popup.scrollTop = 0;
  }
  document.getElementById("popupClose").addEventListener("click", () => (popup.style.display = "none"));
  document.addEventListener("click", (ev) => {
    if (popup.style.display === "block" && !popup.contains(ev.target) && !ev.target.closest(".mk")) {
      popup.style.display = "none";
    }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") popup.style.display = "none"; });

  // ---------- controls + panels ----------
  const topicSel = document.getElementById("topic");
  const thrSel = document.getElementById("threshold");
  const fclInput = document.getElementById("fcl");
  topicSel.innerHTML = ['<option value="overall">Ukraine support (overall)</option>']
    .concat(SUB.map((s) => '<option value="' + s.id + '">' + esc(s.label) + "</option>")).join("");

  const state = { topic: "overall", threshold: "simple", fcl: 0.8 };

  function updatePanels() {
    for (const chamber of ["senate", "house"]) {
      const cfg = charts[chamber];
      const stats = pivotStats(chamber, state.topic, state.threshold, state.fcl);
      const nNeed = NEEDED[chamber][state.threshold];
      const nMem = MEM.filter((m) => m.chamber === chamber).length;
      cfg.sub.textContent = (state.threshold === "simple" ? "Simple majority" : state.threshold === "cloture" ? "Cloture / suspension" : "Veto-proof two-thirds") +
        " requires " + nNeed + " votes \u00b7 " + nMem + " members";
      cfg.scoreEl.textContent = fmt(stats.median);
      cfg.rangeEl.textContent = "(90% range " + fmt(stats.lo90) + " to " + fmt(stats.hi90) +
        "; 99% range " + fmt(stats.lo99) + " to " + fmt(stats.hi99) + ")";
      const isOverall = state.topic === "overall";
      const veto = state.threshold === "veto";
      const cloture = state.threshold === "cloture";
      cfg.exEl.innerHTML =
        '<div class="ex">' + esc(legislationText(stats.median, isOverall, veto)) + "</div>";
      sims[chamber].update(stats, state.layoutChanged);
    }
    state.layoutChanged = false;
  }

  function update() {
    const prevTopic = state.topic;
    state.topic = topicSel.value;
    state.threshold = thrSel.value;
    state.fcl = parseFloat(fclInput.value);
    if (state.topic !== prevTopic) state.layoutChanged = true;
    window.__topic = state.topic;
    fclInput.style.setProperty("--fill", (state.fcl * 100).toFixed(0) + "%");
    updatePanels();
  }
  topicSel.addEventListener("change", update);
  thrSel.addEventListener("change", update);
  fclInput.addEventListener("input", update);

  window.__topic = "overall";
  state.layoutChanged = true;
  update();
})();
