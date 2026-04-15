const puppeteer = require('puppeteer');

async function debugPage() {
    const url = "https://www.lojasrenner.com.br/p/colete-em-sarja-com-paineis-930625445"; 
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));

        const info = await page.evaluate(() => {
            return {
                title: document.title,
                h1: document.querySelector('h1')?.innerText,
                url: window.location.href,
                hasNextData: !!window.__NEXT_DATA__,
                nextDataProps: window.__NEXT_DATA__?.props?.pageProps ? Object.keys(window.__NEXT_DATA__.props.pageProps) : null
            };
        });

        console.log("Page Info:", JSON.stringify(info, null, 2));
        await page.screenshot({ path: 'd:/scraper 2.0/scratch/renner_debug.png' });

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await browser.close();
    }
}

debugPage();
