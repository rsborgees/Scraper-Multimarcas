const { google } = require('googleapis');
const axios = require('axios');
const puppeteer = require('puppeteer');
require('dotenv').config();

const { parseProductRenner } = require('./renner/parser');
const { generateAwinLink } = require('./utils/affiliateManager');

function formatRennerMessage(product) {
    const invisibleChar = 'ㅤ';
    const formatCurrency = (val) => {
        if (val === undefined || val === null || isNaN(val)) return 'R$ --';
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

async function sendSpecificDriveItem() {
    const sku = '930932613';
    const driveId = '1oJ6wcvyThm_4IM3y6CSmVMVVLK1-xWt2';
    
    console.log(`[Teste] Processando SKU ${sku} do Drive...`);

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        const data = await parseProductRenner(page, sku);
        if (data) {
            console.log(`✅ Produto extraído: ${data.nome}`);
            console.log(`✅ Tamanhos capturados: [${data.tamanhos.join(', ')}]`);
            
            // Generate affiliate link
            const originalUrl = data.url;
            data.url = generateAwinLink ? await generateAwinLink(originalUrl, 'renner') : originalUrl;
            
            // Force Drive Image URL
            data.imageUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
            
            // Format message
            data.message = formatRennerMessage(data);

            console.log("Payload para Webhook:", JSON.stringify({
                id: data.id,
                nome: data.nome,
                tamanhos: data.tamanhos,
                precoAtual: data.precoAtual,
                precoOriginal: data.precoOriginal,
                store: data.store
            }, null, 2));

            const response = await axios.post(process.env.WEBHOOK_URL, [data]);
            console.log(`🚀 Webhook enviado! Status: ${response.status}`);
        } else {
            console.log("❌ Falha na raspagem do produto.");
        }
    } catch (e) {
        console.error("💥 Erro:", e.message);
    } finally {
        await browser.close();
    }
}

sendSpecificDriveItem();
