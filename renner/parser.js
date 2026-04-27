/**
 * Parser para produtos Renner (Next.js)
 */

async function parseProductRenner(page, urlOrId) {
    try {
        let url = urlOrId;
        if (!url.startsWith('http')) {
            const searchUrl = `https://www.lojasrenner.com.br/b?Ntt=${url}`;
            console.log(`[Renner] Buscando ID ${url} via pesquisa: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000)); // Reduzido de 5s para 2s

            // Caso A: Redirecionou direto para a página do produto
            if (page.url().includes('/p/')) {
                console.log(`[Renner] Redirecionamento direto detectado: ${page.url()}`);
                url = page.url();
            } else {
                // Caso B: Caiu na página de resultados de busca
                console.log(`[Renner] Página de busca detectada. Aguardando resultados...`);
                
                // Tenta aceitar termos de privacidade que podem bloquear a renderização
                try {
                    await page.evaluate(() => {
                        // 1. Procura pelo checkbox específico dos termos
                        const labels = Array.from(document.querySelectorAll('label'));
                        const targetLabel = labels.find(l => l.innerText.includes('Li, aceito os Termos de Uso'));
                        if (targetLabel) {
                            const checkbox = targetLabel.querySelector('input') || document.getElementById(targetLabel.getAttribute('for'));
                            if (checkbox && !checkbox.checked) checkbox.click();
                            else if (!checkbox) targetLabel.click();
                        }

                        // 2. Procura por botões de aceitar genéricos
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const acceptBtn = buttons.find(b => {
                            const txt = b.innerText.toLowerCase();
                            return txt.includes('aceitar') || txt.includes('concordo') || txt.includes('entendido');
                        });
                        if (acceptBtn) acceptBtn.click();
                    });
                    
                    // OneTrust fallback
                    const otBtn = await page.$('#onetrust-accept-btn-handler');
                    if (otBtn) await otBtn.click();
                    
                    console.log(`[Renner] Tentativa de aceitar termos realizada.`);
                    await new Promise(r => setTimeout(r, 2000));
                } catch (e) {}

                // Aguarda o link do produto OU um sinal de que a busca terminou (mesmo se vazia)
                await page.waitForSelector('a[href*="/p/"], [class*="no-results"], [class*="SearchError"]', { timeout: 20000 }).catch(() => {});
                
                const productLink = await page.evaluate(() => {
                    // Seletores atualizados para a página de busca da Renner
                    const link = document.querySelector('a[class*="ProductBox_productBox"], [class*="product-card"] a[href*="/p/"], a[href*="/p/"]');
                    return link ? link.href : null;
                });
                
                if (!productLink) {
                    // Tenta uma segunda chance se o ID tiver espaços (muito comum no Drive)
                    if (url.includes(' ')) {
                        const firstPart = url.split(/\s+/)[0];
                        console.log(`[Renner] ID completo falhou. Tentando apenas primeira parte: ${firstPart}`);
                        const retryUrl = `https://www.lojasrenner.com.br/b?Ntt=${firstPart}`;
                        await page.goto(retryUrl, { waitUntil: 'load', timeout: 60000 });
                        await new Promise(r => setTimeout(r, 2000));
                        
                        // Verifica se redirecionou
                        if (page.url().includes('/p/')) {
                            url = page.url();
                            return parseProductRenner(page, url); // Recursão simples para processar a página do produto
                        }

                        await page.waitForSelector('a[href*="/p/"]', { timeout: 10000 }).catch(() => {});
                        const retryLink = await page.evaluate(() => {
                            const link = document.querySelector('a[class*="ProductBox_productBox"], [class*="product-card"] a[href*="/p/"], a[href*="/p/"]');
                            return link ? link.href : null;
                        });

                        if (retryLink) {
                            url = retryLink;
                            console.log(`[Renner] Produto encontrado com ID parcial, navegando para: ${url}`);
                        } else {
                            console.log(`❌ [Renner] Produto não encontrado nem com ID parcial: ${firstPart}`);
                            return null;
                        }
                    } else {
                        console.log(`❌ [Renner] Produto não encontrado na busca para ID: ${url}`);
                        return null;
                    }
                } else {
                    url = productLink;
                    console.log(`[Renner] Produto encontrado nos resultados, navegando para: ${url}`);
                }
            }
        }

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Espera de hidratação e renderização (Next.js)
        await new Promise(r => setTimeout(r, 2500)); // Reduzido de 6s para 2.5s
        await page.waitForSelector('h1, [class*="product-name"]', { timeout: 10000 }).catch(() => {});

        const data = await page.evaluate(async () => {
            const getSafeText = (el) => {
                if (!el) return '';
                const txt = el.innerText || el.textContent || '';
                return (typeof txt === 'string') ? txt.trim() : '';
            };

            // PLANO A: window.__NEXT_DATA__
            const nextData = window.__NEXT_DATA__;
            let product = null;
            if (nextData && nextData.props && nextData.props.pageProps) {
                const props = nextData.props.pageProps;
                
                // Tenta caminhos diretos primeiro
                if (props.product && props.product.name && props.product.skus) product = props.product;
                else if (props.initialData && props.initialData.product && props.initialData.product.skus) product = props.initialData.product;
                
                // Busca profunda se falhar
                if (!product || (!product.skus && !product.variants)) {
                    const findProductDeep = (obj, depth = 0) => {
                        if (!obj || depth > 15 || typeof obj !== 'object') return null;
                        
                        // Um produto real da Renner tem ID, Nome e SKUs ou Variants
                        const hasName = !!(obj.name || obj.displayName);
                        const hasItems = (Array.isArray(obj.skus) && obj.skus.length > 0) || 
                                         (Array.isArray(obj.variants) && obj.variants.length > 0) ||
                                         (typeof obj.variants === 'string' && obj.variants.length > 0);
                        const hasId = !!(obj.id || obj.productId || obj.skuId);

                        if (hasName && hasItems && hasId) {
                            return obj;
                        }
                        
                        for (let key in obj) {
                            if (['root', 'parent', 'prev', 'next', 'children'].includes(key)) continue;
                            const found = findProductDeep(obj[key], depth + 1);
                            if (found) return found;
                        }
                        return null;
                    };
                    product = findProductDeep(props);
                }
            }

            // Nome do Produto
            const h1 = document.querySelector('h1, [class*="product-name"], [aria-level="1"]');
            let nome = getSafeText(h1);
            if (!nome && product) nome = product.name || product.displayName;
            
            // Se ainda não tiver nome ou for um nome genérico detectado antes
            if (!nome || nome.toLowerCase().includes('grupo de estoque')) {
                 if (product && (product.name || product.displayName)) nome = product.name || product.displayName;
            }
            
            if (!nome) return null;

            // Preços via DOM (Estratégia 1)
            const getPriceValue = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                // Pega apenas o primeiro padrão de preço encontrado (R$ XX,XX ou XX,XX)
                const match = el.innerText.match(/(\d{1,3}(\.\d{3})*,\d{2})/);
                if (!match) return null;
                let txt = match[1].replace(/\./g, '').replace(',', '.').trim();
                const val = parseFloat(txt);
                return isNaN(val) ? null : val;
            };

            // Seletores mais robustos para Renner Next.js
            let precoOriginal = getPriceValue('.price-old, [class*="price-old"], [class*="PriceSelling_listPrice"]');
            let precoAtual = getPriceValue('.price-new, [class*="price-new"], .price-selling, [class*="PriceSelling_sellingPrice"]');

            // Fallback via Next.js Data (Estratégia 2)
            if (((!precoAtual || isNaN(precoAtual)) || (!precoOriginal || isNaN(precoOriginal))) && product) {
                // Preço atual
                if (product.salePrice && product.salePrice > 0) precoAtual = product.salePrice;
                else if (product.price && product.price.sellingPrice) precoAtual = product.price.sellingPrice;
                else if (product.price && product.price.listPrice && !precoAtual) precoAtual = product.price.listPrice;
                else if (product.salePriceFormatted) {
                    const m = product.salePriceFormatted.match(/(\d{1,3}(\.\d{3})*,\d{2})/);
                    if (m) precoAtual = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
                }

                // Preço original
                if (product.listPrice && product.listPrice > 0) precoOriginal = product.listPrice;
                else if (product.price && product.price.listPrice) precoOriginal = product.price.listPrice;
                else if (product.listPriceFormatted) {
                    const m = product.listPriceFormatted.match(/(\d{1,3}(\.\d{3})*,\d{2})/);
                    if (m) precoOriginal = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
                }
            }

            // Sanitização final: se só temos um preço, eles devem ser iguais (sem promo)
            if ((!precoAtual || isNaN(precoAtual)) && precoOriginal) precoAtual = precoOriginal;
            if ((!precoOriginal || isNaN(precoOriginal)) && precoAtual) precoOriginal = precoAtual;

            // --- EXTRAÇÃO DE TAMANHOS ---
            // NOTA: O NEXT_DATA da Renner só contém o SKU SELECIONADO no momento.
            // Para capturar TODOS os tamanhos disponíveis, o DOM é a fonte correta.
            const tamanhosRaw = [];

            // ESTRATÉGIA PRINCIPAL: DOM com seletores exatos (descobertos via análise)
            // Tamanho disponível: label.ProductAttributes_labelOption__* + ProductAttributes_attribute-size__*
            // Tamanho indisponível (riscado): label.ProductAttributes_labelOption__* + ProductAttributes_unavailableStock__*
            const labels = document.querySelectorAll('label[class*="ProductAttributes_labelOption"]');
            labels.forEach(label => {
                const cls = label.className || '';
                const isUnavailable = cls.includes('unavailableStock');
                if (!isUnavailable) {
                    const txt = (label.innerText || label.textContent || '').trim().toUpperCase();
                    const isSize = /^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/.test(txt);
                    if (txt && isSize) tamanhosRaw.push(txt);
                }
            });

            // FALLBACK 1: Outros seletores de tamanho conhecidos
            if (tamanhosRaw.length === 0) {
                const fallbackSelectors = [
                    '[class*="attribute-size"]:not([class*="unavailableStock"])',
                    '.size-selector__item:not(.--unavailable)',
                    '[aria-label="Tamanho"] option:not([disabled])'
                ];
                fallbackSelectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => {
                        const txt = (el.innerText || el.textContent || '').trim().toUpperCase();
                        const isSize = /^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/.test(txt);
                        if (txt && isSize) tamanhosRaw.push(txt);
                    });
                });
            }

            // FALLBACK 2: NEXT_DATA (só o SKU atual — usado como último recurso)
            if (tamanhosRaw.length === 0 && product) {
                // skuAttributes contem os atributos do SKU atual
                if (Array.isArray(product.skuAttributes)) {
                    const sizeAttr = product.skuAttributes.find(a => a.attributeType === 'size');
                    if (sizeAttr && sizeAttr.name) {
                        const s = sizeAttr.name.trim().toUpperCase();
                        if (s) tamanhosRaw.push(s);
                    }
                }
            }

            // Limpeza final de tamanhos
            const tamanhos = [...new Set(tamanhosRaw)].filter(s => s && s !== 'TAMANHO' && s !== 'GUIA DE MEDIDAS');

            if (tamanhos.length === 0) return null;

            // Categoria
            let categoria = 'outros';
            const categories = product ? (product.categories || product.parentCategories || []) : [];
            const breadcrumb = Array.isArray(categories) ? categories.map(c => c.name || c).join(' ').toLowerCase() : '';
            const nomeProd = (product?.name || product?.displayName || nome || '').toLowerCase();
            const fullText = (nomeProd + ' ' + breadcrumb).toLowerCase();

            if (fullText.includes('vestido')) categoria = 'vestido';
            else if (fullText.includes('macacão') || fullText.includes('macaquinho')) categoria = 'macacão';
            else if (fullText.includes('saia')) categoria = 'saia';
            else if (fullText.includes('short')) categoria = 'short';
            else if (fullText.includes('blusa') || fullText.includes('top') || fullText.includes('camisa')) categoria = 'blusa';
            else if (fullText.includes('brinco') || fullText.includes('bolsa') || fullText.includes('acessório')) categoria = 'acessório';
            else if (fullText.includes('calça')) categoria = 'calça';
            else if (fullText.includes('casaco') || fullText.includes('jaqueta')) categoria = 'casaco';

            // ID do Produto
            let id = product ? (product.id || product.productId || product.skuId) : null;
            if (!id) {
                const urlMatch = window.location.href.match(/-(\d{9,})/);
                if (urlMatch) id = urlMatch[1];
            }

            // Imagem
            let imageUrl = null;
            if (product && Array.isArray(product.images) && product.images.length > 0) {
                imageUrl = product.images[0].url;
            } else if (product && Array.isArray(product.mediaSets) && product.mediaSets.length > 0) {
                 const firstSet = product.mediaSets[0];
                 if (firstSet.images && firstSet.images.length > 0) imageUrl = firstSet.images[0].url;
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
                store: 'renner'
            };
        });

        return data;

    } catch (error) {
        console.error(`❌ Erro ao parsear Renner ${urlOrId}: ${error.message}`);
        return null;
    }
}

module.exports = { parseProductRenner };
