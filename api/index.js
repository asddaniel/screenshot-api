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
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // 1. Émulation du média d'impression pour activer les règles @media print
    await page.emulateMediaType('print');

    // 2. Navigation avec timeout suffisant pour le calcul des formules
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // 3. Attente que toutes les polices web soient chargées
    await page.evaluateHandle('document.fonts.ready');

    // 4. Attente du signal de compilation de KaTeX & Mermaid injecté par la vue Laravel
    await page.waitForFunction(() => window.__PDF_READY__ === true, {
      timeout: 25000,
    });

    // 5. Génération du flux binaire PDF
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '12mm',
        right: '12mm',
        bottom: '12mm',
        left: '12mm',
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