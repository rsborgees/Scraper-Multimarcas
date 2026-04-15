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
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));

        const data = await page.evaluate(() => {
            const nextData = window.__NEXT_DATA__;
            if (!nextData) return { error: "NO_NEXT_DATA" };
            
            const props = nextData.props?.pageProps;
            if (!props) return { error: "NO_PAGE_PROPS", props: Object.keys(nextData.props || {}) };

            // Find any object that has a 'name' and 'skus'
            const findDeep = (obj, key, depth = 0) => {
                if (!obj || depth > 10) return null;
                if (obj[key]) return obj;
                if (typeof obj !== 'object') return null;
                for (let k in obj) {
                    if (k === 'root') continue;
                    const found = findDeep(obj[k], key, depth + 1);
                    if (found) return found;
                }
                return null;
            };

            const productLike = findDeep(props, 'skus');

            return {
                pagePropsKeys: Object.keys(props),
                productFound: !!props.product,
                productKeys: props.product ? Object.keys(props.product) : null,
                initialDataFound: !!props.initialData,
                initialDataKeys: props.initialData ? Object.keys(props.initialData) : null,
                productLikeFound: !!productLike,
                productLikeKeys: productLike ? Object.keys(productLike) : null,
                skusSample: (productLike && Array.isArray(productLike.skus)) ? productLike.skus.slice(0, 1) : "NOT_ARRAY"
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
