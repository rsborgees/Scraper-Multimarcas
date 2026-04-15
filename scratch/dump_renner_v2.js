const puppeteer = require('puppeteer');

async function dumpProductJSON() {
    const url = "https://www.lojasrenner.com.br/p/colete-em-sarja-com-paineis-930625445"; 
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 8000));

        const data = await page.evaluate(() => {
            const nextData = window.__NEXT_DATA__;
            if (!nextData) return { error: "NO_NEXT_DATA" };
            
            const props = nextData.props?.pageProps;
            if (!props) return { error: "NO_PAGE_PROPS" };
            
            const product = props.product || (props.initialData && props.initialData.product);
            if (!product) {
                // Try searching for product in props
                const findKey = (obj, keyToFind) => {
                    if (!obj || typeof obj !== 'object') return null;
                    if (obj[keyToFind]) return obj[keyToFind];
                    for (let k in obj) {
                        const found = findKey(obj[k], keyToFind);
                        if (found) return found;
                    }
                    return null;
                };
                const anyProduct = findKey(props, 'product');
                return { 
                    foundAtRoot: !!product, 
                    availableKeys: Object.keys(props),
                    anyProductKeys: anyProduct ? Object.keys(anyProduct) : "NOT_FOUND"
                };
            }
            
            return {
                found: true,
                keys: Object.keys(product),
                name: product.name,
                sku: product.sku,
                // Look for anything that might contain sizes
                potentialSizes: {
                    skus: !!product.skus,
                    variants: !!product.variants,
                    items: !!product.items,
                    specifications: !!product.specifications
                },
                skusType: typeof product.skus,
                skusSample: Array.isArray(product.skus) ? product.skus.slice(0, 1) : null
            };
        });

        console.log(JSON.stringify(data, null, 2));

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await browser.close();
    }
}

dumpProductJSON();
