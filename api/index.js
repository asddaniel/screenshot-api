import express from 'express';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  return res.send('Puppeteer PDF Generator Operational');
});

app.post('/', async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'URL manquante' });
  }

  let browser = null;

  try {
    chromium.setGraphicsMode = true;

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--ignore-certificate-errors', // Ignore les faux certificats SSL locaux
        '--allow-running-insecure-content',
        '--disable-web-security', // Évite les blocages CORS entre Vite et l'app
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // 1. ESPIONNAGE DES ERREURS : Affichera les erreurs de compilation/scripts dans votre terminal Node
    page.on('console', msg => console.log('💬 [BROWSER CONSOLE]:', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('💥 [JS EXCEPTION]:', err.message));
    page.on('requestfailed', request => {
      console.error(`🚨 [RESSOURCE ÉCHOUÉE]: ${request.url()} - ${request.failure()?.errorText}`);
    });

    // 2. Navigation vers l'application
    const response = await page.goto(url, {
      waitUntil: 'networkidle2', // plus stable que networkidle0 avec Inertia et Vite
      timeout: 30000,
    });

    console.log(`📡 HTTP Status: ${response.status()}`);

    // 3. VÉRIFICATION DU MONTAGE DE REACT DANS LE DOM
    const htmlDebug = await page.evaluate(() => {
      const appEl = document.getElementById('app');
      return {
        appExists: !!appEl,
        appHasContent: appEl ? appEl.innerHTML.trim().length > 0 : false,
        bodyHtmlSnippet: document.body.innerHTML.substring(0, 300),
      };
    });

    console.log('🧐 État du DOM Inertia :', htmlDebug);

    if (!htmlDebug.appHasContent) {
      console.warn('⚠️ ALERTE : Le conteneur #app est totalement VIDE. React ne s\'est pas exécuté !');
    }

    // 4. Attente explicite du conteneur rendu par Inertia
    await page.waitForSelector('#app > *', { timeout: 10000 }).catch(() => {
      console.warn('⚠️ Le composant React n\'a pas pu monter dans #app.');
    });

    // 5. Attente du drapeau spécifique si présent
    await page.waitForFunction(() => window.__PDF_READY__ === true, {
      timeout: 10000,
    }).catch(() => console.log('ℹ️ window.__PDF_READY__ non détecté ou expiré, capture directe...'));

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    return res.end(pdf);

  } catch (error) {
    console.error('Erreur Serveur:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Microservice de capture PDF actif sur http://localhost:${PORT}`);
  });
}

export default app;