import puppeteer from 'puppeteer-core';

async function main() {
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
        });

        const page = await browser.newPage();

        await page.goto('https://google.com');

        console.log('Navigateur lancé avec succès !');
        console.log('Titre :', await page.title());
    } catch (error) {
        console.error('Erreur Puppeteer :', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

main();