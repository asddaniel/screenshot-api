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
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
      defaultViewport: { width: 1200, height: 800 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // 🔍 Capture des logs et erreurs de rendu dans la console Node
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    // 1. Navigation en mode écran standard pour laisser React & Mermaid s'hydrater
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // 2. Attente que les polices soient prêtes
    await page.evaluateHandle('document.fonts.ready');

    // 3. Attente du flag injecté par le composant React
    await page.waitForFunction(() => window.__PDF_READY__ === true, {
      timeout: 25000,
    });

    // 4. Génération du PDF (page.pdf bascule automatiquement sur le média print)
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true, // Priorité aux directives @page du CSS
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    return res.end(pdf);

  } catch (error) {
    console.error('Erreur Puppeteer:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Microservice de capture PDF actif sur http://localhost:${PORT}`);
  });
}

export default app;