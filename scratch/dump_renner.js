const puppeteer = require('puppeteer');
const fs = require('fs');

async function dumpProductJson() {
    const url = 'https://www.lojasrenner.com.br/p/trench-coat-alongado-em-suede-com-cinto/-/A-930521531-br.lr';
    console.log(`Dumping ${url}...`);
    
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        const nextData = await page.evaluate(() => window.__NEXT_DATA__);
        fs.writeFileSync('renner_next_data.json', JSON.stringify(nextData, null, 2));
        console.log('Saved to renner_next_data.json');

        const selectors = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.size-selector__item'));
            return items.map(el => ({
                text: el.innerText,
                classes: el.className,
                isUnavailable: el.className.includes('--unavailable'),
                html: el.outerHTML
            }));
        });
        fs.writeFileSync('renner_selectors.json', JSON.stringify(selectors, null, 2));
        console.log('Saved selectors to renner_selectors.json');

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await browser.close();
    }
}

dumpProductJson();
