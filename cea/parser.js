/**
 * Parser para produtos C&A (VTEX IO)
 */

async function parseProductCea(page, urlOrId) {
    try {
        let url = urlOrId;
        if (!url.startsWith('http')) {
            const cleanId = url.replace(/\s+(P|M|G|GG|PP|G1|G2|G3|G4|UNI|U|\d{2})$/i, '').trim();
            const searchUrl = `https://www.cea.com.br/search/${cleanId}`;
            console.log(`[C&A] Buscando ID ${cleanId} (original: ${url}) via: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000));

            const productLink = await page.evaluate(() => {
                const selectors = [
                    '.vtex-product-summary-2-x-clearLink',
                    'a[class*="product"][href*="/p"]',
                    'a.product-details_name'
                ];
                for (const sel of selectors) {
                    const link = document.querySelector(sel);
                    if (link && link.href.includes('.cea.com.br/') && link.href.endsWith('/p')) {
                        return link.href;
                    }
                }
                return null;
            });

            if (!productLink) {
                console.log(`❌ [C&A] Produto não encontrado na busca para ID: ${url}`);
                return null;
            }
            url = productLink;
        }

        console.log(`[C&A] Navegando para PDP: ${url}`);
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // Fecha modal de consultor se existir
        await page.evaluate(() => {
            const navBtn = Array.from(document.querySelectorAll('button, a'))
                .find(b => b.innerText && b.innerText.includes('Navegar sem consultor'));
            if (navBtn) navBtn.click();
        }).catch(() => {});

        const result = await page.evaluate(() => {
            const getSafeText = (el) => el ? el.innerText.trim() : '';

            // ── Nome ────────────────────────────────────────────────────────────
            const h1 = document.querySelector('h1');
            let nome = getSafeText(h1);
            if (!nome) return null;
            
            // Limpa o nome (remove tamanho se houver no final, comum na C&A)
            nome = nome.replace(/\s+(P|M|G|GG|PP|G1|G2|G3|G4|UNI|U|\d{2})$/i, '').trim();

            // ── Preços (seletores reais da C&A) ─────────────────────────────────
            const parsePrice = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const m = el.innerText.match(/(\d{1,3}(\.\d{3})*,\d{2})/);
                return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : null;
            };

            let precoAtual    = parsePrice('.cea-store-ds-0-x-product-price__spotPrice');
            let precoOriginal = parsePrice('.cea-store-ds-0-x-product-price__listPrice');

            // Fallback — pega de qualquer elemento que tenha R$
            if (!precoAtual) {
                document.querySelectorAll('[class*="price"], [class*="Price"]').forEach(el => {
                    if (precoAtual) return;
                    const m = el.innerText.match(/R\$\s*(\d{1,3}(\.\d{3})*,\d{2})/);
                    if (m) precoAtual = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
                });
            }

            if (!precoAtual || isNaN(precoAtual)) return null;
            if (!precoOriginal || isNaN(precoOriginal)) precoOriginal = precoAtual;

            // ── Tamanhos (seletores reais da C&A) ───────────────────────────────
            const sizeMap = {};
            const sizeSelectors = [
                '.cea-store-ds-0-x-size-product--pill-container-item',
                '.cea-store-ds-0-x-pill--container',
                '[class*="pill--container"]',
                '.vtex-product-summary-2-x-sizePill'
            ];
            sizeSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    let txt = getSafeText(el).split('\n')[0].trim().toUpperCase();
                    // Limpeza adicional para tamanhos
                    txt = txt.replace(/[^A-Z0-9]/g, '').trim(); 
                    if (!txt || txt.length === 0 || txt.length > 8 || /VER|COMPRAR|AVISE/i.test(txt)) return;

                    const isDisabled = el.classList.contains('cea-store-ds-0-x-pill--container-disabled') || 
                                     el.className.toLowerCase().includes('disabled') ||
                                     el.className.toLowerCase().includes('unavailable') ||
                                     el.hasAttribute('disabled') ||
                                     el.getAttribute('aria-disabled') === 'true' ||
                                     (el.getAttribute('aria-label') && el.getAttribute('aria-label').toLowerCase().includes('indisponível')) ||
                                     el.querySelector('[class*="disabled"], [class*="unavailable"], [aria-label*="indisponível"]') !== null;

                    if (sizeMap[txt] === undefined) {
                        sizeMap[txt] = !isDisabled;
                    } else {
                        // Se encontrar qualquer indicação de que o tamanho está indisponível, marca como tal
                        if (isDisabled) sizeMap[txt] = false;
                    }
                });
            });

            const tamanhos = Object.keys(sizeMap).filter(s => sizeMap[s]).sort();
            const isAcessorio = /brinco|bolsa|colar|cinto|oculos/i.test(nome);
            if (tamanhos.length === 0 && !isAcessorio) return null;

            // ── Categoria ───────────────────────────────────────────────────────
            let categoria = 'outros';
            const low = nome.toLowerCase();
            if (low.includes('vestido'))                         categoria = 'vestido';
            else if (low.includes('macacão') || low.includes('macaquinho')) categoria = 'macacão';
            else if (low.includes('saia'))                       categoria = 'saia';
            else if (low.includes('short'))                      categoria = 'short';
            else if (low.includes('blusa') || low.includes('top') || low.includes('camisa')) categoria = 'blusa';
            else if (low.includes('jaqueta') || low.includes('casaco') || low.includes('puffer')) categoria = 'casaco';
            else if (low.includes('calça'))                      categoria = 'calça';
            else if (isAcessorio)                                categoria = 'acessório';

            // ── ID e Imagem ─────────────────────────────────────────────────────
            let id = null;
            const state = window.__STATE__;
            if (state) {
                const pKey = Object.keys(state).find(k => /^Product:[a-z]/.test(k) && !k.includes('.'));
                if (pKey) {
                    const prod = state[pKey];
                    id = prod && (prod.productReference || prod.productId);
                }

                // Preço pelo state se DOM falhou
                if (!precoAtual || precoAtual === precoOriginal) {
                    const priceKey = Object.keys(state).find(k => k.includes('priceRange.sellingPrice'));
                    if (priceKey && state[priceKey]) {
                        const sp = state[priceKey];
                        if (sp.highPrice) precoAtual = sp.highPrice;
                        if (sp.lowPrice && sp.lowPrice < precoOriginal) precoAtual = sp.lowPrice;
                    }
                    const listKey = Object.keys(state).find(k => k.includes('priceRange.listPrice'));
                    if (listKey && state[listKey] && state[listKey].highPrice) {
                        precoOriginal = state[listKey].highPrice;
                    }
                }
            }

            const imgEl = document.querySelector('.vtex-store-components-3-x-productImageTag, img[src*="arquivos"]');
            const imageUrl = imgEl ? imgEl.src : null;

            return { id, nome, precoAtual, precoOriginal, tamanhos, categoria, url: window.location.href, imageUrl, store: 'cea' };
        });

        return result;

    } catch (error) {
        console.error(`❌ Erro ao parsear C&A ${urlOrId}: ${error.message}`);
        return null;
    }
}

module.exports = { parseProductCea };
