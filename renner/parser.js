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
            await new Promise(r => setTimeout(r, 5000));

            // Caso A: Redirecionou direto para a página do produto
            if (page.url().includes('/p/')) {
                console.log(`[Renner] Redirecionamento direto detectado: ${page.url()}`);
                url = page.url();
            } else {
                // Caso B: Caiu na página de resultados de busca
                const productLink = await page.evaluate(() => {
                    // Seletores mais abrangentes para a página de busca da Renner
                    const link = document.querySelector('div[class*="product-card"] a[href*="/p/"], a[href*="/p/"]');
                    return link ? link.href : null;
                });
                
                if (!productLink) {
                    console.log(`❌ [Renner] Produto não encontrado na busca para ID: ${url}`);
                    return null;
                }
                url = productLink;
                console.log(`[Renner] Produto encontrado nos resultados, navegando para: ${url}`);
            }
        }

        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        
        // Espera de hidratação (Next.js)
        await new Promise(r => setTimeout(r, 5000));

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
                if (props.product) product = props.product;
                else if (props.initialData && props.initialData.product) product = props.initialData.product;
            }

            // Nome
            const h1 = document.querySelector('h1, [class*="product-name"], .product-name');
            let nome = getSafeText(h1);
            if (!nome && product) nome = product.name;
            if (!nome) return null;

            // Preços
            const getPriceValue = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                let txt = getSafeText(el).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                return parseFloat(txt);
            };

            let precoOriginal = getPriceValue('.price-old, [class*="price-old"]');
            let precoAtual = getPriceValue('.price-new, [class*="price-new"], .price-selling');

            // Fallback via Next.js Data
            if ((!precoAtual || isNaN(precoAtual)) && product) {
                precoAtual = product.price ? product.price.sellingPrice : (product.salePrice || product.listPrice);
                precoOriginal = product.price ? (product.price.listPrice || precoAtual) : (product.listPrice || precoAtual);
            }

            if (!precoOriginal) precoOriginal = precoAtual;
            if (precoOriginal < precoAtual) precoOriginal = precoAtual;

            // --- EXTRAÇÃO DE TAMANHOS ---
            const tamanhos = [];

            // ESTRATÉGIA PRINCIPAL: window.__NEXT_DATA__ (DADOS INTERNOS)
            // É a mais confiável pois refere-se apenas ao SKU principal e seus irmãos de cor.
            if (product) {
                if (product.skus && product.skus.length > 0) {
                    product.skus.forEach(sku => {
                        if (sku.available && sku.size) {
                            tamanhos.push(sku.size.toUpperCase());
                        }
                    });
                } else if (product.variants && Array.isArray(product.variants)) {
                    product.variants.forEach(variant => {
                        const hasStock = variant.omniStock > 0 || variant.purchasable;
                        if (hasStock) {
                            let size = null;
                            if (variant.characteristics && variant.characteristics.Tamanho) {
                                size = variant.characteristics.Tamanho;
                            } else if (variant.skuAttributes && variant.skuAttributes.Tamanho) {
                                size = variant.skuAttributes.Tamanho;
                            }
                            if (size) tamanhos.push(size.toUpperCase());
                        }
                    });
                }
            }

            // ESTRATÉGIA SECUNDÁRIA: DOM (Apenas se o Plano A falhar)
            if (tamanhos.length === 0) {
                // Estratégia Cirúrgica: Procurar o seletor de tamanhos MAIS PRÓXIMO do H1 (Título do Produto)
                const h1 = document.querySelector('h1');
                let mainProductContainer = h1 ? h1.parentElement : document;
                
                // Sobe até achar um container que tenha seletores de tamanho
                let limit = 5;
                while (mainProductContainer && limit > 0) {
                    if (mainProductContainer.querySelector('.size-selector__item, [aria-label="Tamanho"]')) break;
                    mainProductContainer = mainProductContainer.parentElement;
                    limit--;
                }

                const scope = mainProductContainer || document;
                const sizeElements = Array.from(scope.querySelectorAll('.size-selector__item:not(.size-selector__item--unavailable), [aria-label="Tamanho"] option'));
                
                sizeElements.forEach(el => {
                    let isUnavailable = el.className && (el.className.includes('--unavailable') || el.className.includes('disabled')) || 
                                         el.getAttribute('aria-disabled') === 'true' ||
                                         el.innerText.includes('Esgotado');
                    
                    if (el.tagName && el.tagName.toLowerCase() === 'option') {
                         if (el.value === '-' || !el.value) isUnavailable = true;
                    }
                    
                    if (!isUnavailable) {
                        let sizeText = getSafeText(el);
                        if (sizeText && sizeText.length <= 4 && !sizeText.includes('Selecione')) {
                            tamanhos.push(sizeText.toUpperCase());
                        }
                    }
                });
            }

            // FALLBACK FINAL: Se ainda assim estiver vazio, tenta pegar o tamanho do SKU atual do NextData
            if (tamanhos.length === 0 && product && product.skuAttributes) {
                const sizeAttr = product.skuAttributes.find(a => a.attributeType === 'size' || a.attributeName === 'Tamanho');
                if (sizeAttr && sizeAttr.name) {
                    tamanhos.push(sizeAttr.name.toUpperCase());
                }
            }

            if (tamanhos.length === 0) return null;

            // Categoria
            let categoria = 'outros';
            const categories = product ? (product.categories || []) : [];
            const breadcrumb = categories.map(c => c.name).join(' ').toLowerCase();
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
            let id = product ? product.id : null;
            if (!id && product) id = product.sku;
            if (!id) {
                const urlMatch = window.location.href.match(/-(\d{9,})/);
                if (urlMatch) id = urlMatch[1];
            }

            // Imagem
            let imageUrl = null;
            if (product && product.images && product.images.length > 0) {
                imageUrl = product.images[0].url;
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
        console.error(`❌ Erro ao parsear Renner ${urlOrId}: ${error.message}`);
        return null;
    }
}

module.exports = { parseProductRenner };
