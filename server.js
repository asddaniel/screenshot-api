const express = require('express');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware indispensable pour parser le JSON envoyé en POST
app.use(express.json());

// 1. Route GET : Mode web / vérification
app.get('/', (req, res) => {
  return res.send('Hello World');
});

// 2. Route POST : Logique de capture PDF (strictement intacte)
app.post('/', async (req, res) => {
  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'URL manquante' });
  }

  let browser = null;

  try {
    // Désactiver le mode graphique superflu pour accélérer le démarrage et éviter les crashs Linux
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-gpu', '--no-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // On attend que le DOM soit chargé (plus rapide que networkidle0 pour éviter le timeout de 10s)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });

    // Attendre que les polices soient prêtes
    await page.evaluateHandle('document.fonts.ready');

    // Génération du PDF
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    // Utiliser .end(buffer) pour éviter que Vercel/Express n'essaie de parser le binaire
    return res.end(pdf);

  } catch (error) {
    console.error('Erreur Puppeteer:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Lancement du serveur
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});

module.exports = app;