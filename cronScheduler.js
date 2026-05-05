const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const { runAllScrapers } = require('./orchestrator');
const { distributeLinks } = require('./utils/linkDistributor');
const { loadHistory, markAsSent } = require('./utils/historyManager');
const { loadQuotaTargets, NOVIDADE_KEYS } = require('./utils/quotaManager');

// Limites EXATOS por rodada horária (min = max = obrigatório)
const BATCH_CONFIG = {
    'renner': { min: 3, max: 10 },    // Meta 45/15h = 3. Max 10 permite recuperar atrasos.
    'riachuelo': { min: 1, max: 10 }, // Meta 15/15h = 1.
    'cea': { min: 1, max: 10 }       // Meta 10/15h = 0.6.
};

// Lojas com parser disponível (usado no cálculo horário)
const PARSERS_KEYS = { renner: true, cea: true, riachuelo: true };

/**
 * Cálculo de GAP (Meta - Enviados Hoje)
 * @param {Object} idealTargets - Metas diárias por loja, carregadas do Supabase
 */
function calculateDynamicQuotas(idealTargets) {
    const history = loadHistory();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    
    // Contagem de hoje por loja (Respeitando fuso de São Paulo)
    const counts = {};
    Object.values(history).forEach(entry => {
        if (entry.timestamp) {
            const entryDate = new Date(entry.timestamp).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            if (entryDate === today) {
                counts[entry.store] = (counts[entry.store] || 0) + 1;
            }
        } else if (entry.lastSent && entry.lastSent.startsWith(today)) {
            // Fallback para entradas antigas que não tinham timestamp numérico
            counts[entry.store] = (counts[entry.store] || 0) + 1;
        }
    });

    const quotas = {};

    // GAP das lojas principais
    Object.keys(idealTargets).forEach(key => {
        const sent = counts[key] || 0;
        const target = idealTargets[key];
        quotas[key] = Math.max(0, target - sent);
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

    // Lojas principais
    Object.keys(PARSERS_KEYS).forEach(store => {
        if ((quotas[store] || 0) <= 0) {
            hourlyLimits[store] = 0;
            return;
        }
        const config = BATCH_CONFIG[store] || { min: 1, max: 3 };
        const calculated = Math.ceil(quotas[store] / hoursRemaining);
        let limit = Math.max(config.min, calculated);
        limit = Math.min(limit, config.max);
        limit = Math.min(quotas[store], limit);
        hourlyLimits[store] = limit;
        totalBatchSize += limit;
    });

    // Chaves de novidades: proporcional ao total da loja (sem min/max rígido)
    Object.entries(NOVIDADE_KEYS).forEach(([store, novidadeKey]) => {
        const novidadeGap = quotas[novidadeKey] || 0;
        if (novidadeGap <= 0) {
            hourlyLimits[novidadeKey] = 0;
            return;
        }
        // Divide o gap restante pelas horas restantes, mínimo 1
        const calculated = Math.ceil(novidadeGap / hoursRemaining);
        // Não ultrapassa o limite total da loja nesta hora
        const storeLimit = hourlyLimits[store] || 0;
        const novidadeLimit = Math.min(calculated, novidadeGap, storeLimit);
        hourlyLimits[novidadeKey] = novidadeLimit;
    });

    return { hourlyLimits, totalBatchSize };
}

/**
 * JOB HORÁRIO: 07:00 às 21:00
 */
cron.schedule('0 7-21 * * *', async () => {
    console.log(`\n⏰ [${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] Iniciando Job Horário...`);
    
    try {
        // Carrega metas do Supabase a cada rodada (mudanças entram em vigor na próxima hora)
        const IDEAL_TARGETS = await loadQuotaTargets();
        const { quotas, counts } = calculateDynamicQuotas(IDEAL_TARGETS);
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
        const rawPool = await runAllScrapers(hourlyLimits);
        
        // 2. Filtragem e Seleção com proporção exata por loja
        const finalSelection = distributeLinks(rawPool, hourlyLimits);

        if (finalSelection.length > 0) {
            // 3. Envio para o Webhook (Lote único)
            await sendBatchToWebhook(finalSelection);
            
            // 4. Marcar como enviado no histórico
            finalSelection.forEach(item => {
                markAsSent(item.driveId || item.id, item.store);
            });
            
            const countByStore = {};
            finalSelection.forEach(item => {
                countByStore[item.store] = (countByStore[item.store] || 0) + 1;
            });

            console.log(`✅ [Scheduler] Rodada finalizada: ${finalSelection.length} itens enviados. Distribuição: ${JSON.stringify(countByStore)}`);
        } else {
            console.log('📭 [Scheduler] Nenhum item válido encontrado nesta rodada.');
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
console.log('🎯 Metas: Configuráveis via Supabase → tabela quota_config');
