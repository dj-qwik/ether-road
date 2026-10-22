# Screenshots of the built game in headless Chromium (WebGL via SwiftShader).
#   python3 tools/shot.py <out-dir> [script]   script: "home" | "practice"
# Serves game/dist over http (ES modules + import map need http, not file://).
import sys, os, threading, http.server, functools, time
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__)); dist = os.path.join(here, '..', 'dist')
out = sys.argv[1]; script = sys.argv[2] if len(sys.argv) > 2 else 'practice'
os.makedirs(out, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=dist)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    w, h = (int(x) for x in os.environ.get('SIZE', '1280x720').split('x'))
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.goto(f'http://127.0.0.1:{port}/etherroad.html' + os.environ.get('HASH', '#autopilot')); pg.wait_for_timeout(2500)
    pg.screenshot(path=f'{out}/home.png')
    if script == 'practice':
        pg.click('#goPractice'); pg.wait_for_timeout(300); pg.screenshot(path=f'{out}/practice.png')
        pg.click('#practiceGo'); pg.wait_for_timeout(700); pg.screenshot(path=f'{out}/intro.png')
        pg.click('#ready'); pg.wait_for_timeout(1500); pg.screenshot(path=f'{out}/countdown.png')
        for k, ms in enumerate([2500, 5000, 8000, 12000]):
            pg.wait_for_timeout(ms - (0 if k == 0 else [2500, 5000, 8000, 12000][k-1]))
            pg.screenshot(path=f'{out}/race{k}.png')
    if script == 'skins':
        pg.click('#goSkins'); pg.wait_for_timeout(1500); pg.screenshot(path=f'{out}/skins.png')
    if script == 'tracks':
        pg.evaluate("() => { localStorage.setItem('er_lab', '1') }")
        for i, key in enumerate(['nebula', 'helix', 'canyon', 'cathedral', 'storm', 'ghost']):
            pg.evaluate("(k) => { LAB.configure(({ track: k, theme: 'track', seed: '', start: 18, speed: 1, n: 4, bots: 'hard', kind: 'all', god: true, auto: true })); LAB.open(); }", key)
            pg.wait_for_timeout(300)
            if i == 0: pg.screenshot(path=f'{out}/lab.png')
            pg.evaluate("() => { const S = JSON.parse(localStorage.getItem('er_lab_cfg')); document.querySelector('#labGo').click(); }")
            pg.wait_for_timeout(2600); pg.screenshot(path=f'{out}/track_{key}.png')
    print('\n'.join(logs[-30:]))
    b.close()
srv.shutdown()
