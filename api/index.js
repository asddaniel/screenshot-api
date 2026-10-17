
import express from 'express';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 1. Route GET : Test Web
app.get('/', (req, res) => {
  return res.send('Hello World');
});

// 2. Route POST : Capture PDF
app.post('/', async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'URL manquante' });
  }

  let browser = null;

  try {
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-gpu', '--no-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 8000,
    });

    await page.evaluateHandle('document.fonts.ready');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
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

    return res.status(500).json({
      error: error.message,
    });

  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Ne lancer app.listen qu'en développement local
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Serveur local lancé sur http://localhost:${PORT}`);
  });
}

// Export ESM pour Vercel
export default app;
