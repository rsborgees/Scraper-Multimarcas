/**
 * ID Scanner para Riachuelo
 * Responsável por navegar na listagem e extrair URLs de produtos
 */

async function scanRiachueloListing(page, categoryUrl = 'https://www.riachuelo.com.br/feminino/novidades', maxItems = 50) {
    console.log(`\n🕵️ [Riachuelo] Iniciando scan de listagem: ${categoryUrl}`);
    
    const productUrls = new Set();
    
    try {
        await page.goto(categoryUrl, { waitUntil: 'load', timeout: 60000 });
        
        // Espera carregar os primeiros itens
        await new Promise(r => setTimeout(r, 4000));
        
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
            await new Promise(r => setTimeout(r, 2500));
            
            // Extrai URLs do DOM
            const urls = await page.evaluate(() => {
                // Riachuelo logos/links as vezes tem estruturas customizadas
                const links = Array.from(document.querySelectorAll('a[href*="/produto/"], a[href*="_sku"], .product-item a'));
                return links
                    .map(a => a.href)
                    .filter(href => href.includes('.riachuelo.com.br/') && !href.includes('/atendimento') && !href.includes('/lojas'));
            });
            
            urls.forEach(url => productUrls.add(url.split('?')[0]));
            
            if (productUrls.size === lastCount) {
                unchangedScrolls++;
                if (unchangedScrolls >= 3) break; 
            } else {
                unchangedScrolls = 0;
            }
            
            lastCount = productUrls.size;
            scrolls++;
        }

    } catch (error) {
        console.error(`❌ [Riachuelo Scanner] Erro: ${error.message}`);
    }

    const result = Array.from(productUrls).slice(0, maxItems);
    console.log(`✅ [Riachuelo Scanner] Finalizado: ${result.length} URLs encontradas.`);
    return result;
}

module.exports = { scanRiachueloListing };
