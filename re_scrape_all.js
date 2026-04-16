/**
 * re_scrape_all.js
 * 
 * Re-raspa todos os produtos da tabela produtos_2 do Supabase.
 * Corrige o problema dos "valores aproximados" capturando os preços exatos (com centavos).
 * Atualiza tamanhos, preços e a mensagem no Supabase.
 * Envia os dados atualizados para o Webhook.
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const https = require('https');
const { parseProductRenner } = require('./renner/parser');
const { formatRennerMessage } = require('./utils/messageFormatter');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

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

async function updateProductInSupabase(id, data) {
    return supabaseRequest(
        'PATCH',
        `/produtos_2?id=eq.${id}`,
        data
    );
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
    let updatedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < products.length; i++) {
        const p = products[i];
        console.log(`\n[${i + 1}/${products.length}] ${p.nome}`);
        console.log(`  Código: ${p.codigo} | Preço Atual DB: ${p.precodesconto}`);

        try {
            // Usamos o parser robusto que já temos
            const freshData = await parseProductRenner(page, p.codigo);

            if (!freshData) {
                console.log(`  ⚠️  Não foi possível raspar o produto. Pulando.`);
                failedCount++;
                continue;
            }

            console.log(`  ✅ Preço Raspado: ${freshData.precoAtual} (Original: ${freshData.precoOriginal})`);
            console.log(`  ✅ Tamanhos: [${freshData.tamanhos.join(', ')}]`);


            // Build the updated message with FRESH sizes from the parser
            const updatedMessage = formatRennerMessage({
                nome: freshData.nome,
                tamanhos: freshData.tamanhos, 
                precoAtual: freshData.precoAtual,
                precoOriginal: freshData.precoOriginal,
                url: p.linkproduto
            });

            // Update in Supabase - Include tamanhos
            const updateBody = {
                precooriginal: Math.round(freshData.precoOriginal),
                precodesconto: Math.round(freshData.precoAtual),
                tamanhos: freshData.tamanhos,
                message: updatedMessage
            };

            await updateProductInSupabase(p.id, updateBody);
            console.log(`  💾 Supabase atualizado (id=${p.id}) - Preços, Tamanhos e Mensagem`);
            updatedCount++;

            // Prepare for Webhook
            webhookPayload.push({
                id: p.codigo,
                nome: freshData.nome,
                precoAtual: freshData.precoAtual,
                precoOriginal: freshData.precoOriginal,
                tamanhos: freshData.tamanhos, 
                loja: p.loja,
                url: p.linkproduto,
                imageUrl: freshData.imageUrl || p.imgloja,
                message: updatedMessage,
                store: p.loja
            });

        } catch (e) {
            console.error(`  ❌ Erro ao processar: ${e.message}`);
            failedCount++;
        }

        // Delay para evitar bloqueio
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();

    // ─── Send to webhook ────────────────────────────────────────────────────────
    if (webhookPayload.length > 0) {
        console.log(`\n📡 Enviando ${webhookPayload.length} produtos atualizados para o webhook...`);
        
        // Split into batches of 10 to avoid timeouts
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
    }

    console.log(`\n🎉 Concluído! Atualizados: ${updatedCount} | Falhas: ${failedCount}`);
}

main().catch(e => {
    console.error('💥 Erro fatal:', e.message);
    process.exit(1);
});
