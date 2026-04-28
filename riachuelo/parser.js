/**
 * Parser para produtos Riachuelo (VTEX/Apollo)
 */

async function parseProductRiachuelo(page, urlOrId) {
    try {
        let url = urlOrId;
        if (!url.startsWith('http')) {
            const searchUrl = `https://www.riachuelo.com.br/busca?q=${url}&gad_source=1`;
            console.log(`[Riachuelo] Buscando ID ${url} via pesquisa: ${searchUrl}`);
            try {
                await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
            } catch (err) {
                console.error(`❌ [Riachuelo] Erro de navegação na busca: ${err.message}`);
                if (err.message.includes('ERR_HTTP2_PROTOCOL_ERROR')) {
                    console.log('💡 Sugestão: Desative o HTTP2 no Puppeteer.');
                }
                return null;
            }
            await new Promise(r => setTimeout(r, 4000)); // Aumentado de 2s para 4s para garantir carregamento da vitrine
            
            // Caso A: Redirecionou direto para a página do produto
            if (page.url().includes('/p/') || page.url().includes('_sku')) {
                console.log(`[Riachuelo] Redirecionamento direto detectado: ${page.url()}`);
                url = page.url();
            } else {
                // Anti-Redirect na busca
                if (page.url().includes('privacidade.') || page.url().includes('politicas-de-privacidade')) {
                    console.log(`[Riachuelo] Redirecionamento de privacidade na BUSCA. Tentando contornar...`);
                    try {
                        const acceptBtn = await page.waitForSelector('a.cc-btn.cc-allow, button#onetrust-accept-btn-handler', { timeout: 5000 });
                        if (acceptBtn) await acceptBtn.click();
                    } catch (e) {}
                    await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
                    await new Promise(r => setTimeout(r, 4000));
                }

                // Aguarda a vitrine carregar (seletor genérico de produto da Riachuelo)
                await page.waitForSelector('a[href*="/p/"], a[href*="_sku"], [class*="product-card"]', { timeout: 15000 }).catch(() => {});

                let productLink = await page.evaluate((targetId) => {
                    const links = Array.from(document.querySelectorAll('a'));
                    // 1. Tenta link que contém o ID exato e parece um produto
                    const exactLink = links.find(l => 
                        l.href.includes(targetId) && 
                        (l.href.includes('_sku') || l.href.includes('/p/')) && 
                        !l.href.includes('busca') && 
                        !l.href.includes('privacidade')
                    );
                    if (exactLink) return exactLink.href;

                    // 2. Tenta qualquer link que pareça um produto (pegando o primeiro da vitrine)
                    const candidates = links.filter(l => 
                        (l.href.includes('/p/') || l.href.includes('_sku')) && 
                        !l.href.includes('busca') &&
                        !l.href.includes('privacidade') &&
                        !l.href.includes('google')
                    );
                    return candidates.length > 0 ? candidates[0].href : null;
                }, url);
                
                // Caso B: Falhou busca inicial, tenta fallback de 8 dígitos se for 10
                if (!productLink) {
                    let retryId = null;
                    if (url.length === 10 && url.endsWith('00')) {
                        retryId = url.substring(0, 8);
                        console.log(`[Riachuelo] ID de 10 dígitos (00) falhou. Tentando 8 dígitos: ${retryId}`);
                    }

                    if (retryId) {
                        const retryUrl = `https://www.riachuelo.com.br/busca?q=${retryId}&gad_source=1`;
                        await page.goto(retryUrl, { waitUntil: 'load', timeout: 60000 });
                        await new Promise(r => setTimeout(r, 3000));

                        if (page.url().includes('/p/') || page.url().includes('_sku')) {
                            console.log(`[Riachuelo] Redirecionamento direto detectado no retry: ${page.url()}`);
                            url = page.url();
                            productLink = url;
                        } else {
                            productLink = await page.evaluate((pid) => {
                                const links = Array.from(document.querySelectorAll('a'));
                                const link = links.find(l => 
                                    l.href.includes(pid) && 
                                    (l.href.includes('_sku') || l.href.includes('/p/')) && 
                                    !l.href.includes('busca')
                                );
                                if (link) return link.href;
                                
                                // Último recurso: pega o primeiro produto que aparecer
                                const firstProd = links.find(l => (l.href.includes('/p/') || l.href.includes('_sku')) && !l.href.includes('busca'));
                                return firstProd ? firstProd.href : null;
                            }, retryId);

                            if (productLink) {
                                url = productLink;
                                console.log(`[Riachuelo] Produto encontrado com ID parcial, navegando para: ${url}`);
                            }
                        }
                    }
                }

                if (!productLink && !page.url().includes('/p/') && !page.url().includes('_sku')) {
                    console.log(`❌ [Riachuelo] Produto não encontrado na busca para ID: ${url}`);
                    return null;
                }

                if (productLink && !page.url().includes(productLink)) {
                    console.log(`[Riachuelo] Produto encontrado nos resultados, navegando para: ${productLink}`);
                    await page.goto(productLink, { waitUntil: 'load', timeout: 60000 });
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            // Anti-Redirect no PDP final
            if (page.url().includes('privacidade.') || page.url().includes('politicas-de-privacidade')) {
                console.log(`[Riachuelo] Redirecionamento de privacidade no PDP. Tentando contornar...`);
                try {
                    const acceptBtn = await page.waitForSelector('a.cc-btn.cc-allow, button#onetrust-accept-btn-handler', { timeout: 5000 });
                    if (acceptBtn) await acceptBtn.click();
                } catch (e) {}
                await page.goto(page.url(), { waitUntil: 'load', timeout: 60000 });
                await new Promise(r => setTimeout(r, 2000));
            }
        } else {
             await page.goto(url, { waitUntil: 'load', timeout: 60000 });
             await new Promise(r => setTimeout(r, 2000)); // Reduzido de 5s
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
                    console.log(`[Riachuelo] Deep sizes found: ${deepSizes.join(', ')}`);

                    // Tenta encontrar a lista de SKUs do produto principal
                    let skus = [];
                    const mainId = d.sku || d.skuGroup?.id || d.skuSubGroup?.id || d.id;
                    
                    if (d.skuGroup && Array.isArray(d.skuGroup.skus)) {
                        skus = d.skuGroup.skus;
                    } else if (d.skuSubGroup && Array.isArray(d.skuSubGroup.skus)) {
                        skus = d.skuSubGroup.skus;
                    } else if (Array.isArray(d.skus)) {
                        // Se for uma lista genérica, tenta filtrar pelo ID principal se disponível
                        skus = d.skus.filter(s => !mainId || s.productId === mainId || String(s.id).startsWith(String(mainId).substring(0, 8)));
                    } else if (Array.isArray(d.items)) {
                        skus = d.items.filter(s => !mainId || s.productId === mainId || String(s.itemId).startsWith(String(mainId).substring(0, 8)));
                    }
                    
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
                    
                    // Removido o preenchimento automático de tamanhosRaw via deepSizes para evitar pegar tamanhos indisponíveis
                    // console.log(`[Riachuelo] Deep sizes found: ${deepSizes.join(', ')}`);
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
            const sizeSelectors = [
                '.sku-selector__item:not(.sku-selector__item--unavailable)',
                '[class*="size-selector"] li:not([class*="unavailable"])',
                '[class*="product-attributes"] [class*="size"]:not([class*="unavailable"])',
                '.product-sizes__item:not(.--unavailable)',
                '[class*="controlLabel"]:not([class*="disabled"])',
                'label[class*="MuiFormControlLabel"]:not([class*="Mui-disabled"])',
                '[class*="SizeButton"]:not([class*="disabled"])'
            ];
            
            // DOM - Restrito à área do produto para evitar "contaminação" de produtos recomendados/recentes
            const mainContent = document.querySelector('main, [class*="ProductDetails"], [class*="ProductInfo"], .product-info') || document;
            
            sizeSelectors.forEach(sel => {
                mainContent.querySelectorAll(sel).forEach(el => {
                    // Ignora elementos que estão dentro de seções de recomendações ou vistos recentemente
                    if (el.closest('[class*="RecentlyViewed"], [class*="Recommendations"], [class*="RelatedProducts"], [class*="Carousel"]')) {
                        return;
                    }

                    // Verifica se o elemento está explicitamente marcado como indisponível/desativado
                    const isUnavailable = el.matches('[class*="unavailable"], [class*="disabled"], [aria-disabled="true"], .Mui-disabled') ||
                                         el.closest('[class*="unavailable"], [class*="disabled"], [aria-disabled="true"], .Mui-disabled');
                    
                    if (isUnavailable) return;

                    let txt = getSafeText(el).split('\n')[0].trim().toUpperCase();
                    // Regex para capturar tamanhos puros ou com variações comuns (ex: "G - 42")
                    const sizeMatch = txt.match(/^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/);
                    if (sizeMatch) {
                        tamanhosRaw.push(sizeMatch[1]);
                    }
                });
            });

            // VTEX/NEXT State - Agora é a fonte principal ou fallback confiável
            if (vtexProduct && vtexProduct.items) {
                vtexProduct.items.forEach(item => {
                    const seller = item.sellers ? item.sellers[0] : null;
                    const offer = seller ? seller.commertialOffer : null;
                    const isAvailable = offer && offer.AvailableQuantity > 0;
                    
                    if (isAvailable && item.name) {
                        // Tenta extrair o tamanho do nome ou atributos
                        let s = null;
                        if (item.name) {
                            const parts = item.name.split(/[\s-/]+/).map(p => p.trim().toUpperCase());
                            s = parts.find(p => /^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/.test(p));
                        }
                        
                        if (!s && item.attributes) {
                            const attrVal = item.attributes.tamanho || item.attributes.Tamanho;
                            if (attrVal && /^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/i.test(attrVal)) {
                                s = attrVal.toUpperCase();
                            }
                        }

                        if (s) {
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
            let allSkuIds = [];
            if (vtexProduct && vtexProduct.items) {
                allSkuIds = vtexProduct.items.map(item => String(item.itemId || item.id || ''));
            }
            if (id) allSkuIds.push(String(id));
            allSkuIds = [...new Set(allSkuIds.filter(Boolean))];

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
                allSkuIds,
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
