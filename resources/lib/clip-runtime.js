// AgentShot's clip runtime. Loaded by every motion clip after GSAP. It takes time away from the wall clock so that any
// frame can be shown or rendered exactly: GSAP's global timeline is frozen at 0 before the clip's script runs, then
// AgentShot moves it to whatever time it needs (preview scrubbing, frame-by-frame rendering).
//   Authors: write normal GSAP (gsap.timeline(), gsap.to…). Don't pause it and don't use setTimeout/rAF for motion.
//   CSS animations and the Web Animations API are driven too. For custom drawing use manul.onFrame(t => …).
//   Give every element the user may move or ask about a data-manul-id.
(function () {
  var root = document.documentElement
  var num = function (k, d) { var v = parseFloat(root.getAttribute('data-' + k)); return isFinite(v) ? v : d }
  var frameFns = []
  var manul = {
    duration: num('duration', 5), width: num('width', 1920), height: num('height', 1080), fps: num('fps', 30),
    time: 0,
    onFrame: function (fn) { frameFns.push(fn) },
  }
  window.manul = manul

  if (window.gsap) {
    gsap.ticker.lagSmoothing(0)
    gsap.globalTimeline.pause()
    gsap.globalTimeline.time(0)
  }

  function ready() {
    var imgs = Array.prototype.map.call(document.images, function (im) {
      return im.complete ? null : new Promise(function (r) { im.onload = im.onerror = r })
    }).filter(Boolean)
    return Promise.all([document.fonts ? document.fonts.ready : null].concat(imgs))
  }
  var loaded = new Promise(function (r) { if (document.readyState === 'complete') r(); else addEventListener('load', function () { r() }) })

  /** Show the frame at t seconds. Resolves once it has been painted. */
  window.__manulSeek = function (t) {
    manul.time = t
    if (window.gsap) gsap.globalTimeline.time(t, false)
    if (document.getAnimations) document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = t * 1000 })
    Array.prototype.forEach.call(document.querySelectorAll('video[data-manul-sync]'), function (v) { v.pause(); v.currentTime = t })
    frameFns.forEach(function (fn) { try { fn(t) } catch (e) { console.error(e) } })
    return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(t) }) }) })
  }
  window.__manulReady = loaded.then(ready).then(function () { return window.__manulSeek(0) }).then(function () {
    return { duration: manul.duration, width: manul.width, height: manul.height, fps: manul.fps }
  })

  // Where every movable element is drawn right now (for the editor's drag handles and element notes).
  window.__manulElements = function () {
    return Array.prototype.map.call(document.querySelectorAll('[data-manul-id]'), function (el) {
      var r = el.getBoundingClientRect()
      return { id: el.getAttribute('data-manul-id'), x: r.left, y: r.top, w: r.width, h: r.height, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 80) }
    })
  }

  // Inside AgentShot's editor (an iframe): show frames on request, report where elements are, move them live while dragged.
  if (window.parent !== window) {
    var reply = function (t) { parent.postMessage({ manul: 'elements', t: t, list: window.__manulElements() }, '*') }
    addEventListener('message', function (e) {
      var m = e.data || {}
      if (m.manul === 'seek') window.__manulReady.then(function () { return window.__manulSeek(m.t) }).then(reply)
      if (m.manul === 'move') {
        var el = document.querySelector('[data-manul-id="' + m.id + '"]')
        if (!el) return
        var cur = (el.style.translate || '0px 0px').split(' ').map(parseFloat)
        el.style.translate = Math.round((cur[0] || 0) + m.dx) + 'px ' + Math.round((cur[1] || 0) + m.dy) + 'px'
        reply(manul.time)
      }
    })
    window.__manulReady.then(function () { reply(0) })
  }
})()
