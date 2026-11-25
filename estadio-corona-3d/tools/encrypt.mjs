// Cifra la app compilada (dist/) con una contraseña y genera dist-privado/,
// listo para publicar en cualquier hosting estático (por ejemplo GitHub Pages).
//
// Uso:  TSM_PASSWORD='mi contraseña' node tools/encrypt.mjs
//
// El HTML, el CSS y el JavaScript de la app van dentro de un solo archivo cifrado
// (AES-256-GCM, clave derivada con PBKDF2-SHA256, 310 000 iteraciones). La página
// pública sólo contiene el formulario de contraseña; sin la contraseña correcta el
// contenido no se puede leer. La contraseña nunca se guarda en el repositorio.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'dist-privado');
const password = process.env.TSM_PASSWORD;
if (!password || password.length < 8) {
  console.error('Falta TSM_PASSWORD (mínimo 8 caracteres).');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1];
const fonts = [...head.matchAll(/<link[^>]+fonts\.googleapis[^>]*>/g)].map((m) => m[0]).join('\n    ');

const payload = JSON.stringify({
  body,
  css: readFileSync(join(dist, 'assets', cssFile), 'utf8'),
  js: readFileSync(join(dist, 'assets', jsFile), 'utf8'),
});

const ITER = 310000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload)));
const blob = new Uint8Array(16 + 12 + cipher.length);
blob.set(salt, 0); blob.set(iv, 16); blob.set(cipher, 28);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'app.bin'), blob);
writeFileSync(join(out, '.nojekyll'), '');

const loader = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <title>Estadio TSM 3D</title>
    ${fonts}
    <style>
      :root { --ink: #142019; --muted: #5c6b62; --green: #1f9d48; --line: rgba(20,32,25,.14); }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--ink); }
      body { background: radial-gradient(120% 90% at 50% 0%, #2a8a47 0%, #0f4a26 55%, #08301a 100%); display: grid; place-items: center; padding: 16px; }
      [hidden] { display: none !important; }
      .gate { width: min(380px, 100%); background: #fbfbf7; border-radius: 16px; border-left: 6px solid var(--green); padding: 24px 22px; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
      .gate small { font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--muted); }
      .gate h1 { font-family: 'Archivo Black', Inter, system-ui, sans-serif; color: var(--green); font-size: 26px; margin: 6px 0 4px; }
      .gate p { margin: 0 0 16px; color: var(--muted); font-size: 14px; }
      .gate label { font-size: 13px; font-weight: 600; }
      .gate input { width: 100%; margin: 6px 0 12px; padding: 11px 12px; font: inherit; border: 1px solid var(--line); border-radius: 10px; }
      .gate input:focus-visible, .gate button:focus-visible { outline: 2px solid #f2b632; outline-offset: 2px; }
      .gate button { width: 100%; padding: 11px; border: none; border-radius: 999px; background: var(--green); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
      .gate button:disabled { opacity: .6; cursor: wait; }
      .err { color: #b3261e; font-size: 13px; margin: -4px 0 10px; }
    </style>
  </head>
  <body>
    <form class="gate" id="gate" autocomplete="on">
      <small>Estadio TSM Corona · Torreón</small>
      <h1>Elige tu lugar</h1>
      <p>Esta página es privada. Escribe la contraseña para entrar.</p>
      <label for="pw">Contraseña</label>
      <input id="pw" type="password" autocomplete="current-password" required autofocus />
      <div class="err" id="err" role="alert" hidden>Contraseña incorrecta. Revisa mayúsculas y guiones.</div>
      <button id="go" type="submit">Entrar</button>
    </form>
    <script>
      const ITER = ${ITER};
      async function unlock(password) {
        const buf = new Uint8Array(await (await fetch('app.bin', { cache: 'no-store' })).arrayBuffer());
        const salt = buf.slice(0, 16), iv = buf.slice(16, 28), data = buf.slice(28);
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
        return JSON.parse(new TextDecoder().decode(plain));
      }
      function launch(app) {
        const style = document.createElement('style');
        style.textContent = app.css;
        document.head.appendChild(style);
        document.body.removeAttribute('style');
        document.body.style.cssText = 'display:block;padding:0;background:#cbbf9f';
        document.body.innerHTML = app.body;
        const url = URL.createObjectURL(new Blob([app.js], { type: 'text/javascript' }));
        import(url);
      }
      async function attempt(password, remember) {
        const app = await unlock(password);
        if (remember) { try { sessionStorage.setItem('tsm-pw', password); } catch {} }
        launch(app);
      }
      const form = document.getElementById('gate');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('go');
        btn.disabled = true; btn.textContent = 'Abriendo…';
        document.getElementById('err').hidden = true;
        try { await attempt(document.getElementById('pw').value, true); }
        catch { document.getElementById('err').hidden = false; btn.disabled = false; btn.textContent = 'Entrar'; }
      });
      // Si ya entraste en esta pestaña, no vuelve a pedir la contraseña al recargar.
      try { const saved = sessionStorage.getItem('tsm-pw'); if (saved) attempt(saved, false).catch(() => sessionStorage.removeItem('tsm-pw')); } catch {}
    </script>
  </body>
</html>
`;
writeFileSync(join(out, 'index.html'), loader);
console.log(`Listo: dist-privado/ (${(blob.length / 1024 / 1024).toFixed(2)} MB cifrados)`);
