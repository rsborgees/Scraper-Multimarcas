const puppeteer = require('puppeteer');
require('dotenv').config();

async function deepDump() {
    const url = "https://www.lojasrenner.com.br/p/-/A-930625445-br.lr";
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        const result = await page.evaluate(() => {
            const nd = window.__NEXT_DATA__;
            if (!nd) return "NO_NEXT_DATA";
            
            const props = nd.props.pageProps;
            // Procurar recursivamente por algo que pareça um produto (tenha 'id' e 'skus' ou 'variants')
            const findProduct = (obj, depth = 0) => {
                if (!obj || depth > 5) return null;
                if (typeof obj !== 'object') return null;
                
                if (obj.id && (obj.skus || obj.variants || obj.name)) {
                    return { found_at_depth: depth, keys: Object.keys(obj), sample_name: obj.name };
                }
                
                for (let key in obj) {
                    const found = findProduct(obj[key], depth + 1);
                    if (found) return { path: key + " -> " + (found.path || ""), ...found };
                }
                return null;
            };

            return {
                pagePropsKeys: Object.keys(props),
                searchResult: findProduct(props)
            };
        });

        console.log(JSON.stringify(result, null, 2));

    } catch (e) {
        console.error("💥 Erro:", e.message);
    } finally {
        await browser.close();
    }
}

deepDump();
