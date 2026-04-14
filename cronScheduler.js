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
    'renner': 35,    // Agora 35 itens/dia conforme solicitado
    'cea': 50,
    'riachuelo': 50
};

/**
 * Cálculo de GAP (Meta - Enviados Hoje)
 */
function calculateDynamicQuotas() {
    const history = loadHistory();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    
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

    return { quotas, counts };
}

/**
 * Cálculo do limite por hora para "espalhar" o envio
 */
function calculateHourlyBatchLimit(quotas) {
    const now = new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"});
    const currentHour = new Date(now).getHours();
    
    // Janela é de 07:00 às 21:00 (Total 15 horas se começar às 07:00)
    const endHour = 21;
    const hoursRemaining = Math.max(1, endHour - currentHour + 1);

    const hourlyLimits = {};
    let totalBatchSize = 0;

    Object.keys(quotas).forEach(store => {
        // Divide o que falta pelas horas que faltam
        const limit = Math.ceil(quotas[store] / hoursRemaining);
        hourlyLimits[store] = limit;
        totalBatchSize += limit;
    });

    return { hourlyLimits, totalBatchSize };
}

/**
 * JOB HORÁRIO: 07:00 às 21:00
 */
cron.schedule('0 7-21 * * *', async () => {
    console.log(`\n⏰ [${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] Iniciando Job Horário...`);
    
    try {
        const { quotas, counts } = calculateDynamicQuotas();
        const { hourlyLimits, totalBatchSize } = calculateHourlyBatchLimit(quotas);
        
        console.log('📊 [Quota Service] Status atual:', counts);
        console.log('🎯 [Quota Service] GAPs totais:', quotas);
        console.log('⚖️ [Quota Service] Limites para esta rodada:', hourlyLimits);

        if (totalBatchSize === 0) {
            console.log('✅ [Scheduler] Metas diárias já atingidas para todas as lojas.');
            return;
        }

        // 1. Coleta bruta via Orquestrador
        // Passamos o total de GAPs para o orquestrador buscar o suficiente, 
        // mas o Distributor filtrará apenas o limite desta hora.
        const rawPool = await runAllScrapers(quotas);
        
        // 2. Filtragem e Seleção inteligente (usando o limite calculado para esta hora)
        // O distributeLinks selecionará os N melhores do pool total
        const finalSelection = distributeLinks(rawPool, totalBatchSize);
        
        if (finalSelection.length > 0) {
            // 3. Envio para o Webhook (Lote único)
            await sendBatchToWebhook(finalSelection);
            
            // 4. Marcar como enviado no histórico
            finalSelection.forEach(item => {
                markAsSent(item.driveId || item.id, item.store);
            });
            console.log(`✅ [Scheduler] Rodada finalizada: ${finalSelection.length} itens enviados.`);
        } else {
            console.log('📭 [Scheduler] Nenhum item disponível ou selecionado para envio nesta rodada.');
        }

    } catch (error) {
        console.error('❌ [Scheduler] Falha no ciclo horário:', error.message);
    }
}, {
    timezone: "America/Sao_Paulo"
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
console.log('📅 Agendamento: 07h-21h (De hora em hora)');
console.log('🎯 Metas: Renner (35) | C&A (50) | Riachuelo (50)');
