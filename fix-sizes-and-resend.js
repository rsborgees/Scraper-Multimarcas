/**
 * fix-sizes-and-resend.js
 *
 * Para cada produto da tabela produtos_2 do Supabase:
 *   1. Abre a página da Renner via Puppeteer
 *   2. Raspa TODOS os tamanhos disponíveis
 *   3. Atualiza o registro no Supabase (tamanhos + message)
 *   4. Envia o produto corrigido pro Webhook
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const https = require('https');
require('dotenv').config();

const SUPABASE_URL = 'https://tzmwlmefpkskuogvhksw.supabase.co';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const invisibleChar = 'ㅤ'; // U+3164

// ─── Supabase helpers ──────────────────────────────────────────────────────────

function supabaseRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(SUPABASE_URL + '/rest/v1' + path);
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method,
            headers: {
                'apikey': SERVICE_KEY,
                'Authorization': 'Bearer ' + SERVICE_KEY,
                'Content-Type': 'application/json',
                'Prefer': method === 'PATCH' ? 'return=representation' : ''
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(data ? JSON.parse(data) : {});
                } catch {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function getAllProducts() {
    return supabaseRequest(
        'GET',
        '/produtos_2?select=id,codigo,nome,tamanhos,loja,linkproduto,imgloja,precooriginal,precodesconto,message&order=id.asc'
    );
}

async function updateProductInSupabase(id, tamanhos, message) {
    // Supabase expects JSONB arrays as JS arrays. 
    // The column "tamanhos" is text[] in postgres, so we send as JS array.
    return supabaseRequest(
        'PATCH',
        `/produtos_2?id=eq.${id}`,
        { tamanhos, message }
    );
}

// ─── Message formatter (identical to messageFormatter.js) ─────────────────────

function formatRennerMessage(product) {
    const formatCurrency = (val) => {
        if (!val || isNaN(val)) return 'R$ --';
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const precoOriginal = formatCurrency(product.precoOriginal);
    const precoAtual = formatCurrency(product.precoAtual);

    const tamanhosStr = (product.tamanhos && product.tamanhos.length > 0)
        ? product.tamanhos.join(' ')
        : 'Consultar no site';

    const priceLine = (product.precoOriginal && product.precoOriginal > product.precoAtual)
        ? `De ~${precoOriginal}~ por *${precoAtual}*`
        : `por *${precoAtual}*`;

    return `*RENNER*
${invisibleChar}
🏷️ Cupom *FRANCALHEIRA*
(ativo clicando pelos meus links) 

${product.nome}
${tamanhosStr}
${priceLine}

🔗 ${product.url}

Vagas para nossa Comunidade: 
(chama as amigas) 👇🏼

https://chat.whatsapp.com/BvwDGxSyny67OV0loLpS9p`;
}

// ─── Renner size scraper ───────────────────────────────────────────────────────

async function scrapeRennerSizes(page, codigoOrUrl) {
    try {
        let url = codigoOrUrl;
        if (!url.startsWith('http')) {
            const searchUrl = `https://www.lojasrenner.com.br/b?Ntt=${url}`;
            console.log(`    [Scraper] Buscando via pesquisa: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
            await new Promise(r => setTimeout(r, 5000));

            if (page.url().includes('/p/')) {
                url = page.url();
            } else {
                const productLink = await page.evaluate(() => {
                    const link = document.querySelector('a[href*="/p/"]');
                    return link ? link.href : null;
                });
                if (!productLink) {
                    console.log(`    ❌ Produto não encontrado na busca.`);
                    return { tamanhos: null, url: null };
                }
                url = productLink;
            }
        }

        console.log(`    [Scraper] Abrindo página: ${url}`);
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        const result = await page.evaluate(() => {
            const getSafeText = (el) => {
                if (!el) return '';
                const txt = el.innerText || el.textContent || '';
                return (typeof txt === 'string') ? txt.trim() : '';
            };

            const nextData = window.__NEXT_DATA__;
            let product = null;

            if (nextData && nextData.props && nextData.props.pageProps) {
                const props = nextData.props.pageProps;
                if (props.product) product = props.product;
                else if (props.initialData && props.initialData.product) product = props.initialData.product;
            }

            // --- EXTRAÇÃO DE TAMANHOS ---
            const tamanhosRaw = [];

            // ESTRATÉGIA PRINCIPAL: window.__NEXT_DATA__ (DADOS INTERNOS)
            if (product) {
                const skus = product.skus || [];
                if (skus.length > 0) {
                    skus.forEach(sku => {
                        const isAvailable = sku.available || (sku.inventory && sku.inventory > 0) || (sku.stock && sku.stock > 0);
                        if (isAvailable && sku.size) {
                            tamanhosRaw.push(sku.size.toUpperCase());
                        }
                    });
                } else if (product.variants && Array.isArray(product.variants)) {
                    product.variants.forEach(variant => {
                        const hasStock = variant.omniStock > 0 || variant.purchasable || variant.available;
                        if (hasStock) {
                            let size = null;
                            if (variant.characteristics && variant.characteristics.Tamanho) {
                                size = variant.characteristics.Tamanho;
                            } else if (variant.skuAttributes) {
                                const attr = Array.isArray(variant.skuAttributes) 
                                    ? variant.skuAttributes.find(a => a.attributeType === 'size' || a.attributeName === 'Tamanho')
                                    : (variant.skuAttributes.Tamanho || variant.skuAttributes.size);
                                size = attr ? (typeof attr === 'object' ? attr.name || attr.value : attr) : null;
                            }
                            if (size) tamanhosRaw.push(size.toUpperCase());
                        }
                    });
                }
            }

            // ESTRATÉGIA SECUNDÁRIA: DOM
            if (tamanhosRaw.length === 0) {
                const h1 = document.querySelector('h1');
                const mainScope = document.querySelector('[class*="product-info"], [class*="product-details"], .product-main') || 
                                 h1?.closest('section') || 
                                 h1?.parentElement?.parentElement || 
                                 document;

                const sizeElements = Array.from(mainScope.querySelectorAll('.size-selector__item, [aria-label="Tamanho"] option'))
                    .filter(el => !el.closest('[class*="carousel"], [class*="recommendation"], [class*="related"]'));
                
                sizeElements.forEach(el => {
                    const className = el.className || '';
                    let isUnavailable = className.includes('--unavailable') || 
                                         className.includes('disabled') || 
                                         el.getAttribute('aria-disabled') === 'true' ||
                                         el.hasAttribute('disabled') ||
                                         (el.innerText || '').includes('Esgotado');
                    
                    if (el.tagName && el.tagName.toLowerCase() === 'option') {
                         if (el.value === '-' || !el.value) isUnavailable = true;
                    }
                    
                    if (!isUnavailable) {
                        let sizeText = getSafeText(el);
                        if (sizeText && sizeText.length <= 5 && !sizeText.toLowerCase().includes('selecione')) {
                            tamanhosRaw.push(sizeText.toUpperCase());
                        }
                    }
                });
            }

            // FALLBACK FINAL
            if (tamanhosRaw.length === 0 && product && product.skuAttributes) {
                const attrs = Array.isArray(product.skuAttributes) ? product.skuAttributes : [];
                const sizeAttr = attrs.find(a => a.attributeType === 'size' || a.attributeName === 'Tamanho');
                if (sizeAttr && sizeAttr.name) {
                    tamanhosRaw.push(sizeAttr.name.toUpperCase());
                }
            }

            // FILTRO DE HOMOGENEIDADE
            let finalTamanhos = [...new Set(tamanhosRaw)];
            const isAlpha = (s) => /^[P|M|G|U|X|S]+$/i.test(s) || s.includes('GG') || s.includes('PP');
            const isNumeric = (s) => /^\d+$/.test(s);
            
            const alphas = finalTamanhos.filter(isAlpha);
            const numerics = finalTamanhos.filter(isNumeric);

            if (alphas.length > 0 && numerics.length > 0) {
                const isShoeNumeric = numerics.some(n => ['35', '37', '39'].includes(n));
                if (isShoeNumeric) {
                    finalTamanhos = alphas; 
                } else if (alphas.length > numerics.length) {
                    finalTamanhos = alphas;
                } else {
                    finalTamanhos = numerics;
                }
            }
            
            return {
                tamanhos: finalTamanhos,
                pageUrl: window.location.href
            };
        });

        return result;
    } catch (e) {
        console.error(`    ❌ Erro ao raspar tamanhos: ${e.message}`);
        return { tamanhos: null, url: null };
    }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('🔍 Buscando todos os produtos de produtos_2...');
    const products = await getAllProducts();
    console.log(`✅ ${products.length} produtos encontrados no banco.`);
    console.log('');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    const webhookPayload = [];
    let updated = 0;
    let noChange = 0;
    let failed = 0;

    for (let i = 0; i < products.length; i++) {
        const p = products[i];
        console.log(`\n[${i + 1}/${products.length}] ${p.nome}`);
        console.log(`  Código: ${p.codigo} | Tamanhos atuais: ${p.tamanhos}`);

        // Try the product link first (it's a tidd.ly redirect), then fallback to code search
        const { tamanhos: newTamanhos, pageUrl } = await scrapeRennerSizes(page, p.codigo);

        if (!newTamanhos || newTamanhos.length === 0) {
            console.log(`  ⚠️  Não foi possível obter tamanhos. Mantendo o atual.`);
            // Still put in webhook with existing data
            const existingTamanhos = p.tamanhos.replace(/[{}]/g, '').split(',').map(t => t.trim()).filter(Boolean);
            webhookPayload.push(buildWebhookItem(p, existingTamanhos));
            failed++;
            continue;
        }

        console.log(`  ✅ Tamanhos obtidos: [${newTamanhos.join(', ')}]`);

        // Build the updated message
        const updatedMessage = formatRennerMessage({
            nome: p.nome,
            tamanhos: newTamanhos,
            precoAtual: p.precodesconto,
            precoOriginal: p.precooriginal,
            url: p.linkproduto
        });

        // Update in Supabase
        try {
            await updateProductInSupabase(p.id, newTamanhos, updatedMessage);
            console.log(`  💾 Supabase atualizado (id=${p.id})`);
            updated++;
        } catch (e) {
            console.error(`  ❌ Falha ao atualizar Supabase: ${e.message}`);
        }

        webhookPayload.push(buildWebhookItem(p, newTamanhos, updatedMessage, pageUrl));

        // Small delay between requests
        await new Promise(r => setTimeout(r, 1500));
    }

    await browser.close();

    // ─── Send to webhook ────────────────────────────────────────────────────────
    console.log(`\n📡 Enviando ${webhookPayload.length} produtos corrigidos para o webhook...`);
    console.log(`   ✅ Atualizados: ${updated} | ⚠️  Falhas: ${failed} | Sem mudança: ${noChange}`);

    // Split into batches of 10 to avoid webhook timeout
    const BATCH_SIZE = 10;
    for (let b = 0; b < webhookPayload.length; b += BATCH_SIZE) {
        const batch = webhookPayload.slice(b, b + BATCH_SIZE);
        try {
            const resp = await axios.post(WEBHOOK_URL, batch, { timeout: 30000 });
            console.log(`   📦 Batch ${Math.floor(b / BATCH_SIZE) + 1}: ${resp.status} ✅`);
        } catch (e) {
            console.error(`   ❌ Batch ${Math.floor(b / BATCH_SIZE) + 1} falhou: ${e.message}`);
        }
        if (b + BATCH_SIZE < webhookPayload.length) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log('\n🎉 Concluído!');
}

function buildWebhookItem(p, tamanhos, message = null, pageUrl = null) {
    const tamString = tamanhos.join(' ');
    const msg = message || p.message;

    return {
        id: p.codigo,
        nome: p.nome,
        precoAtual: p.precodesconto,
        precoOriginal: p.precooriginal,
        tamanhos,
        loja: p.loja,
        url: p.linkproduto,
        imageUrl: p.imgloja,
        message: msg,
        store: p.loja
    };
}

main().catch(e => {
    console.error('💥 Erro fatal:', e.message);
    process.exit(1);
});
