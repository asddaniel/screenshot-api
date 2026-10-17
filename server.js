const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
  // Accepter uniquement les requêtes POST
  // deploie ça tout de suite du con
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'URL manquante' });
  }

  let browser = null;

  try {
    // Lancer le Chromium compressé adapté à Vercel
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Charger l'URL (attend la fin des requêtes réseau)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    // Attendre le chargement des polices (KaTeX / LaTeX)
    await page.evaluateHandle('document.fonts.ready');

    // Attendre 1 seconde supplémentaire (pour le rendu des SVGs Mermaid)
    await new Promise((r) => setTimeout(r, 1000));

    // Générer le vrai PDF vectoriel
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' }
    });

    // Retourner le binaire du PDF
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(pdf);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
};