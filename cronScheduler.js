const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const { runAllScrapers } = require('./orchestrator');
const { distributeLinks } = require('./utils/linkDistributor');
const { loadHistory, markAsSent } = require('./utils/historyManager');

/**
 * CONFIGURAÇÕES DE METAS (IDEAL_TARGETS)
 * Representam a quantidade total desejada por dia.
 */
const IDEAL_TARGETS = {
    'renner': 50,    // Exemplo: 50 itens/dia
    'cea': 50,
    'riachuelo': 50
};

/**
 * Cálculo de GAP (Meta - Enviados Hoje)
 */
function calculateDynamicQuotas() {
    const history = loadHistory();
    const today = new Date().toISOString().split('T')[0];
    
    // Contagem de hoje por loja
    const counts = {};
    Object.values(history).forEach(entry => {
        if (entry.lastSent && entry.lastSent.startsWith(today)) {
            counts[entry.store] = (counts[entry.store] || 0) + 1;
        }
    });

    const quotas = {};
    Object.keys(IDEAL_TARGETS).forEach(store => {
        const sent = counts[store] || 0;
        const target = IDEAL_TARGETS[store];
        quotas[store] = Math.max(0, target - sent);
    });

    console.log('📊 [Quota Service] Status atual:', counts);
    console.log('🎯 [Quota Service] GAPs calculados:', quotas);
    
    return quotas;
}

/**
 * JOB HORÁRIO: 07:00 às 21:00
 */
cron.schedule('0 7-21 * * *', async () => {
    console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Iniciando Job Horário...`);
    
    try {
        const quotas = calculateDynamicQuotas();
        
        // 1. Coleta bruta via Orquestrador
        const rawPool = await runAllScrapers(quotas);
        
        // 2. Filtragem e Seleção inteligente
        const finalSelection = distributeLinks(rawPool, 11);
        
        if (finalSelection.length > 0) {
            // 3. Envio para o Webhook (Lote único)
            await sendBatchToWebhook(finalSelection);
            
            // 4. Marcar como enviado no histórico
            finalSelection.forEach(item => {
                markAsSent(item.driveId || item.id, item.store);
            });
        } else {
            console.log('📭 [Scheduler] Nenhum item selecionado para envio nesta rodada.');
        }

    } catch (error) {
        console.error('❌ [Scheduler] Falha no ciclo horário:', error.message);
    }
});

/**
 * JOB ESPECIAL: 05:00 AM (Sync)
 * Reservado para sincronização de novos IDs (Vazio no momento para estas lojas)
 */
cron.schedule('0 5 * * *', () => {
    console.log('🌅 [Scheduler] Iniciando Job de Sincronização Matinal...');
    console.log('ℹ️ Nenhuma tarefa de sincronização pendente para Renner/C&A/Riachuelo.');
});

/**
 * Função de entrega Webhook
 */
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

console.log('🛡️  [Server] Scraper 2.0 Daemon Ativo');
console.log('📅 Agendamento: 07h-21h (Hourly) | 05h (Sync)');
