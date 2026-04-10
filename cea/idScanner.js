/**
 * ID Scanner para C&A
 * Responsável por navegar na listagem e extrair URLs de produtos
 */

async function scanCeaListing(page, categoryUrl = 'https://www.cea.com.br/novidades', maxItems = 50) {
    console.log(`\n🕵️ [C&A] Iniciando scan de listagem: ${categoryUrl}`);
    
    const productUrls = new Set();
    
    try {
        await page.goto(categoryUrl, { waitUntil: 'load', timeout: 60000 });
        
        // Espera carregar os primeiros itens
        await page.waitForTimeout(3000);
        
        let scrolls = 0;
        const maxScrolls = 20;
        let lastCount = 0;
        let unchangedScrolls = 0;

        while (scrolls < maxScrolls && productUrls.size < maxItems) {
            console.log(`   📜 Scroll ${scrolls + 1}/${maxScrolls} | Encontrados: ${productUrls.size}`);
            
            // Rola a página
            await page.evaluate(() => {
                window.scrollBy(0, 1000);
            });
            await page.waitForTimeout(2000);
            
            // Extrai URLs do DOM
            const urls = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href*="/p"]'));
                return links
                    .map(a => a.href)
                    .filter(href => href.includes('.cea.com.br/') && !href.includes('/login') && !href.includes('context'));
            });
            
            urls.forEach(url => productUrls.add(url.split('?')[0]));
            
            if (productUrls.size === lastCount) {
                unchangedScrolls++;
                if (unchangedScrolls >= 3) break; // Fim da página ou scroll travado
            } else {
                unchangedScrolls = 0;
            }
            
            lastCount = productUrls.size;
            scrolls++;
        }

    } catch (error) {
        console.error(`❌ [C&A Scanner] Erro: ${error.message}`);
    }

    const result = Array.from(productUrls).slice(0, maxItems);
    console.log(`✅ [C&A Scanner] Finalizado: ${result.length} URLs encontradas.`);
    return result;
}

module.exports = { scanCeaListing };
