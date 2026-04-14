const { parseProductRenner } = require('./renner/parser');
const { generateAwinLink } = require('./utils/affiliateManager');
const { formatRennerMessage } = require('./utils/messageFormatter');
const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

async function sendFreshRennerTest() {
    console.log('🧪 [Test] Buscando 3 produtos NOVOS da Renner...');
    
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    try {
        // Navega para vestidos (geralmente tem muito estoque/id fácil)
        await page.goto('https://www.lojasrenner.com.br/c/feminino/vestidos', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        const productUrls = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
            return [...new Set(links.map(a => a.href))].slice(0, 3);
        });

        console.log(`🔎 Encontradas ${productUrls.length} URLs de produtos.`);
        
        const results = [];
        for (const url of productUrls) {
            console.log(`🕵️ Processando: ${url}`);
            const data = await parseProductRenner(page, url);
            if (data) {
                data.url = await generateAwinLink(data.url, 'renner');
                data.message = formatRennerMessage(data);
                results.push({ ...data, store: 'renner' });
                console.log(`✅ Sucesso: ${data.nome}`);
            }
        }

        if (results.length > 0) {
            console.log(`📡 Enviando ${results.length} itens para o webhook...`);
            await axios.post(process.env.WEBHOOK_URL, results);
            console.log('✅ Tudo pronto! Verifique o n8n.');
        } else {
            console.log('❌ Falha ao processar produtos.');
        }

    } catch (error) {
        console.error('❌ Erro:', error.message);
    } finally {
        await browser.close();
    }
}

sendFreshRennerTest();
