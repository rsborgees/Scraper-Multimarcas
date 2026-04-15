const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox']});
    const page = await browser.newPage();
    
    // Intercepta todas as respostas de API
    const apiResponses = {};
    page.on('response', async (response) => {
        const url = response.url();
        if ((url.includes('/api/') || url.includes('product') || url.includes('sku') || url.includes('sizes')) 
            && response.status() === 200) {
            try {
                const text = await response.text();
                if (text.length < 50000 && text.includes('{')) {
                    apiResponses[url] = JSON.parse(text);
                }
            } catch(e) {}
        }
    });

    await page.goto('https://www.lojasrenner.com.br/p/colete-acinturado-em-algodao-com-linho-e-amarracao/-/A-930436214-br.lr?sku=930932592', {waitUntil: 'networkidle2'});
    await new Promise(r => setTimeout(r, 4000));

    // Mostra as URLs de API interceptadas
    console.log("=== URLs DE API INTERCEPTADAS ===");
    Object.keys(apiResponses).forEach(url => console.log(url));

    // Tenta encontrar os tamanhos via DOM
    const domInfo = await page.evaluate(() => {
        const sizeBtns = document.querySelectorAll('button, label, li, span');
        const sizeElements = [];
        sizeBtns.forEach(el => {
            const txt = (el.innerText || el.textContent || '').trim();
            if (/^(PP|P|M|G|GG|G1|G2|G3|G4|\d{2})$/.test(txt)) {
                sizeElements.push({
                    tag: el.tagName,
                    text: txt,
                    className: el.className.toString().substring(0, 100),
                    disabled: el.hasAttribute('disabled'),
                    ariaDisabled: el.getAttribute('aria-disabled'),
                    style: el.getAttribute('style') || ''
                });
            }
        });
        return sizeElements;
    });

    console.log("\n=== ELEMENTOS DE TAMANHO NO DOM ===");
    console.log(JSON.stringify(domInfo, null, 2));

    await browser.close();
})();
