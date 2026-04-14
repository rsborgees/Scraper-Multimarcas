const { parseProductRenner } = require('./renner/parser');
const { generateAwinLink } = require('./utils/affiliateManager');
const { formatRennerMessage } = require('./utils/messageFormatter');
const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

async function sendManualTest() {
    console.log('🧪 [Manual] Buscando 3 produtos Renner para teste final...');
    
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    try {
        // Pega do setor de vestidos/novidades
        await page.goto('https://www.lojasrenner.com.br/c/feminino/vestidos', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        const productUrls = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
            return [...new Set(links.map(a => a.href))].slice(0, 3);
        });

        console.log(`🔎 Encontradas ${productUrls.length} URLs.`);
        
        const results = [];
        for (const url of productUrls) {
            console.log(`🕵️ Processando: ${url}`);
            const data = await parseProductRenner(page, url);
            if (data) {
                data.url = await generateAwinLink(data.url, 'renner');
                data.message = formatRennerMessage(data);
                results.push({ ...data, store: 'renner' });
                console.log(`✅ Sucesso: ${data.nome} | Tamanhos: ${data.tamanhos.join(', ')}`);
            }
        }

        if (results.length > 0) {
            console.log(`📡 Enviando para o webhook: ${process.env.WEBHOOK_URL}`);
            await axios.post(process.env.WEBHOOK_URL, results);
            console.log('✅ Finalizado! Itens enviados.');
        } else {
            console.log('❌ Falha ao processar produtos.');
        }

    } catch (error) {
        console.error('❌ Erro:', error.message);
    } finally {
        await browser.close();
    }
}

sendManualTest();
