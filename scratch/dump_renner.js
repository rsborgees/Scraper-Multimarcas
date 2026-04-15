const puppeteer = require('puppeteer');

async function dumpProductJSON() {
    const url = "https://www.lojasrenner.com.br/p/colete-em-sarja-com-paineis-930625445"; // Fresh URL
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        const product = await page.evaluate(() => {
            const nextData = window.__NEXT_DATA__;
            if (nextData && nextData.props && nextData.props.pageProps) {
                const props = nextData.props.pageProps;
                return props.product || (props.initialData && props.initialData.product) || null;
            }
            return null;
        });

        if (product) {
            console.log("Product found!");
            console.log("SKUs sample:", JSON.stringify(product.skus?.slice(0, 2), null, 2));
            console.log("Variants sample:", JSON.stringify(product.variants?.slice(0, 2), null, 2));
            // Check current variation
            if (product.skus) {
                const availableSkus = product.skus.filter(s => s.available);
                console.log(`Available SKUs count: ${availableSkus.length}`);
                availableSkus.forEach(s => {
                   console.log(`SKU ID: ${s.skuId}, Size: ${JSON.stringify(s.size)}, Available: ${s.available}`);
                });
            }
        } else {
            console.log("Product object NOT found in NEXT_DATA");
        }

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await browser.close();
    }
}

dumpProductJSON();
