// three.js arrives from an ES module (see build.mjs); start once it has.
if (window.THREE) boot(); else addEventListener('three-ready', boot, { once: true });
