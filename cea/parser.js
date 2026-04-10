/**
 * Parser para produtos C&A (VTEX IO)
 */

async function parseProductCea(page, urlOrId) {
    try {
        let url = urlOrId;
        if (!url.startsWith('http')) {
            const searchUrl = `https://www.cea.com.br/busca?ft=${url}`;
            console.log(`[C&A] Buscando ID ${url} via pesquisa: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 5000));
            
            const productLink = await page.evaluate(() => {
                const link = document.querySelector('a[href*="/p"], section[class*="gallery"] a');
                return link ? link.href : null;
            });
            
            if (!productLink) {
                console.log(`❌ [C&A] Produto não encontrado na busca para ID: ${url}`);
                return null;
            }
            url = productLink;
            console.log(`[C&A] Produto encontrado, navegando para: ${url}`);
        }

        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        
        // Espera de hidratação
        await new Promise(r => setTimeout(r, 5000));

        const data = await page.evaluate(async () => {
            const getSafeText = (el) => {
                if (!el) return '';
                const txt = el.innerText || el.textContent || '';
                return (typeof txt === 'string') ? txt.trim() : '';
            };

            // PLANO A: window.__STATE__ (VTEX IO)
            const state = window.__STATE__;
            let stateProduct = null;
            if (state) {
                const productKey = Object.keys(state).find(k => k.startsWith('Product:'));
                if (productKey) stateProduct = state[productKey];
            }

            // Nome
            const h1 = document.querySelector('h1, [class*="productName"], .cea-cea-store-6-x-productName');
            let nome = getSafeText(h1);
            if (!nome && stateProduct) nome = stateProduct.productName;
            if (!nome) return null;

            // Preços
            const getPriceValue = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                let txt = getSafeText(el).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                return parseFloat(txt);
            };

            let precoOriginal = getPriceValue('.vtex-product-price-1-x-listPriceValue, [class*="listPrice"]');
            let precoAtual = getPriceValue('.vtex-product-price-1-x-sellingPriceValue, [class*="sellingPrice"]');

            // Fallback via State
            if (!precoAtual && stateProduct) {
                const skuKey = (stateProduct.items && stateProduct.items.length > 0) ? stateProduct.items[0].id : null;
                if (skuKey) {
                    const priceKey = Object.keys(state).find(k => k.includes(`Price({"item":${JSON.stringify(skuKey)}`) || k.includes(`{"item":${JSON.stringify(skuKey)}`));
                    if (priceKey && state[priceKey]) {
                        precoAtual = state[priceKey].sellingPrice;
                        precoOriginal = state[priceKey].listPrice || precoAtual;
                    }
                }
            }

            if (!precoOriginal) precoOriginal = precoAtual;
            if (precoOriginal < precoAtual) precoOriginal = precoAtual;

            // Tamanhos (Em estoque apenas)
            const tamanhos = [];
            const sizeElements = Array.from(document.querySelectorAll('.vtex-sku-selector-2-x-skuSelectorItem, [class*="skuSelectorItem"]'));
            
            sizeElements.forEach(el => {
                const isUnavailable = el.className.includes('--unavailable') || 
                                     el.className.includes('disabled') || 
                                     el.getAttribute('aria-disabled') === 'true';
                
                if (!isUnavailable) {
                    let sizeText = getSafeText(el);
                    if (sizeText && sizeText.length <= 4) {
                        tamanhos.push(sizeText.toUpperCase());
                    }
                }
            });

            // Fallback Tamanhos via State
            if (tamanhos.length === 0 && stateProduct && stateProduct.items) {
                stateProduct.items.forEach(item => {
                    const isAvailable = item.sellers && item.sellers.some(s => {
                        const comm = state[s.id];
                        return comm && comm.commertialOffer && comm.commertialOffer.AvailableQuantity > 0;
                    });

                    if (isAvailable && item.name) {
                        let sName = item.name.split('/').pop().trim();
                        if (sName.length <= 4) tamanhos.push(sName.toUpperCase());
                    }
                });
            }

            if (tamanhos.length === 0) return null;

            // Categoria
            let categoria = 'outros';
            const categories = stateProduct ? (stateProduct.categories || []) : [];
            const breadcrumb = categories.join(' ').toLowerCase();
            const fullText = (nome + ' ' + breadcrumb).toLowerCase();

            if (fullText.includes('vestido')) categoria = 'vestido';
            else if (fullText.includes('macacão') || fullText.includes('macaquinho')) categoria = 'macacão';
            else if (fullText.includes('saia')) categoria = 'saia';
            else if (fullText.includes('short')) categoria = 'short';
            else if (fullText.includes('blusa') || fullText.includes('top') || fullText.includes('camisa')) categoria = 'blusa';
            else if (fullText.includes('brinco') || fullText.includes('bolsa') || fullText.includes('acessório')) categoria = 'acessório';
            else if (fullText.includes('calça')) categoria = 'calça';
            else if (fullText.includes('casaco') || fullText.includes('jaqueta')) categoria = 'casaco';

            // ID
            let id = stateProduct ? stateProduct.productReference : null;
            if (!id && stateProduct) id = stateProduct.productId;
            if (!id) {
                const refEl = document.querySelector('.vtex-product-identifier');
                id = getSafeText(refEl).replace(/\D/g, '');
            }

            // Imagem
            let imageUrl = null;
            if (stateProduct && stateProduct.items && stateProduct.items.length > 0) {
                const item = stateProduct.items[0];
                if (item.images && item.images.length > 0) {
                    imageUrl = item.images[0].imageUrl;
                }
            }
            if (!imageUrl) {
                const imgEl = document.querySelector('.vtex-store-components-3-x-productImageTag, img[src*="arquivos"]');
                if (imgEl) imageUrl = imgEl.src;
            }

            return {
                id,
                nome,
                precoAtual,
                precoOriginal,
                tamanhos: [...new Set(tamanhos)],
                categoria,
                url: window.location.href,
                imageUrl
            };
        });

        return data;

    } catch (error) {
        console.error(`❌ Erro ao parsear C&A ${urlOrId}: ${error.message}`);
        return null;
    }
}

module.exports = { parseProductCea };
