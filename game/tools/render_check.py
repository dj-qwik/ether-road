# Render smoke test: a real race in headless Chromium (WebGL via SwiftShader). Passes only if, a few seconds in, your
# own pipe and ball are actually on screen: the pixels where your ball projects are your ball (not background), and
# your pipe's glass fills the screen around it. Catches anything that stops the "your pipe on top" pass drawing.
#   python3 tools/render_check.py [out-dir]
import sys, os, threading, http.server, functools
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__)); dist = os.path.join(here, '..', 'dist')
out = sys.argv[1] if len(sys.argv) > 1 else None
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=dist)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 640, 'height': 360}, device_scale_factor=1)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{port}/etherroad.html#autopilot,nobloom'); pg.wait_for_function("() => typeof WORLD !== 'undefined' && WORLD.ready && document.querySelector('#goPractice')", timeout=60000)
    pg.click('#goPractice'); pg.click('#practiceGo'); pg.evaluate('() => beginCountdown(100)')
    pg.wait_for_function('() => game.R && game.R.t >= 2.5', timeout=180000)
    # what each pass would draw, and where your ball lands on screen
    info = pg.evaluate("""() => { const W = WORLD.race, cam = WORLD.camera, sp = W.spheres.find((s) => s.rl === W.top);
      const v = sp.g.getWorldPosition(new THREE.Vector3()).project(cam);
      return { layers: cam.layers.mask, topLayer: W.top.layer, x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, z: v.z } }""")
    # freeze the world and compare: the same frame with and without your pipe + ball
    def frame(hide):
        return pg.evaluate("""(hide) => new Promise((res) => { const W = WORLD.race; game.speed = 0; W.top.grp.visible = !hide;
          requestAnimationFrame(() => requestAnimationFrame(() => { const c = document.querySelector('#gl'), g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
          const x = g.getContext('2d'); x.drawImage(c, 0, 0); res(Array.from(x.getImageData(0, 0, g.width, g.height).data)); })) })""", hide)
    with_ = frame(False); without = frame(True)
    pg.evaluate('() => { WORLD.race.top.grp.visible = true; game.speed = 1 }')
    W, H = 640, 360
    def diff_in(x0, y0, x1, y1):
        n = d = 0
        for y in range(max(0, int(y0)), min(H, int(y1)), 2):
            for x in range(max(0, int(x0)), min(W, int(x1)), 2):
                i = (y * W + x) * 4; n += 1
                if sum(abs(with_[i + k] - without[i + k]) for k in range(3)) > 30: d += 1
        return d / max(1, n)
    ball = diff_in(info['x'] - 12, info['y'] - 12, info['x'] + 12, info['y'] + 12)
    screen = diff_in(0, 0, W, H)
    print(f"camera layers {info['layers']} · your pipe on layer {info['topLayer']} · ball at ({info['x']:.0f}, {info['y']:.0f}) · ball pixels drawn {ball:.0%} · screen changed by your pipe {screen:.0%}")
    if info['layers'] != 1 << info['topLayer']: fails.append('the main camera does not draw your pipe\'s layer')
    if ball < 0.3: fails.append(f'your ball is not on screen ({ball:.0%} of its pixels drawn)')
    if screen < 0.25: fails.append(f'your pipe is not on screen (only {screen:.0%} of the screen)')
    if not (0 < info['x'] < W and H * 0.45 < info['y'] < H and info['z'] < 1): fails.append('your ball is not in the lower part of the view')
    if errs: fails.append('page errors: ' + '; '.join(errs[:3]))
    if out: os.makedirs(out, exist_ok=True); pg.screenshot(path=os.path.join(out, 'render_check.png'))
    b.close()
srv.shutdown()
print('PASS render: your pipe and ball are drawn' if not fails else 'FAIL render: ' + ' · '.join(fails))
sys.exit(1 if fails else 0)
