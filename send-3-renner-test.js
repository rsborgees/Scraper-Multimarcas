const { runAllScrapers } = require('./orchestrator');
const { parseProductRenner } = require('./renner/parser');
const { generateAwinLink } = require('./utils/affiliateManager');
const { formatRennerMessage } = require('./utils/messageFormatter');
const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

async function sendManualTest() {
    console.log('🧪 [Test] Iniciando envio manual de 3 IDs Renner do Histórico...');
    
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    // IDs pegos do history.json
    const ids = ["626440391", "928991315", "929248232"];
    const results = [];

    try {
        for (const id of ids) {
            console.log(`🕵️ [RENNER] Processando ID: ${id}`);
            const data = await parseProductRenner(page, id);
            
            if (data) {
                // Parametrização Awin
                data.url = await generateAwinLink(data.url, 'renner');
                // Adiciona a mensagem formatada
                data.message = formatRennerMessage(data);
                // Placeholder para imagem se não houver Drive (usando a da loja para o teste)
                results.push({ ...data, store: 'renner' });
                console.log(`✅ Sucesso: ${data.nome}`);
            }
        }

        if (results.length > 0) {
            console.log(`📡 [Test] Enviando ${results.length} itens para o webhook...`);
            await axios.post(process.env.WEBHOOK_URL, results);
            console.log('✅ [Test] Sucesso! Verifique seu n8n.');
        } else {
            console.log('❌ [Test] Nenhum item foi processado com sucesso.');
        }

    } catch (error) {
        console.error('❌ [Test] Erro:', error.message);
    } finally {
        await browser.close();
    }
}

sendManualTest();
