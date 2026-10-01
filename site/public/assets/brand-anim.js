/* Logo animation: replays.
   The animation itself lives in Base.astro ("Logo animation") and runs once
   on load with no JavaScript at all. This file only plays it again:
     - when the logo comes back on screen after leaving it entirely
       (scroll down, then back up);
     - 15 seconds after it last played, while it is on screen.
   The clock resets on every play, so a replay triggered by scrolling is not
   followed a second later by a timed one.
   Nothing plays while the tab is in the background, or when the visitor has
   asked for reduced motion (the OS setting, or "עצירת אנימציות" in the
   accessibility menu; the CSS removes every animation then anyway).

   Restarting a CSS animation: set animation: none on every part, force one
   layout read so the browser applies it, then clear it. The animation starts
   again from zero, delays included, so the order (surface, loops, glow) holds.

   Same logic as the UFO and geniza-explorer sites' brand-anim.js. */
(function () {
  var marks = document.querySelectorAll('.brand .mark');
  if (!marks.length || !('IntersectionObserver' in window)) return;

  var EVERY_MS = 15000;
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  /* svg -> { visible, left, last }
     left: has been off screen since its last play; last: when it last played */
  var state = new Map();

  function still() {
    return (reduce && reduce.matches) || document.documentElement.classList.contains('a11y-still');
  }

  function replay(svg) {
    state.get(svg).last = performance.now();
    if (still()) return;
    var parts = svg.querySelectorAll('*');
    parts.forEach(function (el) { el.style.animation = 'none'; });
    void svg.getBoundingClientRect().width;
    parts.forEach(function (el) { el.style.animation = ''; });
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var s = state.get(e.target);
      if (e.isIntersecting) {
        if (s.left) { replay(e.target); s.left = false; }
        s.visible = true;
      } else {
        s.visible = false;
        s.left = true;
      }
    });
  });

  marks.forEach(function (svg) {
    /* The first play already ran from the CSS on load; the 15 seconds count
       from there. */
    state.set(svg, { visible: false, left: false, last: performance.now() });
    io.observe(svg);
  });

  setInterval(function () {
    if (document.hidden) return;
    var now = performance.now();
    state.forEach(function (s, svg) {
      if (s.visible && now - s.last >= EVERY_MS) replay(svg);
    });
  }, 1000);

  /* Back to the tab after a while away: do not fire everything that is "due" */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var now = performance.now();
    state.forEach(function (s) { s.last = Math.max(s.last, now - EVERY_MS + 3000); });
  });
})();
