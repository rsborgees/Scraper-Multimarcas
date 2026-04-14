const axios = require('axios');
const { runAllScrapers } = require('./orchestrator');
const { markAsSent } = require('./utils/historyManager');
require('dotenv').config();

async function sendBatchToWebhook(items) {
    const url = process.env.WEBHOOK_URL;
    if (!url) return;
    try {
        console.log(`📡 [Webhook] Enviando batch de ${items.length} itens...`);
        const response = await axios.post(url, items);
        if (response.status === 200) {
            console.log('✅ [Webhook] Recebido com sucesso pelo n8n.');
        }
    } catch (error) {
        console.error('❌ [Webhook] Falha no envio:', error.message);
    }
}

async function run() {
    console.log('🚀 Iniciando disparo manual de 3 peças Renner...');
    
    // Passa quota 3 diretamente: o orchestrator vai parar assim que coletar 3 sucessos
    const rawPool = await runAllScrapers({ renner: 3, cea: 0, riachuelo: 0 });
    
    if (rawPool.length > 0) {
        const toSend = rawPool.slice(0, 3);
        await sendBatchToWebhook(toSend);
        toSend.forEach(item => markAsSent(item.driveId || item.id, item.store));
        console.log(`✅ Disparo de ${toSend.length} peças concluído com sucesso!`);
    } else {
        console.log('📭 Nenhuma peça pôde ser selecionada nesta rodada.');
    }
}

run();
