/**
 * Parser para produtos Riachuelo (VTEX/Apollo)
 */

async function parseProductRiachuelo(page, urlOrId) {
    try {
        let url = urlOrId;
        if (!url.startsWith('http')) {
            const searchUrl = `https://www.riachuelo.com.br/busca?q=${url}&gad_source=1`;
            console.log(`[Riachuelo] Buscando ID ${url} via pesquisa: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 5000));
            
            // Anti-Redirect na busca
            if (page.url().includes('privacidade.') || page.url().includes('politicas-de-privacidade')) {
                console.log(`[Riachuelo] Redirecionamento de privacidade na BUSCA. Tentando contornar...`);
                try {
                    const acceptBtn = await page.waitForSelector('a.cc-btn.cc-allow, button#onetrust-accept-btn-handler', { timeout: 5000 });
                    if (acceptBtn) await acceptBtn.click();
                } catch (e) {}
                await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
                await new Promise(r => setTimeout(r, 5000));
            }

            const productLink = await page.evaluate((targetId) => {
                const links = Array.from(document.querySelectorAll('a'));
                // Prioridade para link que contém o ID exato e parece um produto
                const exactLink = links.find(l => 
                    l.href.includes(targetId) && 
                    (l.href.includes('_sku') || l.href.includes('/p/')) && 
                    !l.href.includes('busca') && 
                    !l.href.includes('privacidade') && 
                    !l.href.includes('politica')
                );
                if (exactLink) return exactLink.href;

                const candidates = links.filter(l => 
                    (l.href.includes('/p/') || l.href.includes('_sku') || l.href.includes('/produto/')) && 
                    !l.href.includes('busca') &&
                    !l.href.includes('privacidade') && 
                    !l.href.includes('politica') &&
                    !l.href.includes('google')
                );
                return candidates.length > 0 ? candidates[0].href : null;
            }, url);
            
            if (!productLink) {
                console.log(`❌ [Riachuelo] Produto não encontrado na busca para ID: ${url}`);
                // Screenshot da busca frustrada
                await page.screenshot({ path: `debug_riachuelo_not_found_${url}.png` });
                return null;
            }

            console.log(`[Riachuelo] Produto encontrado nos resultados, navegando para: ${productLink}`);
            await page.goto(productLink, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 5000));

            // Anti-Redirect no PDP
            if (page.url().includes('privacidade.') || page.url().includes('politicas-de-privacidade')) {
                console.log(`[Riachuelo] Redirecionamento de privacidade no PDP. Tentando contornar...`);
                try {
                    const acceptBtn = await page.waitForSelector('a.cc-btn.cc-allow, button#onetrust-accept-btn-handler', { timeout: 5000 });
                    if (acceptBtn) await acceptBtn.click();
                } catch (e) {}
                await page.goto(productLink, { waitUntil: 'load', timeout: 60000 });
                await new Promise(r => setTimeout(r, 5000));
            }
        } else {
             await page.goto(url, { waitUntil: 'load', timeout: 60000 });
             await new Promise(r => setTimeout(r, 5000));
        }

        // Anti-Redirect / Cookies genérico
        try {
            // Tenta fechar banners de cookies que bloqueiam a visão
            const cookieButtons = await page.$$('button, a');
            for (const btn of cookieButtons) {
                const text = await page.evaluate(el => el.innerText, btn);
                if (text && (text.includes('Permitir Cookies') || text.includes('Aceitar todos') || text.includes('Aceitar Cookies'))) {
                    await btn.click();
                    console.log(`[Riachuelo] Banner de cookies aceito: "${text}"`);
                    await new Promise(r => setTimeout(r, 2000));
                    break;
                }
            }
        } catch (e) {}

        console.log('[Riachuelo] Iniciando extração de dados da página...');
        const result = await page.evaluate(() => {
            const getSafeText = (el) => el ? el.innerText.trim() : null;
            const tamanhosRaw = [];
            
            const state = window.__NEXT_DATA__ || window.__PRELOADED_STATE__ || window.__STATE__ || window.__INITIAL_STATE__;
            console.log('State found:', !!state);
            let vtexProduct = null;
            let pageProps;
            
            if (state && state.props && state.props.pageProps) {
                // NEXT.JS (Riachuelo atual)
                pageProps = state.props.pageProps;
                const d = pageProps.data;
                
                if (d && d.name) {
                    // Busca profunda por tamanhos em d
                    const findSizesDeep = (obj) => {
                        const results = [];
                        const seen = new Set();
                        const search = (o) => {
                            if (!o || typeof o !== 'object' || seen.has(o)) return;
                            seen.add(o);
                            for (let k in o) {
                                const val = o[k];
                                if (typeof val === 'string' && /^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/.test(val.toUpperCase())) {
                                    results.push(val.toUpperCase());
                                }
                                search(val);
                            }
                        };
                        search(obj);
                        return [...new Set(results)];
                    };
                    
                    const deepSizes = findSizesDeep(d);
                    console.log('Deep sizes found:', JSON.stringify(deepSizes));

                    // Tenta encontrar a lista de SKUs
                    let skus = [];
                    if (d.skuGroup && Array.isArray(d.skuGroup.skus)) skus = d.skuGroup.skus;
                    else if (d.skuSubGroup && Array.isArray(d.skuSubGroup.skus)) skus = d.skuSubGroup.skus;
                    else if (Array.isArray(d.skus)) skus = d.skus;
                    else if (Array.isArray(d.items)) skus = d.items;
                    
                    vtexProduct = {
                        productName: d.name,
                        productId: d.sku || d.skuGroup?.id || d.skuSubGroup?.id,
                        link: d.urlPath,
                        categories: d.breadcrumb ? d.breadcrumb.map(b => b.label) : [],
                        items: skus.length > 0 ? skus.map(s => ({
                            name: s.name || s.tamanho || (s.attributes ? (s.attributes.tamanho || s.attributes.Tamanho) : null),
                            images: s.media ? s.media.map(m => ({ imageUrl: m.uri })) : (d.media ? d.media.map(m => ({ imageUrl: m.uri })) : []),
                            sellers: [{
                                commertialOffer: {
                                    Price: s.salePrice || d.salePrice,
                                    ListPrice: s.listPrice || d.listPrice || (s.salePrice || d.salePrice),
                                    AvailableQuantity: (s.soldOut || d.soldOut) ? 0 : 100
                                }
                            }]
                        })) : [{
                            name: deepSizes.length === 1 ? deepSizes[0] : (d.attributes ? (d.attributes.tamanho || d.attributes.Tamanho) : null),
                            images: d.media ? d.media.map(m => ({ imageUrl: m.uri })) : [],
                            sellers: [{
                                commertialOffer: {
                                    Price: d.salePrice,
                                    ListPrice: d.listPrice || d.salePrice,
                                    AvailableQuantity: d.soldOut ? 0 : 100
                                }
                            }]
                        }]
                    };
                    
                    if (deepSizes.length > 0) {
                        deepSizes.forEach(s => tamanhosRaw.push(s));
                    }
                }
            } else if (state && state.product) {
                // VTEX Padrão
                vtexProduct = state.product;
            }

            // --- EXTRAÇÃO FINAL ---
            const h1 = document.querySelector('h1, [class*="product-name"], .product-name');
            let nome = getSafeText(h1);
            if (!nome && vtexProduct) nome = vtexProduct.productName || vtexProduct.name;
            
            if (!nome) return null;

            // Preços via DOM (Estratégia 1)
            const getPriceValue = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const match = el.innerText.match(/(\d{1,3}(\.\d{3})*,\d{2})/);
                if (!match) return null;
                let txt = match[1].replace(/\./g, '').replace(',', '.').trim();
                const val = parseFloat(txt);
                return isNaN(val) ? null : val;
            };

            let precoOriginal = getPriceValue('.list-price, .old-price, [class*="list-price"], [class*="PriceSelling_listPrice"]');
            let precoAtual = getPriceValue('.sale-price, .selling-price, [class*="sale-price"], [class*="PriceSelling_sellingPrice"]');

            // Fallback via VTEX State (Estratégia 2)
            if (((!precoAtual || isNaN(precoAtual)) || (!precoOriginal || isNaN(precoOriginal))) && vtexProduct) {
                try {
                    const item = vtexProduct.items ? vtexProduct.items[0] : null;
                    if (item && item.sellers && item.sellers[0]) {
                        const offer = item.sellers[0].commertialOffer;
                        if (!precoAtual) precoAtual = offer.Price || offer.price;
                        if (!precoOriginal) precoOriginal = offer.ListPrice || offer.listPrice || precoAtual;
                    }
                } catch (e) {}
            }

            // Sanitização final de preços
            if (!precoAtual || isNaN(precoAtual)) precoAtual = precoOriginal;
            if (!precoOriginal || isNaN(precoOriginal)) precoOriginal = precoAtual;
            if (precoOriginal < precoAtual) precoOriginal = precoAtual;

            // --- TAMANHOS ---
            // Já inicializado e preenchido via NEXT_DATA se disponível
            
            // DOM
            const sizeSelectors = [
                '.sku-selector__item:not(.sku-selector__item--unavailable)',
                '[class*="size-selector"] li:not([class*="unavailable"])',
                '[class*="product-attributes"] [class*="size"]:not([class*="unavailable"])',
                '.product-sizes__item:not(.--unavailable)'
            ];

            sizeSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    const txt = getSafeText(el).toUpperCase();
                    if (txt && /^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/.test(txt)) {
                        tamanhosRaw.push(txt);
                    }
                });
            });

            // VTEX/NEXT State
            if (tamanhosRaw.length === 0 && vtexProduct && vtexProduct.items) {
                vtexProduct.items.forEach(item => {
                    const seller = item.sellers ? item.sellers[0] : null;
                    const isAvailable = seller && seller.commertialOffer && seller.commertialOffer.AvailableQuantity > 0;
                    if (isAvailable && item.name) {
                        const s = item.name.split('/').pop().trim().toUpperCase();
                        if (/^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/.test(s)) {
                            tamanhosRaw.push(s);
                        }
                    }
                });
            }

            const tamanhos = [...new Set(tamanhosRaw)].filter(s => s && s !== 'TAMANHO');
            if (tamanhos.length === 0) return null;

            // Categoria
            let categoria = 'outros';
            const categories = vtexProduct ? (vtexProduct.categories || []) : [];
            const breadcrumb = categories.join(' ').toLowerCase();
            const fullText = (nome + ' ' + breadcrumb).toLowerCase();

            if (fullText.includes('vestido')) categoria = 'vestido';
            else if (fullText.includes('macacão') || fullText.includes('macaquinho')) categoria = 'macacão';
            else if (fullText.includes('saia')) categoria = 'saia';
            else if (fullText.includes('short')) categoria = 'short';
            else if (fullText.includes('blusa') || fullText.includes('top') || fullText.includes('camisa')) categoria = 'blusa';
            else if (fullText.includes('acessório') || fullText.includes('bolsa')) categoria = 'acessório';
            else if (fullText.includes('calça')) categoria = 'calça';
            else if (fullText.includes('casaco') || fullText.includes('jaqueta')) categoria = 'casaco';

            // ID e Imagem
            let id = vtexProduct ? (vtexProduct.productId || vtexProduct.id) : null;
            let imageUrl = null;
            if (vtexProduct && vtexProduct.items && vtexProduct.items[0] && vtexProduct.items[0].images) {
                imageUrl = vtexProduct.items[0].images[0].imageUrl;
            }
            if (!imageUrl) {
                const imgEl = document.querySelector('.product-image img, [class*="product-image"] img, [class*="MainImage"] img');
                if (imgEl) imageUrl = imgEl.src;
            }

            return {
                id,
                nome,
                precoAtual,
                precoOriginal,
                tamanhos,
                categoria,
                url: window.location.href,
                imageUrl,
                store: 'riachuelo'
            };
        });

        return result;

    } catch (error) {
        console.error(`❌ Erro ao parsear Riachuelo ${urlOrId}: ${error.message}`);
        return null;
    }
}

module.exports = { parseProductRiachuelo };
