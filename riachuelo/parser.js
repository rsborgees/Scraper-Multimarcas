/**
 * Parser para produtos Riachuelo
 */

async function parseProductRiachuelo(page, urlOrId) {
    try {
        let url = urlOrId;
        if (!url.startsWith('http')) {
            const searchUrl = `https://www.riachuelo.com.br/pesquisa?q=${url}`;
            console.log(`[Riachuelo] Buscando ID ${url} via pesquisa: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 5000));
            
            const productLink = await page.evaluate(() => {
                const link = document.querySelector('a[href*="/p"], a[href*="/produto"], div[class*="product"] a');
                return link ? link.href : null;
            });
            
            if (!productLink) {
                console.log(`❌ [Riachuelo] Produto não encontrado na busca para ID: ${url}`);
                return null;
            }
            url = productLink;
            console.log(`[Riachuelo] Produto encontrado, navegando para: ${url}`);
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

            // PLANO A: window.__PRELOADED_STATE__ ou window.__STATE__
            const state = window.__PRELOADED_STATE__ || window.__STATE__ || window.__INITIAL_STATE__;
            let product = null;
            if (state && state.product) {
                product = state.product;
            } else if (state && state.apolloState) {
                // Algumas versões VTEX do Riachuelo usam Apollo
                const productKey = Object.keys(state.apolloState).find(k => k.startsWith('Product:'));
                if (productKey) product = state.apolloState[productKey];
            }

            // Nome
            const h1 = document.querySelector('h1, [class*="product-name"], .product-name');
            let nome = getSafeText(h1);
            if (!nome && product) nome = product.name || product.productName;
            if (!nome) return null;

            // Preços
            const getPriceValue = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                let txt = getSafeText(el).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                return parseFloat(txt);
            };

            let precoOriginal = getPriceValue('.list-price, .old-price, [class*="list-price"]');
            let precoAtual = getPriceValue('.sale-price, .selling-price, [class*="sale-price"]');

            // Fallback via State
            if ((!precoAtual || isNaN(precoAtual)) && product) {
                if (product.items && product.items.length > 0) {
                    const sku = product.items[0];
                    if (sku.sellers && sku.sellers.length > 0) {
                        const offer = sku.sellers[0].commertialOffer;
                        precoAtual = offer.Price;
                        precoOriginal = offer.ListPrice || precoAtual;
                    }
                }
            }

            if (!precoOriginal) precoOriginal = precoAtual;
            if (precoOriginal < precoAtual) precoOriginal = precoAtual;

            // Tamanhos
            const tamanhos = [];
            const sizeElements = Array.from(document.querySelectorAll('.sku-selector__item:not(.sku-selector__item--unavailable), [class*="size-selector"] li:not(.disabled)'));
            
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

            // Fallback via State
            if (tamanhos.length === 0 && product && product.items) {
                product.items.forEach(item => {
                    const isAvailable = item.sellers && item.sellers.some(s => s.commertialOffer && s.commertialOffer.AvailableQuantity > 0);
                    if (isAvailable && item.name) {
                        let sName = item.name.split('/').pop().trim();
                        if (sName.length <= 4) tamanhos.push(sName.toUpperCase());
                    }
                });
            }

            if (tamanhos.length === 0) return null;

            // Categoria
            let categoria = 'outros';
            const categories = product ? (product.categories || []) : [];
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
            let id = product ? (product.productId || product.id) : null;
            if (!id) {
                const refEl = document.querySelector('.product-id, .product-reference');
                id = getSafeText(refEl).replace(/\D/g, '');
            }

            // Imagem
            let imageUrl = null;
            if (product && product.items && product.items.length > 0) {
                const item = product.items[0];
                if (item.images && item.images.length > 0) {
                    imageUrl = item.images[0].imageUrl;
                }
            }
            if (!imageUrl) {
                const imgEl = document.querySelector('.product-image img, [class*="product-image"] img');
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
        console.error(`❌ Erro ao parsear Riachuelo ${urlOrId}: ${error.message}`);
        return null;
    }
}

module.exports = { parseProductRiachuelo };
